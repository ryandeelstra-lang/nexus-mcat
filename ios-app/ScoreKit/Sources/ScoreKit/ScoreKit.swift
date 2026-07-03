// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: the phone's three-score surface. A FAITHFUL MIRROR of the desktop modules
// scores/give_up.py + scores/display.py + scores/memory.py + scores/coverage.py — the SAME
// thresholds and the SAME honesty rules, never forked (tier-1: the "no fabricated/misleading
// readiness number" gate is an automatic-fail if broken).
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

/// A single honest score. Either it is `available` WITH a point+range (memory), or it abstains with
/// a structured `reason` (never a bare/fabricated number). Readiness may be `available` yet keep
/// `point == nil` on purpose: the 472–528 mapping is a desktop Block-G deliverable and the phone
/// refuses to invent it.
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
    public static func threeScores(topics: [TopicInput],
                                   contentCategoryPaths: Set<String>) -> ThreeScores {
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

        // ---- PERFORMANCE: the held-out exam-style model is a desktop Block-G deliverable; the
        // phone abstains, and additionally names the <20-graded-items shortfall when it applies.
        let maxItems = topics.map { Int($0.gradedReviews) }.max() ?? 0
        var perfReason = "performance model (held-out exam-style accuracy) is computed on desktop"
        if maxItems < performanceMinItems {
            perfReason += "; also < \(performanceMinItems) graded items on any topic"
        }
        let performance = Score(
            kind: "performance", available: false, point: nil, range: nil, confidence: nil,
            reason: perfReason, evidence: nil, note: nil)

        // ---- READINESS: the give-up gate — >= 1000 graded revlog ROWS AND >= 75% of the 31
        // content categories covered. Even when the gate opens, NO point is fabricated (honesty).
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
            readiness = Score(
                kind: "readiness", available: true, point: nil, range: nil, confidence: "gated",
                reason: nil,
                evidence: "\(totalGraded) graded reviews across "
                    + "\(covered.count)/\(contentCategoryPaths.count) content categories",
                note: "readiness 472–528 mapping is a desktop Block-G deliverable; "
                    + "no point fabricated yet")
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
