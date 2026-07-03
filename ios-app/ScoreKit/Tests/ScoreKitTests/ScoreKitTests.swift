// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html
import XCTest
@testable import ScoreKit

final class ScoreKitTests: XCTestCase {
    func topic(_ name: String, cards: UInt32 = 10, withState: UInt32 = 10,
               recall: Float = 0.9, graded: UInt32 = 0) -> TopicInput {
        TopicInput(deckName: name, totalCards: cards, cardsWithState: withState,
                   averageRecall: recall, gradedReviews: graded)
    }

    func testReadinessAbstainsBelowReviewFloor() {
        // 992 graded reviews, full coverage -> ABSTAIN with the reviews reason (give_up.py: >= 1000)
        let cats = (0..<31).map { "cat\($0)" }
        let topics = cats.map { topic($0, graded: 32) } // 31 * 32 = 992 < 1000
        let s = ScoreKit.threeScores(topics: topics, contentCategoryPaths: Set(cats))
        XCTAssertFalse(s.readiness.available)
        XCTAssertTrue(s.readiness.reason!.contains("graded reviews"))
    }

    func testReadinessAbstainsBelowCoverageFloor() {
        // plenty of reviews but only 23/31 = 74.2% covered -> ABSTAIN with the coverage reason
        let cats = (0..<31).map { "cat\($0)" }
        let topics = (0..<23).map { topic("cat\($0)", graded: 100) } // 2300 reviews, 23 covered
        let s = ScoreKit.threeScores(topics: topics, contentCategoryPaths: Set(cats))
        XCTAssertFalse(s.readiness.available)
        XCTAssertTrue(s.readiness.reason!.contains("content categories covered"))
    }

    func testReadinessAvailableAtExactFloor() {
        // exactly 1000 reviews + 24/31 = 77.4% -> available (>= comparisons, not >)
        let cats = (0..<31).map { "cat\($0)" }
        var topics = (0..<24).map { topic("cat\($0)", graded: 41) } // 24 * 41 = 984
        topics[0] = topic("cat0", graded: 57)                       // 984 - 41 + 57 = 1000
        let s = ScoreKit.threeScores(topics: topics, contentCategoryPaths: Set(cats))
        XCTAssertTrue(s.readiness.available)
        // Available, but STILL no fabricated point (honesty rule).
        XCTAssertNil(s.readiness.point)
    }

    func testMemoryAlwaysShowsWithRangeAndConfidence() {
        // 4 cards with state -> low confidence; band width = min(0.25, 0.5/sqrt(4)) = 0.25
        let s = ScoreKit.threeScores(topics: [topic("a", cards: 4, withState: 4, recall: 0.8)],
                                     contentCategoryPaths: ["a"])
        XCTAssertTrue(s.memory.available)
        XCTAssertEqual(s.memory.confidence, "low") // < MEMORY_LOW_CONFIDENCE_BELOW (10)
        XCTAssertEqual(s.memory.point!, 0.8, accuracy: 0.001)
        // 0.8 +/- 0.25 clamped to [0,1] -> [0.55, 1.0] -> width 0.45
        XCTAssertEqual(s.memory.range!.upperBound - s.memory.range!.lowerBound, 0.45, accuracy: 0.02)
    }

    func testMemoryConfidenceOkAtFloor() {
        // 10 cards with state -> "ok" confidence (>= MEMORY_LOW_CONFIDENCE_BELOW)
        let s = ScoreKit.threeScores(topics: [topic("a", cards: 10, withState: 10, recall: 0.7)],
                                     contentCategoryPaths: ["a"])
        XCTAssertEqual(s.memory.confidence, "ok")
    }

    func testPerformanceAbstainsUnderTwentyItems() {
        let s = ScoreKit.threeScores(topics: [topic("a", graded: 19)], contentCategoryPaths: ["a"])
        XCTAssertFalse(s.performance.available)
        XCTAssertTrue(s.performance.reason!.contains("20"))
    }

    func testEmptyCollectionAbstainsReadinessAndFlagsLowMemory() {
        let s = ScoreKit.threeScores(topics: [], contentCategoryPaths: ["a", "b"])
        XCTAssertTrue(s.memory.available)          // memory always shows
        XCTAssertEqual(s.memory.confidence, "low") // n == 0 < 10
        XCTAssertFalse(s.readiness.available)      // no reviews, no coverage
        XCTAssertFalse(s.performance.available)
    }

    // ---- growth stage (engine-truth only; I3 bloom cap honored)
    func testBareSoilWithNoHistory() {
        XCTAssertEqual(GardenGrowth.stage(cardsWithState: 0, gradedReviews: 0,
                                          averageRecall: 0, dueCount: 0), .bareSoil)
    }

    func testDueCardsDroop() {
        // even a strong topic droops when care is owed (keeps the "knowledge fades" loop honest)
        XCTAssertEqual(GardenGrowth.stage(cardsWithState: 5, gradedReviews: 30,
                                          averageRecall: 0.95, dueCount: 3), .drooping)
    }

    func testStrongMemoryCapsAtBuddingOnPhone() {
        // I3: bloom needs a paraphrase pass (desktop-only), so the phone stops at budding
        XCTAssertEqual(GardenGrowth.stage(cardsWithState: 8, gradedReviews: 40,
                                          averageRecall: 0.92, dueCount: 0), .budding)
    }

    func testGrowingAndSeedlingBands() {
        XCTAssertEqual(GardenGrowth.stage(cardsWithState: 4, gradedReviews: 10,
                                          averageRecall: 0.7, dueCount: 0), .growing)
        XCTAssertEqual(GardenGrowth.stage(cardsWithState: 2, gradedReviews: 3,
                                          averageRecall: 0.3, dueCount: 0), .seedling)
    }
}
