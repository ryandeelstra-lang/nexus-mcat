// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: G1.2 gate — the growth-stage mapping table-tested across all 8 stages +
// boundaries (docs/26 G1 exit gate). These pin the integrity rules:
//   I3 bloom REQUIRES the paraphrase pass; I4 growth only from engine truth.
import { describe, expect, it } from "vitest";

import { regionBloomFraction, stageFor, type StageInputs } from "./stage";

function inputs(over: {
    totalCards?: number;
    cardsWithState?: number;
    averageRecall?: number;
    gradedReviews?: number;
    dueCount?: number;
    paraphrasePassed?: boolean;
    hasActiveWeed?: boolean;
}): StageInputs {
    return {
        topic: {
            totalCards: over.totalCards ?? 100,
            cardsWithState: over.cardsWithState ?? 0,
            averageRecall: over.averageRecall ?? 0,
            gradedReviews: over.gradedReviews ?? 0,
            dueCount: over.dueCount ?? 0,
        },
        paraphrasePassed: over.paraphrasePassed ?? false,
        hasActiveWeed: over.hasActiveWeed ?? false,
    };
}

describe("stageFor — the 8 stages (doc 23 §8)", () => {
    it("bare-soil: nothing started", () => {
        expect(stageFor(inputs({}))).toBe("bare-soil");
    });

    it("sprout: FSRS state exists but no graded review yet", () => {
        expect(stageFor(inputs({ cardsWithState: 3 }))).toBe("sprout");
    });

    it("seedling: reviews logged, recall still low", () => {
        expect(
            stageFor(inputs({ cardsWithState: 3, gradedReviews: 4, averageRecall: 0.3 })),
        ).toBe("seedling");
    });

    it("growing: recall rising past the growing floor", () => {
        expect(
            stageFor(inputs({ cardsWithState: 5, gradedReviews: 9, averageRecall: 0.6 })),
        ).toBe("growing");
    });

    it("budding: strong memory but NOT paraphrase-passed (I3 — the bud that won't bloom)", () => {
        expect(
            stageFor(inputs({ cardsWithState: 8, gradedReviews: 30, averageRecall: 0.93 })),
        ).toBe("budding");
    });

    it("bloomed: strong memory AND the paraphrase gate passed", () => {
        expect(
            stageFor(
                inputs({
                    cardsWithState: 8,
                    gradedReviews: 30,
                    averageRecall: 0.93,
                    paraphrasePassed: true,
                }),
            ),
        ).toBe("bloomed");
    });

    it("drooping: due cards override bloom — knowledge fades without upkeep", () => {
        expect(
            stageFor(
                inputs({
                    cardsWithState: 8,
                    gradedReviews: 30,
                    averageRecall: 0.91,
                    paraphrasePassed: true,
                    dueCount: 2,
                }),
            ),
        ).toBe("drooping");
    });

    it("weedy: an active error-cause weed outranks everything but bare soil", () => {
        expect(
            stageFor(
                inputs({
                    cardsWithState: 8,
                    gradedReviews: 30,
                    averageRecall: 0.95,
                    paraphrasePassed: true,
                    hasActiveWeed: true,
                }),
            ),
        ).toBe("weedy");
    });
});

describe("stageFor — boundaries + integrity", () => {
    it("recall exactly at the strong-memory threshold buds (>= semantics)", () => {
        expect(
            stageFor(inputs({ cardsWithState: 5, gradedReviews: 25, averageRecall: 0.9 })),
        ).toBe("budding");
    });

    it("recall just under the strong threshold never buds", () => {
        expect(
            stageFor(inputs({ cardsWithState: 5, gradedReviews: 25, averageRecall: 0.899 })),
        ).toBe("growing");
    });

    it("recall exactly at the growing floor grows (>= semantics)", () => {
        expect(
            stageFor(inputs({ cardsWithState: 5, gradedReviews: 3, averageRecall: 0.6 })),
        ).toBe("growing");
    });

    it("I3: a paraphrase pass alone can never bloom a weak plant", () => {
        expect(
            stageFor(
                inputs({
                    cardsWithState: 5,
                    gradedReviews: 3,
                    averageRecall: 0.5,
                    paraphrasePassed: true,
                }),
            ),
        ).toBe("seedling");
    });

    it("bare soil stays bare even with a weed flag (nothing planted to weed)", () => {
        expect(stageFor(inputs({ hasActiveWeed: true }))).toBe("bare-soil");
    });
});

describe("regionBloomFraction — card-weighted rollup (mirrors rollupMastery)", () => {
    it("weights by cardsWithState", () => {
        const value = regionBloomFraction([
            { cardsWithState: 10, averageRecall: 1.0 },
            { cardsWithState: 30, averageRecall: 0.5 },
        ]);
        expect(value).toBeCloseTo((10 * 1.0 + 30 * 0.5) / 40, 10);
    });

    it("empty region reads 0, never NaN", () => {
        expect(regionBloomFraction([])).toBe(0);
        expect(regionBloomFraction([{ cardsWithState: 0, averageRecall: 0.9 }])).toBe(0);
    });
});
