// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// The watering-can loop. A question appears; you think, reveal, and say how it went. Each answer is
// a REAL graded review on the shared engine (answer_card) — and it pours one drop into the can and
// waters that topic's plant. This is intentionally NOT flashcard chrome: it's "tend the garden."
import SwiftUI

struct ReviewView: View {
    @EnvironmentObject var model: GardenModel

    @State private var card: Anki_Scheduler_QueuedCards.QueuedCard?
    @State private var deckName = ""
    @State private var front = ""
    @State private var back = ""
    @State private var revealed = false
    @State private var shownAt = Date()
    @State private var pouring = false
    @State private var loading = true

    var body: some View {
        NavigationStack {
            VStack(spacing: 20) {
                if !model.booted || loading {
                    ProgressView("Finding what needs water…")
                } else if let card {
                    questionCard(card)
                } else {
                    watered
                }
            }
            .padding()
            .navigationTitle("Tend the Garden")
            .overlay(alignment: .top) { if pouring { drop } }
        }
        // Wait for the engine to finish opening before asking for a card (avoids a boot race that
        // would otherwise show "watered" before the deck is loaded).
        .task(id: model.booted) { if model.booted { await advance() } }
    }

    // MARK: states

    private func questionCard(_ card: Anki_Scheduler_QueuedCards.QueuedCard) -> some View {
        VStack(spacing: 18) {
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

            if revealed {
                Text("How well did it grow?").font(.subheadline).foregroundStyle(.secondary)
                HStack(spacing: 10) {
                    grade("Forgot", .again, .red)
                    grade("Tough", .hard, .orange)
                    grade("Good", .good, .green)
                    grade("Easy", .easy, .blue)
                }
            } else {
                Button {
                    withAnimation { revealed = true }
                } label: {
                    Label("Reveal", systemImage: "eye")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
            }
        }
    }

    private var watered: some View {
        VStack(spacing: 12) {
            Text("\u{1F4A7}").font(.system(size: 60))
            Text("Your garden is watered for now.")
                .font(.title3)
            Text("Come back when more cards are due, or Sync to pull the shared deck.")
                .font(.callout).foregroundStyle(.secondary).multilineTextAlignment(.center)
            Button {
                Task { await model.sync(); await advance() }
            } label: {
                Label("Sync", systemImage: "arrow.triangle.2.circlepath")
            }
            .buttonStyle(.bordered)
        }
    }

    private var drop: some View {
        Image(systemName: "drop.fill")
            .font(.system(size: 34)).foregroundStyle(.cyan)
            .transition(.move(edge: .top).combined(with: .opacity))
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
        let topic = deckName
        do {
            try await Task.detached(priority: .userInitiated) {
                try AnkiEngine.shared.answer(card, rating: rating, msTaken: ms)
            }.value
        } catch {
            // A failed write must not silently drop the review; surface and stop.
            return
        }
        withAnimation { pouring = true }
        await model.water(topic: topic)              // one drop + re-read engine truth
        try? await Task.sleep(nanoseconds: 350_000_000)
        withAnimation { pouring = false }
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

    /// The card's deck resolved to its taxonomy topic name (for the "last watered" line + header).
    private func deckNameFor(_ c: Anki_Scheduler_QueuedCards.QueuedCard) -> String {
        let did = c.card.deckID
        return model.topics.first { $0.deckID == did }?.deckName ?? "MCAT"
    }
}
