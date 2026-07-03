// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up Knowledge Garden — the iOS companion. A deliberately MINIMAL app: three calm tabs over
// the shared Anki Rust engine. The whole loop is "answer a question → fill the watering can → the
// garden grows." No AI runs on device; every number is engine truth or an honest abstention.
import SwiftUI
import ScoreKit

@main
struct KnowledgeGardenApp: App {
    @StateObject private var model = GardenModel()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(model)
                .task { await model.boot() }
                .tint(.green)
        }
    }
}

struct RootView: View {
    @EnvironmentObject var model: GardenModel
    // DEV/DEMO ONLY: `KG_START_TAB` (garden|tend|scores) picks the initial tab for screenshots.
    // Unset in shipping builds — the app always opens on the Garden.
    @State private var tab = RootView.initialTab

    var body: some View {
        TabView(selection: $tab) {
            GardenView()
                .tabItem { Label("Garden", systemImage: "leaf.fill") }.tag(0)
            ReviewView()
                .tabItem { Label("Tend", systemImage: "drop.fill") }.tag(1)
            ScoresView()
                .tabItem { Label("Scores", systemImage: "chart.bar.fill") }.tag(2)
        }
    }

    private static var initialTab: Int {
        switch ProcessInfo.processInfo.environment["KG_START_TAB"] {
        case "tend": return 1
        case "scores": return 2
        default: return 0
        }
    }
}

/// Shared observable state for all three tabs. Owns the engine handle and keeps the UI on the main
/// actor; every engine call hops to a background task and publishes results back on main.
@MainActor
final class GardenModel: ObservableObject {
    let engine = AnkiEngine.shared

    @Published var booted = false
    @Published var bootError: String?
    @Published var topics: [TopicRow] = []
    /// The watering can: reviews completed this session. Every graded answer adds a drop.
    @Published var drops = 0
    @Published var lastWateredTopic: String?
    @Published var syncStatus = "not synced yet"
    @Published var syncing = false

    /// Watering-can capacity — purely cosmetic pacing; a full can is a nice "you did a set" beat.
    let canCapacity = 12

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
    /// real graded reviews through the SAME engine answer path the Tend screen uses, so a screenshot
    /// can show the watering can filling and plants growing from genuine engine truth.
    private func runDemoReviewsIfRequested() async {
        guard let raw = ProcessInfo.processInfo.environment["KG_DEMO_REVIEWS"],
              let count = Int(raw), count > 0 else { return }
        for _ in 0..<count {
            let didReview = (try? await run { e -> Bool in
                guard let c = try e.nextCard() else { return false }
                try e.answer(c, rating: .good, msTaken: 1500)
                return true
            }) ?? false
            if !didReview { break }
            drops += 1
        }
        await refresh()
    }

    func refresh() async {
        if let rows = try? await run({ try $0.topicRows() }) {
            topics = rows.sorted { $0.deckName < $1.deckName }
        }
    }

    /// Called after each graded answer: one review = one drop in the can, then re-read engine truth
    /// so the watered topic's plant reflects the real review.
    func water(topic: String?) async {
        drops += 1
        lastWateredTopic = topic
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

extension TopicRow {
    var stage: GrowthStage {
        GardenGrowth.stage(cardsWithState: cardsWithState, gradedReviews: gradedReviews,
                           averageRecall: averageRecall, dueCount: dueCount)
    }
    var glyph: String { GardenGrowth.glyph(stage) }
}
