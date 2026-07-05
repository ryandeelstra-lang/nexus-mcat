// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// The phone's single screen: a big drops count up top, a normal Anki flashcard below. Each answer
// is a REAL graded review on the shared engine (answer_card) and earns one drop; the garden itself
// is tended on the computer — the phone only gathers drops and syncs them home.
import SwiftUI

struct ReviewView: View {
    @EnvironmentObject var model: GardenModel

    @State private var card: Anki_Scheduler_QueuedCards.QueuedCard?
    @State private var deckName = ""
    @State private var front = ""
    @State private var back = ""
    @State private var revealed = false
    @State private var shownAt = Date()
    @State private var earned = false
    @State private var loading = true

    var body: some View {
        NavigationStack {
            VStack(spacing: 16) {
                dropsHeader
                Divider()
                if let err = model.bootError {
                    ContentUnavailableView("Couldn't open the deck",
                                           systemImage: "exclamationmark.triangle",
                                           description: Text(err))
                } else if !model.booted || loading {
                    Spacer()
                    ProgressView("Loading cards…")
                    Spacer()
                } else if let card {
                    flashcard(card)
                } else {
                    caughtUp
                }
            }
            .padding()
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        Task { await model.sync() }
                    } label: {
                        if model.syncing { ProgressView() }
                        else { Label("Sync", systemImage: "arrow.triangle.2.circlepath") }
                    }
                    .disabled(model.syncing)
                }
            }
            .safeAreaInset(edge: .bottom) {
                Text(model.syncStatus)
                    .font(.caption).foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity)
                    .padding(6)
                    .background(.ultraThinMaterial)
            }
        }
        // Wait for the engine to finish opening before asking for a card (avoids a boot race that
        // would otherwise show "caught up" before the deck is loaded).
        .task(id: model.booted) { if model.booted { await advance() } }
    }

    // MARK: the drops counter

    private var dropsHeader: some View {
        VStack(spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Image(systemName: "drop.fill")
                    .font(.system(size: 38)).foregroundStyle(.cyan)
                Text("\(model.drops)")
                    .font(.system(size: 60, weight: .bold, design: .rounded))
                    .monospacedDigit()
                    .contentTransition(.numericText())
                if earned {
                    Text("+1")
                        .font(.title3.bold()).foregroundStyle(.cyan)
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                }
            }
            Text("drops gathered").font(.headline).foregroundStyle(.secondary)
            Text("Every card you answer earns a drop. Tend your garden on your computer.")
                .font(.caption).foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
    }

    // MARK: the flashcard

    private func flashcard(_ card: Anki_Scheduler_QueuedCards.QueuedCard) -> some View {
        VStack(spacing: 16) {
            Text(shortTopic(deckName)).font(.caption).foregroundStyle(.secondary)

            ScrollView {
                Text(front)
                    .font(.title3).multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity)
                    .padding()
                if revealed {
                    Divider()
                    Text(back)
                        .font(.body).multilineTextAlignment(.center)
                        .frame(maxWidth: .infinity)
                        .padding()
                        .transition(.opacity)
                }
            }
            .frame(maxHeight: .infinity)
            .background(RoundedRectangle(cornerRadius: 16).fill(Color(.secondarySystemBackground)))

            if revealed {
                HStack(spacing: 10) {
                    grade("Again", .again, .red)
                    grade("Hard", .hard, .orange)
                    grade("Good", .good, .green)
                    grade("Easy", .easy, .blue)
                }
            } else {
                Button {
                    withAnimation { revealed = true }
                } label: {
                    Label("Show Answer", systemImage: "eye")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
            }
        }
    }

    private var caughtUp: some View {
        VStack(spacing: 12) {
            Spacer()
            Text("\u{1F4A7}").font(.system(size: 60))
            Text("All caught up.")
                .font(.title3)
            Text("Come back when more cards are due, or Sync to pull the shared deck.")
                .font(.callout).foregroundStyle(.secondary).multilineTextAlignment(.center)
            Button {
                Task { await model.sync(); await advance() }
            } label: {
                Label("Sync", systemImage: "arrow.triangle.2.circlepath")
            }
            .buttonStyle(.bordered)
            Spacer()
        }
    }

    private func grade(_ label: String, _ rating: Anki_Scheduler_CardAnswer.Rating,
                       _ tint: Color) -> some View {
        Button(label) { Task { await answer(rating) } }
            .buttonStyle(.bordered).tint(tint)
            .frame(maxWidth: .infinity)
    }

    // MARK: actions

    private func answer(_ rating: Anki_Scheduler_CardAnswer.Rating) async {
        guard let card else { return }
        let ms = UInt32(min(60_000, max(1, Date().timeIntervalSince(shownAt) * 1000)))
        do {
            try await Task.detached(priority: .userInitiated) {
                try AnkiEngine.shared.answer(card, rating: rating, msTaken: ms)
            }.value
        } catch {
            // A failed write must not silently drop the review; surface and stop.
            return
        }
        withAnimation { earned = true }
        await model.water()                          // one drop + re-read engine truth
        try? await Task.sleep(nanoseconds: 350_000_000)
        withAnimation { earned = false }
        await advance()
    }

    private func advance() async {
        loading = true
        revealed = false
        let next = try? await Task.detached(priority: .userInitiated) {
            try AnkiEngine.shared.nextCard()
        }.value
        if let c = next ?? nil {
            let rendered = try? await Task.detached(priority: .userInitiated) {
                try AnkiEngine.shared.renderCard(c.card.id)
            }.value
            card = c
            deckName = deckNameFor(c)
            front = rendered?.front ?? "(unable to render)"
            back = rendered?.back ?? ""
            shownAt = Date()
        } else {
            card = nil
        }
        loading = false
    }

    /// The card's deck resolved to its taxonomy topic name (for the header caption).
    private func deckNameFor(_ c: Anki_Scheduler_QueuedCards.QueuedCard) -> String {
        let did = c.card.deckID
        return model.topics.first { $0.deckID == did }?.deckName ?? "MCAT"
    }
}
