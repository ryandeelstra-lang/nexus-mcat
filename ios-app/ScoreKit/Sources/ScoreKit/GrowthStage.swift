// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: the phone's plant growth-stage mapping. A faithful subset of the desktop
// ts/routes/garden/state/stage.ts. Every plant's stage derives from ENGINE TRUTH (MasteryQuery)
// through this one function — nothing else may set a stage (integrity rule I4: growth comes only
// from graded reviews).
//
// Integrity rule I3: "bloomed" REQUIRES a paraphrase-gate pass, and those passes live only in the
// desktop sidecar (they do NOT sync). So the phone HONESTLY caps a strong-memory topic at
// `.budding` and never fabricates a bloom it cannot prove. This is the same rule the desktop
// enforces — the phone simply lacks the paraphrase signal, so it stops one stage short by design.
import Foundation

public enum GrowthStage: String, CaseIterable, Sendable {
    case bareSoil = "bare-soil"
    case sprout
    case seedling
    case growing
    case budding
    case drooping
}

public enum GardenGrowth {
    /// Retrievability at/above this = strong memory (mirrors the engine's mastered threshold).
    public static let strongMemory = 0.9
    /// Retrievability at/above this with some history = actively growing.
    public static let growingRecall = 0.6

    /// Map one topic's engine truth onto a visual stage. `dueCount` > 0 means care is owed, so the
    /// plant droops until tended — this is what makes "knowledge fades unless you keep watering" real.
    public static func stage(cardsWithState: UInt32, gradedReviews: UInt32,
                             averageRecall: Float, dueCount: UInt32) -> GrowthStage {
        if cardsWithState == 0 && gradedReviews == 0 { return .bareSoil }
        if dueCount > 0 { return .drooping }
        if averageRecall >= Float(strongMemory) { return .budding }  // phone caps here (I3)
        if averageRecall >= Float(growingRecall) && gradedReviews > 0 { return .growing }
        if gradedReviews > 0 { return .seedling }
        return .sprout
    }

    /// A calm emoji stand-in for the painterly desktop sprites — keeps the phone minimalistic while
    /// still reading as a living garden. (The desktop ships the full pixel-art stage sheet.)
    public static func glyph(_ stage: GrowthStage) -> String {
        switch stage {
        case .bareSoil: return "\u{1FAB4}"   // potted plant (empty-ish bed)
        case .sprout: return "\u{1F331}"     // seedling
        case .seedling: return "\u{1F33F}"   // herb
        case .growing: return "\u{1F33E}"    // sheaf / growing
        case .budding: return "\u{1F338}"    // blossom (bud)
        case .drooping: return "\u{1F940}"   // drooping flower (thirsty, reversible)
        }
    }
}
