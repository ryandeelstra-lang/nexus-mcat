// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: the phone's three-score surface. A FAITHFUL MIRROR of the desktop modules
// scores/give_up.py + scores/display.py + scores/memory.py + scores/coverage.py +
// scores/readiness.py (the 472–528 map) — the SAME thresholds and the SAME honesty rules, never
// forked (tier-1: the "no fabricated/misleading readiness number" gate is an automatic-fail if
// broken). Performance numbers are NEVER computed on device: the desktop's held-out eval ships as
// a provenance-stamped bundle artifact (HeldOutEval) or the phone abstains.
//
// The two engine-truth inputs (per topic) come from the MasteryQuery RPC over the shared Rust
// engine: average_recall, cards_with_state, graded_reviews, total_cards. Nothing is recomputed here.
import Foundation

/// One topic's engine truth (a row of MasteryQueryResponse.Topic).
public struct TopicInput {
    public let deckName: String
    public let totalCards: UInt32
    public let cardsWithState: UInt32
    public let averageRecall: Float
    public let gradedReviews: UInt32
    public init(deckName: String, totalCards: UInt32, cardsWithState: UInt32,
                averageRecall: Float, gradedReviews: UInt32) {
        self.deckName = deckName
        self.totalCards = totalCards
        self.cardsWithState = cardsWithState
        self.averageRecall = averageRecall
        self.gradedReviews = gradedReviews
    }
}

/// The desktop's PUBLISHED held-out performance eval (docs/release-proof/eval/performance-heldout.txt),
/// shipped to the phone as a provenance-stamped bundle artifact — a measured number, never recomputed
/// or fabricated on device. `nil` (artifact missing) => the phone abstains exactly as before.
public struct HeldOutEval {
    public let n: Int                       // held-out exam-style rewordings
    public let accuracy: Double
    public let wrongRate: Double
    public let range: ClosedRange<Double>   // 90% bootstrap interval
    public let baselineAccuracy: Double     // majority baseline it must beat
    public let source: String               // provenance (repo path + date)
    public init(n: Int, accuracy: Double, wrongRate: Double, range: ClosedRange<Double>,
                baselineAccuracy: Double, source: String) {
        self.n = n
        self.accuracy = accuracy
        self.wrongRate = wrongRate
        self.range = range
        self.baselineAccuracy = baselineAccuracy
        self.source = source
    }
}

/// A single honest score. Either it is `available` WITH a point+range, or it abstains with
/// a structured `reason` (never a bare/fabricated number). Readiness renders on the 472–528 MCAT
/// scale (scores/readiness.py mirror); memory and performance are 0–1 fractions.
public struct Score {
    public let kind: String
    public let available: Bool
    public let point: Double?
    public let range: ClosedRange<Double>?
    public let confidence: String?
    public let reason: String?       // structured abstention — never a bare number
    public let evidence: String?     // what produced the number (honesty element)
    public let note: String?         // caveats (e.g. "no point fabricated yet")
}

public struct ThreeScores {
    public let memory: Score
    public let performance: Score
    public let readiness: Score
    /// Coverage of the 31 AAMC content categories (the readiness gate denominator).
    public let coverageFraction: Double
    public let coveredCategories: Int
    public let totalCategories: Int
    public let totalGradedReviews: Int
}

public enum ScoreKit {
    // give_up.py constants — verified against scores/give_up.py (2026-07-03). If that file changes,
    // change BOTH; the values are the contract, not a local guess.
    public static let readinessMinGradedReviews = 1000   // revlog ROW count (answer events)
    public static let readinessMinCoverage = 0.75        // of the 31 content categories (gate)
    public static let performanceMinItems = 20           // per-topic graded items
    public static let memoryLowConfidenceBelow = 10      // cards-with-state below => low confidence

    /// display.py:_interval — a deterministic uncertainty band that shrinks with sample size n.
    static func interval(_ point: Double, n: Int) -> ClosedRange<Double> {
        let width = min(0.25, 0.5 / Double(max(n, 1)).squareRoot())
        return max(0, point - width)...min(1, point + width)
    }

    // readiness.py constants — the documented, UNVALIDATED linear map onto the MCAT scale.
    // Verified against scores/readiness.py (2026-07-04). If that file changes, change BOTH.
    static let scaleLo = 472.0, scaleHi = 528.0
    static let sectionLo = 118.0, sectionHi = 132.0, nSections = 4.0

    /// readiness.py:_section_score — accuracy onto one 118–132 section.
    static func sectionScore(_ acc: Double) -> Double {
        let a = max(0.0, min(1.0, acc))
        return sectionLo + (sectionHi - sectionLo) * a
    }

    /// readiness.py:map_to_scale — held-out accuracy (+ its bootstrap range) onto 472–528, the range
    /// widened by a coverage penalty. Clamped to the scale; the point is never fabricated — it is a
    /// documented map of a measured accuracy.
    static func mapToScale(acc: Double, accRange: ClosedRange<Double>,
                           coverage: Double) -> (point: Double, range: ClosedRange<Double>) {
        let point = min(scaleHi, max(scaleLo, (sectionScore(acc) * nSections).rounded()))
        let penalty = (1.0 - max(0.0, min(1.0, coverage))) * (scaleHi - scaleLo) * 0.1
        let lo = max(scaleLo, (sectionScore(accRange.lowerBound) * nSections - penalty).rounded())
        let hi = min(scaleHi, (sectionScore(accRange.upperBound) * nSections + penalty).rounded())
        return (point, lo...hi)
    }

