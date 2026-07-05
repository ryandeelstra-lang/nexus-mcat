// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: G1.2 gate — the growth-stage mapping table-tested across all 10 stages +
// boundaries (docs/26 G1 exit gate; ladder extended 2026-07-03). These pin the integrity
// rules: I3 bloom (and every post-bloom tier) REQUIRES the paraphrase pass; I4 growth
// only from engine truth.
import { describe, expect, it } from "vitest";

import {
    FLOURISHING_REVIEWS,
    RADIANT_REVIEWS,
    regionBloomFraction,
    STAGE_ORDER,
    stageFor,
    type StageInputs,
    WILT_LIGHT_RECALL,
    WILT_HEAVY_RECALL,
    wiltLevelFor,
} from "./stage";

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

describe("stageFor — the 10 stages (doc 23 §8)", () => {
    it("the ladder is exactly 10 stages, in sprite-sheet order", () => {
        expect(STAGE_ORDER).toEqual([
            "bare-soil",
            "sprout",
            "seedling",
            "growing",
            "budding",
            "bloomed",
            "flourishing",
            "radiant",
            "drooping",
            "weedy",
        ]);
    });

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

    it("flourishing: a bloomed topic kept strong (recall >= 0.95 across >= 12 reviews)", () => {
        expect(
            stageFor(
                inputs({
                    cardsWithState: 8,
                    gradedReviews: FLOURISHING_REVIEWS,
                    averageRecall: 0.95,
                    paraphrasePassed: true,
                }),
            ),
        ).toBe("flourishing");
    });

    it("radiant: the pinnacle — near-perfect recall sustained across a deep history", () => {
        expect(
            stageFor(
                inputs({
                    cardsWithState: 8,
                    gradedReviews: RADIANT_REVIEWS,
                    averageRecall: 0.97,
                    paraphrasePassed: true,
                }),
            ),
        ).toBe("radiant");
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

    it("I3: the post-bloom tiers are unreachable without the paraphrase pass — even at 0.99", () => {
        expect(
            stageFor(
                inputs({
                    cardsWithState: 8,
                    gradedReviews: RADIANT_REVIEWS * 4,
                    averageRecall: 0.99,
                    paraphrasePassed: false,
                }),
            ),
        ).toBe("budding");
    });

    it("high recall without the review depth stays bloomed (tiers are EARNED by history)", () => {
        expect(
            stageFor(
                inputs({
                    cardsWithState: 8,
                    gradedReviews: FLOURISHING_REVIEWS - 1,
                    averageRecall: 0.99,
                    paraphrasePassed: true,
                }),
            ),
        ).toBe("bloomed");
    });

    it("flourishing depth without radiant recall stays flourishing", () => {
        expect(
            stageFor(
                inputs({
                    cardsWithState: 8,
                    gradedReviews: RADIANT_REVIEWS,
                    averageRecall: 0.96,
                    paraphrasePassed: true,
                }),
            ),
        ).toBe("flourishing");
    });

    it("care states outrank the pinnacle: a due card droops even a radiant plant", () => {
        expect(
            stageFor(
                inputs({
                    cardsWithState: 8,
                    gradedReviews: RADIANT_REVIEWS,
                    averageRecall: 0.99,
                    paraphrasePassed: true,
                    dueCount: 1,
                }),
            ),
        ).toBe("drooping");
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

describe("wiltLevelFor — graded wilt by retrievability (living-decay 2026-07-05)", () => {
    it("level 1 (light lean) while recall is still fresh (≥ 0.75)", () => {
        expect(wiltLevelFor({ averageRecall: 0.9 })).toBe(1);
        expect(wiltLevelFor({ averageRecall: WILT_LIGHT_RECALL })).toBe(1);
    });
    it("level 2 (droop) between 0.5 and 0.75", () => {
        expect(wiltLevelFor({ averageRecall: 0.7499 })).toBe(2);
        expect(wiltLevelFor({ averageRecall: WILT_HEAVY_RECALL })).toBe(2);
    });
    it("level 3 (heavy wilt) below 0.5 — days into the curve", () => {
        expect(wiltLevelFor({ averageRecall: 0.4999 })).toBe(3);
        expect(wiltLevelFor({ averageRecall: 0 })).toBe(3);
    });
});
