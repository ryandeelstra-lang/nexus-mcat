// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// The three honest scores — Memory, Performance, Readiness — each with a range or a STRUCTURED
// abstention, never a bare number. The thresholds come from ScoreKit, which mirrors the desktop
// scores/give_up.py exactly. This is the phone half of instructions.md §4 + the give-up rule.
import SwiftUI
import ScoreKit

struct ScoresView: View {
    @EnvironmentObject var model: GardenModel
    @State private var scores: ThreeScores?

    private var categories: Set<String> { GateCategories.shared.paths }

    var body: some View {
        NavigationStack {
            List {
                if let s = scores {
                    Section {
                        scoreRow(s.memory)
                        scoreRow(s.performance)
                        scoreRow(s.readiness)
                    } footer: {
                        Text("Coverage: \(s.coveredCategories)/\(s.totalCategories) content "
                             + "categories · \(s.totalGradedReviews) graded reviews. "
                             + "Scores refuse to appear until there is enough evidence.")
                    }
                } else {
                    Text("Reading the garden…").foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Scores")
            .onAppear(perform: recompute)
            .onChange(of: model.topics.count) { _, _ in recompute() }
            .onChange(of: model.drops) { _, _ in recompute() }
            .refreshable { await model.refresh(); recompute() }
        }
    }

    private func recompute() {
        let inputs = model.topics.map {
            TopicInput(deckName: $0.deckName, totalCards: $0.totalCards,
                       cardsWithState: $0.cardsWithState, averageRecall: $0.averageRecall,
                       gradedReviews: $0.gradedReviews)
        }
        scores = ScoreKit.threeScores(topics: inputs, contentCategoryPaths: categories,
                                      heldOutEval: HeldOutEvalArtifact.shared.eval)
    }

    @ViewBuilder
    private func scoreRow(_ s: Score) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(s.kind.capitalized).font(.headline)
                Spacer()
                if let c = s.confidence {
                    Text(c).font(.caption2.weight(.semibold))
                        .padding(.horizontal, 6).padding(.vertical, 2)
                        .background(c == "low" ? Color.orange.opacity(0.2) : Color.green.opacity(0.2))
                        .clipShape(Capsule())
                }
            }
            if s.available, let p = s.point, let r = s.range {
                // readiness lives on the real 472–528 MCAT scale; memory/performance are fractions
                if s.kind == "readiness" {
                    Text("\(Int(p))  (range \(Int(r.lowerBound))–\(Int(r.upperBound)))")
                        .font(.title3.monospacedDigit())
                } else {
                    Text("\(pct(p))  (range \(pct(r.lowerBound))–\(pct(r.upperBound)))")
                        .font(.title3.monospacedDigit())
                }
            } else if s.available {
                // e.g. readiness gate open, but no fabricated point
                Text("Gate open — no number fabricated").font(.body)
            } else {
                Label("Not enough data yet", systemImage: "hourglass")
                    .font(.subheadline).foregroundStyle(.secondary)
            }
            if let reason = s.reason {
                Text(reason).font(.caption).foregroundStyle(.secondary)
            }
            if let evidence = s.evidence {
                Text(evidence).font(.caption2).foregroundStyle(.tertiary)
            }
            if let note = s.note {
                Text(note).font(.caption2).italic().foregroundStyle(.tertiary)
            }
        }
        .padding(.vertical, 4)
    }

    private func pct(_ v: Double) -> String { "\(Int((v * 100).rounded()))%" }
}

/// The desktop's published held-out performance eval, bundled as performance-heldout.json —
/// a verbatim, provenance-stamped copy of docs/release-proof/eval/performance-heldout.txt.
/// Missing/corrupt file => `eval` is nil and the phone abstains (never a fabricated number).
final class HeldOutEvalArtifact {
    static let shared = HeldOutEvalArtifact()
    let eval: HeldOutEval?

    private struct Doc: Decodable {
        let n: Int
        let accuracy: Double
        let wrong_rate: Double
        let range: [Double]
        let baseline_accuracy: Double
        let source: String
    }

    init() {
        guard let url = Bundle.main.url(forResource: "performance-heldout", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let doc = try? JSONDecoder().decode(Doc.self, from: data),
              doc.range.count == 2, doc.range[0] <= doc.range[1] else {
            eval = nil
            return
        }
        eval = HeldOutEval(n: doc.n, accuracy: doc.accuracy, wrongRate: doc.wrong_rate,
                           range: doc.range[0]...doc.range[1],
                           baselineAccuracy: doc.baseline_accuracy, source: doc.source)
    }
}

/// The 31 content-category deck paths (the readiness gate denominator) bundled from
/// docs/data/mcat_taxonomy.yaml — the SAME denominator as scores/coverage.py.
final class GateCategories {
    static let shared = GateCategories()
    let paths: Set<String>

    private struct Leaf: Decodable { let path: String; let is_content_category: Bool }
    private struct Doc: Decodable { let leaves: [Leaf] }

    init() {
        guard let url = Bundle.main.url(forResource: "taxonomy", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let doc = try? JSONDecoder().decode(Doc.self, from: data) else {
            paths = []
            return
        }
        paths = Set(doc.leaves.filter(\.is_content_category).map(\.path))
    }
}
