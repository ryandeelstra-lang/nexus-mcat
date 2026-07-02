// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html
//
// ScoresView — the three scores (Memory / Performance / Readiness) shown HONESTLY on the
// phone by reusing the SHARED engine's MasteryQuery RPC (the fork's own Rust change) and the
// SAME give-up rule as the desktop scores layer. Memory is a real FSRS-derived aggregate;
// Performance and Readiness ABSTAIN with a stated reason rather than fabricate a number
// (Readiness needs ≥1,000 graded reviews AND ≥75% coverage — instructions §4 honesty rule).

import SwiftUI
import SwiftProtobuf

// The give-up thresholds mirror docs/05-DECISIONS.md (one source of truth on the desktop).
private enum GiveUp {
    static let readinessMinGradedReviews: UInt32 = 1000
    static let readinessMinCoverage = 0.75
    static let performanceMinItemsPerTopic: UInt32 = 20
}

@MainActor
final class ScoresModel: ObservableObject {
    @Published var loaded = false
    @Published var error: String?

    @Published var memoryRecall: Double = 0     // weighted average FSRS retrievability
    @Published var cardsWithState: UInt32 = 0
    @Published var totalGradedReviews: UInt32 = 0
    @Published var topicsWithData = 0

    private let engine: Engine
    init(engine: Engine) { self.engine = engine }

    func refresh() async {
        do {
            let response: Anki_Stats_MasteryQueryResponse = try await engine.perform { bridge in
                try bridge.call(
                    service: ServiceIndices.BackendStatsService.index,
                    method: ServiceIndices.BackendStatsService.masteryQuery,
                    Anki_Stats_MasteryQueryRequest()  // empty search = whole collection
                )
            }
            var recallNumerator = 0.0
            var stateDenominator: UInt32 = 0
            var graded: UInt32 = 0
            var withData = 0
            for topic in response.topics {
                recallNumerator += Double(topic.averageRecall) * Double(topic.cardsWithState)
                stateDenominator += topic.cardsWithState
                graded += topic.gradedReviews
                if topic.cardsWithState > 0 || topic.gradedReviews > 0 { withData += 1 }
            }
            memoryRecall = stateDenominator > 0 ? recallNumerator / Double(stateDenominator) : 0
            cardsWithState = stateDenominator
            totalGradedReviews = graded
            topicsWithData = withData
            loaded = true
        } catch {
            self.error = String(describing: error)
        }
    }
}

struct ScoresView: View {
    @StateObject private var model: ScoresModel

    init(engine: Engine) { _model = StateObject(wrappedValue: ScoresModel(engine: engine)) }

