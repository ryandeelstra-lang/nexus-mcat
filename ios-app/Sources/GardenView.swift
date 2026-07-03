// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// The garden home: the watering can (fills as you answer) above a calm grid of topic-plants whose
// growth is real engine mastery. Minimal by design — no pixel-art, just a quiet living board.
import SwiftUI
import ScoreKit

struct GardenView: View {
    @EnvironmentObject var model: GardenModel

    private let cols = [GridItem(.adaptive(minimum: 84), spacing: 12)]

    var body: some View {
        NavigationStack {
            Group {
                if let err = model.bootError {
                    ContentUnavailableView("Garden couldn't open",
                                           systemImage: "exclamationmark.triangle",
                                           description: Text(err))
                } else if !model.booted {
                    ProgressView("Waking the garden…")
                } else {
                    ScrollView {
                        WateringCan(drops: model.drops, capacity: model.canCapacity,
                                    lastTopic: model.lastWateredTopic.map(shortTopic))
                            .padding(.top, 8)

                        bloomSummary
                            .padding(.horizontal)

                        LazyVGrid(columns: cols, spacing: 12) {
                            ForEach(model.topics) { t in Plant(topic: t) }
                        }
                        .padding()
                    }
                    .refreshable { await model.refresh() }
                }
            }
            .navigationTitle("Knowledge Garden")
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
    }

    private var bloomSummary: some View {
        let budding = model.topics.filter { $0.stage == .budding }.count
        let planted = model.topics.filter { $0.stage != .bareSoil }.count
        return HStack {
            Label("\(planted) planted", systemImage: "leaf")
            Spacer()
            Label("\(budding) budding", systemImage: "camera.macro")
        }
        .font(.subheadline).foregroundStyle(.secondary)
    }
}

/// The centerpiece: a can that fills with every answered question. Cosmetic pacing over the real
/// review count — the caption keeps it honest ("every answer you give fills the can").
struct WateringCan: View {
    let drops: Int
    let capacity: Int
    let lastTopic: String?

    private var fill: Double { min(1, Double(drops) / Double(capacity)) }

    var body: some View {
        VStack(spacing: 8) {
            ZStack(alignment: .bottom) {
                RoundedRectangle(cornerRadius: 20)
                    .fill(Color.blue.opacity(0.10))
                    .frame(width: 150, height: 120)
                RoundedRectangle(cornerRadius: 20)
                    .fill(LinearGradient(colors: [.cyan.opacity(0.55), .blue.opacity(0.75)],
                                         startPoint: .top, endPoint: .bottom))
                    .frame(width: 150, height: max(6, 120 * fill))
                    .animation(.spring(duration: 0.5), value: fill)
                Image(systemName: "drop.fill")
                    .font(.system(size: 40)).foregroundStyle(.white.opacity(0.9))
                    .padding(.bottom, 16)
            }
            .overlay(RoundedRectangle(cornerRadius: 20).strokeBorder(.blue.opacity(0.3), lineWidth: 2))
            Text("\(drops) drop\(drops == 1 ? "" : "s") gathered")
                .font(.headline)
            Text("Every question you answer fills the can.")
                .font(.caption).foregroundStyle(.secondary)
            if let lastTopic {
                Text("Last watered: \(lastTopic)")
                    .font(.caption2).foregroundStyle(.green)
            }
        }
    }
}

/// One topic-plant. Its stage is derived only from engine mastery (never fabricated).
struct Plant: View {
    let topic: TopicRow

    var body: some View {
        VStack(spacing: 4) {
            Text(topic.glyph).font(.system(size: 34))
            Text(shortTopic(topic.deckName))
                .font(.caption2).multilineTextAlignment(.center).lineLimit(2)
            if topic.cardsWithState > 0 {
                Text("\(Int(topic.averageRecall * 100))%")
                    .font(.caption2.monospacedDigit()).foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 8)
        .background(RoundedRectangle(cornerRadius: 12).fill(Color.green.opacity(0.06)))
    }
}