    /// memory.py: cards-with-state-weighted mean recall + the state-card count denominator.
    static func memoryAggregate(_ topics: [TopicInput]) -> (point: Double, n: Int) {
        let n = topics.reduce(0) { $0 + Int($1.cardsWithState) }
        guard n > 0 else { return (0, 0) }
        let num = topics.reduce(0.0) { acc, t in
            t.cardsWithState > 0 ? acc + Double(t.averageRecall) * Double(t.cardsWithState) : acc
        }
        return (num / Double(n), n)
    }

    /// The three honest scores for one deck selection. `contentCategoryPaths` is the frozen set of
    /// the 31 AAMC content-category deck paths (the gate denominator, from taxonomy.json).
    /// `heldOutEval` is the desktop's published held-out performance eval (bundle artifact); nil =>
    /// performance abstains and readiness maps the desktop's documented default (0.5) when gated open.
    public static func threeScores(topics: [TopicInput],
                                   contentCategoryPaths: Set<String>,
                                   heldOutEval: HeldOutEval? = nil) -> ThreeScores {
        // ---- MEMORY: always shows; low-confidence flagged below the small floor (display.py)
        let (point, n) = memoryAggregate(topics)
        let confidence = n < memoryLowConfidenceBelow ? "low" : "ok"
        let memory = Score(
            kind: "memory", available: true, point: point, range: interval(point, n: n),
            confidence: confidence, reason: nil,
            evidence: "FSRS retrievability over \(n) card(s) with memory state, read from the "
                + "MasteryQuery RPC (not recomputed)",
            note: confidence == "ok" ? nil
                : "fewer than \(memoryLowConfidenceBelow) cards with FSRS state")

        // ---- PERFORMANCE: the held-out exam-style eval is computed on DESKTOP (scores/performance.py)
        // and shipped here as a provenance-stamped artifact — the phone surfaces the measured number
        // with its bootstrap range, and abstains when the artifact is missing or under the item floor.
        let performance: Score
        if let eval = heldOutEval, eval.n >= performanceMinItems {
            performance = Score(
                kind: "performance", available: true, point: eval.accuracy, range: eval.range,
                confidence: nil, reason: nil,
                evidence: "held-out accuracy on \(eval.n) exam-style rewordings, computed on desktop "
                    + "(\(eval.source)); majority baseline \(String(format: "%.2f", eval.baselineAccuracy))",
                note: String(format: "wrong-answer rate %.0f%%; 90%% bootstrap range",
                             eval.wrongRate * 100))
        } else if let eval = heldOutEval {
            performance = Score(
                kind: "performance", available: false, point: nil, range: nil, confidence: nil,
                reason: "held-out set has only \(eval.n) items (need >= \(performanceMinItems))",
                evidence: nil, note: nil)
        } else {
            let maxItems = topics.map { Int($0.gradedReviews) }.max() ?? 0
            var perfReason = "performance model (held-out exam-style accuracy) is computed on desktop"
            if maxItems < performanceMinItems {
                perfReason += "; also < \(performanceMinItems) graded items on any topic"
            }
            performance = Score(
                kind: "performance", available: false, point: nil, range: nil, confidence: nil,
                reason: perfReason, evidence: nil, note: nil)
        }

        // ---- READINESS: the give-up gate — >= 1000 graded revlog ROWS AND >= 75% of the 31
        // content categories covered. When the gate opens, the point is the desktop's documented
        // 472–528 map of MEASURED held-out accuracy (scores/readiness.py mirror) — never invented.
        let totalGraded = topics.reduce(0) { $0 + Int($1.gradedReviews) }
        let covered = Set(topics.filter { $0.totalCards > 0 }.map(\.deckName))
            .intersection(contentCategoryPaths)
        let coverage = contentCategoryPaths.isEmpty
            ? 0.0 : Double(covered.count) / Double(contentCategoryPaths.count)

        var reasons: [String] = []
        if totalGraded < readinessMinGradedReviews {
            reasons.append("only \(totalGraded) graded reviews (need >= \(readinessMinGradedReviews))")
        }
        if coverage < readinessMinCoverage {
            reasons.append(String(
                format: "only %.0f%% of content categories covered (need >= 75%%)", coverage * 100))
        }
        let readiness: Score
        if reasons.isEmpty {
            // display.py:readiness_display available path: map held-out accuracy (or the desktop's
            // documented default when no eval artifact ships) onto 472–528, band widened by coverage.
            let acc = heldOutEval?.accuracy ?? 0.5
            let accRange = heldOutEval?.range ?? 0.4...0.6
            let mapped = mapToScale(acc: acc, accRange: accRange, coverage: coverage)
            let evidence = heldOutEval.map {
                "held-out performance accuracy (\($0.source)) mapped onto 472–528; "
                    + "\(totalGraded) graded reviews across "
                    + "\(covered.count)/\(contentCategoryPaths.count) content categories"
            } ?? "no held-out eval bundled — mapped from the documented default (0.5); "
                + "\(totalGraded) graded reviews across "
                + "\(covered.count)/\(contentCategoryPaths.count) content categories"
            readiness = Score(
                kind: "readiness", available: true, point: mapped.point, range: mapped.range,
                confidence: coverage < 0.9 ? "low" : "moderate",
                reason: nil, evidence: evidence,
                note: "mapping UNVALIDATED against real outcomes")
        } else {
            readiness = Score(
                kind: "readiness", available: false, point: nil, range: nil, confidence: nil,
                reason: reasons.joined(separator: "; "), evidence: nil, note: nil)
        }

        return ThreeScores(
            memory: memory, performance: performance, readiness: readiness,
            coverageFraction: coverage, coveredCategories: covered.count,
            totalCategories: contentCategoryPaths.count, totalGradedReviews: totalGraded)
    }
}
