// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up Knowledge Garden — the iOS companion. Deliberately MINIMAL: one screen with the drops
// you've gathered and the flashcards that earn more. The garden itself is tended on the computer;
// the phone only collects drops (real graded reviews on the shared Anki Rust engine) and syncs them
// home. No AI runs on device; every number is engine truth or an honest abstention.
import SwiftUI

@main
struct KnowledgeGardenApp: App {
    @StateObject private var model = GardenModel()

    var body: some Scene {
        WindowGroup {
            ReviewView()
                .environmentObject(model)
                .task { await model.boot() }
                .tint(.green)
        }
    }
}

/// Shared state for the single screen. Owns the engine handle and keeps the UI on the main
/// actor; every engine call hops to a background task and publishes results back on main.
@MainActor
final class GardenModel: ObservableObject {
    let engine = AnkiEngine.shared

    @Published var booted = false
    @Published var bootError: String?
    @Published var topics: [TopicRow] = []
    /// Drops gathered = the collection's total graded reviews (engine truth via MasteryQuery), so
    /// the number survives restarts and follows the collection through sync. Each answer bumps it
    /// immediately for feedback; refresh() re-reads the real count.
    @Published var drops = 0
    @Published var syncStatus = "not synced yet"
    @Published var syncing = false

    func boot() async {
        do {
            try await run { try $0.open() }
            booted = true
            await refresh()
            await runDemoReviewsIfRequested()
        } catch {
            bootError = "\(error)"
        }
    }

    /// DEV/DEMO ONLY (gated by the `KG_DEMO_REVIEWS` env var, never set in shipping builds): drive N
    /// real graded reviews through the SAME engine answer path the review screen uses, so a
    /// screenshot can show drops earned from genuine engine truth.
    private func runDemoReviewsIfRequested() async {
        let env = ProcessInfo.processInfo.environment
        if let raw = env["KG_DEMO_REVIEWS"], let count = Int(raw), count > 0 {
            for _ in 0..<count {
                let didReview = (try? await run { e -> Bool in
                    guard let c = try e.nextCard() else { return false }
                    try e.answer(c, rating: .good, msTaken: 1500)
                    return true
                }) ?? false
                if !didReview { break }
            }
            await refresh()
        }
        // DEV/DEMO ONLY: sync immediately after the demo reviews so an automated run can prove the
        // app reaches a real running anki-sync-server. Never set in shipping builds.
        if env["KG_DEMO_SYNC"] == "1" { await sync() }

        // DEV ONLY (KG_BENCH=1): run the §10 speed benchmark and write p50/p95/worst to
        // Documents/kg-bench.json so an automated run can read it back. Never set in shipping builds.
        if env["KG_BENCH"] == "1" {
            if let results = try? await run({ try $0.benchmark() }) {
                let url = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
                    .appendingPathComponent("kg-bench.json")
                if let data = try? JSONSerialization.data(withJSONObject: results,
                                                          options: [.prettyPrinted, .sortedKeys]) {
                    try? data.write(to: url)
                }
            }
        }
    }

    func refresh() async {
        if let rows = try? await run({ try $0.topicRows() }) {
            topics = rows.sorted { $0.deckName < $1.deckName }
            withAnimation { drops = rows.reduce(0) { $0 + Int($1.gradedReviews) } }
        }
    }

    /// Called after each graded answer: one review = one drop, then re-read engine truth.
    func water() async {
        withAnimation { drops += 1 }
        await refresh()
    }

    func sync() async {
        syncing = true
        defer { syncing = false }
        do {
            syncStatus = try await run { try $0.syncNow() }
            await refresh()
        } catch {
            // Offline is a first-class state: reviews stay queued locally and sync later.
            syncStatus = "offline — reviews saved, will sync later"
        }
    }

    /// Run a throwing engine closure off the main actor (engine serializes internally).
    private func run<T: Sendable>(_ body: @escaping @Sendable (AnkiEngine) throws -> T) async throws -> T {
        let engine = self.engine
        return try await Task.detached(priority: .userInitiated) { try body(engine) }.value
    }
}

// MARK: - small shared UI helpers

/// Trim a taxonomy deck path ("MCAT::B-B::1A") down to a compact leaf label ("B-B · 1A").
func shortTopic(_ path: String) -> String {
    let parts = path.components(separatedBy: "::").filter { $0 != "MCAT" }
    return parts.suffix(2).joined(separator: " · ")
}
