// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: the pure growth-stage mapping (docs/26 G1.2; doc 23 §8). Every plant's sprite
// derives from ENGINE TRUTH through this one function — no other path may set a stage.
// The integrity rules it encodes (docs/26 §1):
//   I3 — "bloomed" REQUIRES a paraphrase-gate pass; strong memory alone caps at "budding".
//   I4 — growth comes only from graded reviews (all inputs here are engine-derived).
import type { TopicMastery } from "./mastery";

export type GrowthStage =
    | "bare-soil"
    | "sprout"
    | "seedling"
    | "growing"
    | "budding"
    | "bloomed"
    | "drooping"
    | "weedy";

/** Stage order for sprite lookup + tests (indices match the sliced stage sheet). */
export const STAGE_ORDER: readonly GrowthStage[] = [
    "bare-soil",
    "sprout",
    "seedling",
    "growing",
    "budding",
    "bloomed",
    "drooping",
    "weedy",
];

export interface StageInputs {
    /** Engine truth for the topic (masteryQuery + deckTree join). */
    topic: Pick<
        TopicMastery,
        "totalCards" | "cardsWithState" | "averageRecall" | "gradedReviews" | "dueCount"
    >;
    /** Paraphrase-gate pass recorded for this topic (garden store <- sidecar truth). */
    paraphrasePassed: boolean;
    /** An unrepaired weed (error-cause tag) is active on this topic. */
    hasActiveWeed: boolean;
}

/** Retrievability at/above this = strong memory (mirrors the engine's mastered threshold). */
export const STRONG_MEMORY = 0.9;
/** Retrievability at/above this with some history = actively growing. */
export const GROWING_RECALL = 0.6;

/**
 * Map engine truth onto the 8 visual stages (doc 23 §8).
 *
 * Precedence (highest first): weedy > drooping > bloomed > budding > growing > seedling
 * > sprout > bare-soil. Weeds/droop are *care states* — they must stay visible even on
 * strong topics, or the "knowledge fades / misses become assignments" loop disappears.
 * Bloom survives droop-precedence only when nothing is due and no weed is active, which
 * is exactly "the garden only stays lit through real upkeep."
 */
export function stageFor(inputs: StageInputs): GrowthStage {
    const { topic, paraphrasePassed, hasActiveWeed } = inputs;

    if (topic.cardsWithState === 0 && topic.gradedReviews === 0) {
        return "bare-soil";
    }
    if (hasActiveWeed) {
        return "weedy";
    }
    if (topic.dueCount > 0) {
        return "drooping";
    }
    if (topic.averageRecall >= STRONG_MEMORY) {
        return paraphrasePassed ? "bloomed" : "budding";
    }
    if (topic.averageRecall >= GROWING_RECALL && topic.gradedReviews > 0) {
        return "growing";
    }
    if (topic.gradedReviews > 0) {
        return "seedling";
    }
    // Cards have FSRS state but no graded review rows yet (e.g. freshly imported deck
    // with scheduling): the seed is in the ground.
    return "sprout";
}

/** Region rollup: card-weighted mean recall (mirrors rollupMastery in graph-render.ts). */
export function regionBloomFraction(
    topics: ReadonlyArray<Pick<TopicMastery, "cardsWithState" | "averageRecall">>,
): number {
    let weight = 0;
    let sum = 0;
    for (const t of topics) {
        if (t.cardsWithState > 0) {
            weight += t.cardsWithState;
            sum += t.averageRecall * t.cardsWithState;
        }
    }
    return weight === 0 ? 0 : sum / weight;
}