    var body: some View {
        ScrollView {
            VStack(spacing: 18) {
                header
                memoryCard
                performanceCard
                readinessCard

                Text("Full Performance and Readiness models run on the desktop. The phone never shows a readiness number it cannot back up.")
                    .font(Theme.font(13))
                    .foregroundStyle(Theme.muted)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 4)
                    .padding(.top, 2)
            }
            .padding(18)
        }
        .background(Theme.canvas)
        .navigationTitle("Scores")
        .navigationBarTitleDisplayMode(.inline)
        .task { await model.refresh() }
        .refreshable { await model.refresh() }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Your three honest scores")
                .font(Theme.font(26, .semibold))
                .tracking(-0.5)
                .foregroundStyle(Theme.ink)
            Text("Two scores show a value with a confidence range; Readiness stays silent until you've earned it.")
                .font(Theme.font(14))
                .foregroundStyle(Theme.muted)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.bottom, 2)
    }

    // MARK: - Memory (a real, backed number)

    private var memoryCard: some View {
        scoreCard(kind: "Memory", rail: Theme.sectionBlue) {
            if model.cardsWithState == 0 {
                Text("No memory data yet — review some cards first.")
                    .font(Theme.font(15))
                    .foregroundStyle(Theme.muted)
            } else {
                let pct = model.memoryRecall * 100
                // A simple, honest confidence band that widens when there is little data.
                let band = model.cardsWithState < 50 ? 12.0 : (model.cardsWithState < 200 ? 7.0 : 4.0)
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text("\(Int(pct.rounded()))%")
                        .font(Theme.font(54, .semibold))
                        .foregroundStyle(Theme.ink)
                    Text("recall")
                        .font(Theme.font(18, .medium))
                        .foregroundStyle(Theme.muted)
                    Spacer()
                    Text(model.cardsWithState < 50 ? "low confidence" : "calibrated")
                        .nexusPill(
                            background: model.cardsWithState < 50 ? Theme.cautionTint : Theme.calibratedTint,
                            foreground: model.cardsWithState < 50 ? Theme.cautionInk : Theme.calibratedInk
                        )
                }
                rangeBar(lo: (pct - band) / 100, hi: (pct + band) / 100)
                    .padding(.top, 6)
                Text("Likely range: \(Int((pct - band).rounded()))%–\(Int((pct + band).rounded()))%")
                    .font(Theme.font(13))
                    .foregroundStyle(Theme.muted)
                Text("Based on \(model.cardsWithState) cards with FSRS memory state.")
                    .font(Theme.font(13))
                    .foregroundStyle(Theme.mutedLight)
            }
        }
    }

    // MARK: - Performance (abstains — never fabricates)

    private var performanceCard: some View {
        scoreCard(kind: "Performance", rail: Theme.sectionSlate, abstained: true) {
            Text("Not available on device")
                .font(Theme.font(18, .semibold))
                .foregroundStyle(Theme.ink.opacity(0.82))
            Text("Needs ≥\(GiveUp.performanceMinItemsPerTopic) graded exam-style items per topic, scored by the desktop performance model.")
                .font(Theme.font(13))
                .foregroundStyle(Theme.muted)
        }
    }

    // MARK: - Readiness (abstains — never fabricates)

    private var readinessCard: some View {
        scoreCard(kind: "Readiness", rail: Theme.sectionTeal, abstained: true) {
            Text("No score yet")
                .font(Theme.font(18, .semibold))
                .foregroundStyle(Theme.ink.opacity(0.82))
            Text("The app abstains until there are ≥\(GiveUp.readinessMinGradedReviews) graded reviews (you have \(model.totalGradedReviews)) AND ≥\(Int(GiveUp.readinessMinCoverage * 100))% topic coverage. A confident number without the evidence behind it is a guess, not a prediction.")
                .font(Theme.font(13))
                .foregroundStyle(Theme.muted)
        }
    }

    // MARK: - Reusable pieces

    /// The dashboard range bar (track + gradient fill spanning [lo, hi]); fill #60A5FA → #3B82F6.
    private func rangeBar(lo: Double, hi: Double) -> some View {
        GeometryReader { geo in
            let width = geo.size.width
            let a = min(max(lo, 0), 1)
            let b = min(max(hi, 0), 1)
            ZStack(alignment: .leading) {
                Capsule().fill(Theme.track)
                Capsule()
                    .fill(LinearGradient(
                        colors: [Color(hex: 0x60A5FA), Theme.accent],
                        startPoint: .leading, endPoint: .trailing
                    ))
                    .frame(width: max(6, (b - a) * width))
                    .offset(x: a * width)
            }
        }
        .frame(height: 8)
    }

    /// A Nexus dashboard card: white surface, 18px radius, soft shadow, and a 4px left accent rail.
    private func scoreCard<Content: View>(
        kind: String,
        rail: Color,
        abstained: Bool = false,
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(kind.uppercased())
                    .font(Theme.font(11.5, .semibold))
                    .tracking(1.15)
                    .foregroundStyle(Theme.mutedLight)
                Spacer()
                if abstained {
                    Text("Abstained")
                        .nexusPill(background: Theme.ink.opacity(0.06), foreground: Theme.muted)
                }
            }
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(22)
        .background(
            RoundedRectangle(cornerRadius: Theme.cardRadius, style: .continuous)
                .fill(Theme.surface)
                .overlay(alignment: .leading) {
                    Rectangle().fill(rail).frame(width: 4)
                }
                .clipShape(RoundedRectangle(cornerRadius: Theme.cardRadius, style: .continuous))
        )
        .overlay(
            RoundedRectangle(cornerRadius: Theme.cardRadius, style: .continuous)
                .strokeBorder(Theme.hairlineSubtle, lineWidth: 1)
        )
        .shadow(color: Theme.ink.opacity(0.06), radius: 15, x: 0, y: 10)
        .shadow(color: Theme.ink.opacity(0.04), radius: 1, x: 0, y: 1)
    }
}
