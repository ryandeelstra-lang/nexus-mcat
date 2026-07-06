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
    | "flourishing"
    | "radiant"
    | "weedy";

/** Stage order for sprite lookup + tests (indices match the sliced stage sheet filenames). */
export const STAGE_ORDER: readonly GrowthStage[] = [
    "bare-soil",
    "sprout",
    "seedling",
    "growing",
    "budding",
    "bloomed",
    "flourishing",
    "radiant",
    "weedy",
];

/**
 * Every stage that counts as a paraphrase-proven bloom (I3). Anything keyed on
 * "the plant has bloomed" — gate opening, bloom glow — must use this set, not
 * `=== "bloomed"`, or the post-bloom tiers would silently close gates again.
 */
export const BLOOMED_TIER: ReadonlySet<GrowthStage> = new Set([
    "bloomed",
    "flourishing",
    "radiant",
]);

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
/** Bloomed topics at/above this recall with enough proven reviews keep flourishing. */
export const FLOURISHING_RECALL = 0.95;
export const FLOURISHING_REVIEWS = 12;
/** The pinnacle: near-perfect recall sustained across a deep review history. */
export const RADIANT_RECALL = 0.97;
export const RADIANT_REVIEWS = 24;

/**
 * Map engine truth onto the 9 visual stages (doc 23 §8; ladder extended 2026-07-03;
 * wilting/drooping removed 2026-07-05 — plants never wilt).
 *
 * Precedence (highest first): weedy > radiant > flourishing > bloomed > budding
 * > growing > seedling > sprout > bare-soil. `weedy` is the one remaining *care
 * state* (the error-cause mechanism, doc 18) and outranks the growth ladder; due
 * cards no longer pull a plant down a "drooping" state — a plant simply shows the
 * stage its memory has earned. The post-bloom tiers (flourishing, radiant) still
 * require the paraphrase pass (I3) — they are earned by *keeping* a bloomed topic
 * strong, so every input stays engine-derived (I4). A topic with cards but zero
 * graded reviews collapses to "bare-soil" (invisible) rather than "sprout" — nothing
 * has been earned yet, so nothing renders (2026-07-05).
 */
export function stageFor(inputs: StageInputs): GrowthStage {
    const { topic, paraphrasePassed, hasActiveWeed } = inputs;

    if (topic.cardsWithState === 0 && topic.gradedReviews === 0) {
        return "bare-soil";
    }
    if (hasActiveWeed) {
        return "weedy";
    }
    if (topic.averageRecall >= STRONG_MEMORY) {
        if (!paraphrasePassed) {
            return "budding";
        }
        if (topic.averageRecall >= RADIANT_RECALL && topic.gradedReviews >= RADIANT_REVIEWS) {
            return "radiant";
        }
        if (
            topic.averageRecall >= FLOURISHING_RECALL
            && topic.gradedReviews >= FLOURISHING_REVIEWS
        ) {
            return "flourishing";
        }
        return "bloomed";
    }
    if (topic.averageRecall >= GROWING_RECALL && topic.gradedReviews > 0) {
        return "growing";
    }
    if (topic.gradedReviews > 0) {
        return "seedling";
    }
    // Cards have FSRS state but no graded review rows yet (e.g. freshly imported deck
    // with scheduling): nothing has been earned yet, so the plot stays invisible —
    // same as a topic with no cards at all (2026-07-05: the dirt-hole sprout sprite
    // was the "used to be wilting" spot; removed rather than replacing one eyesore
    // with another).
    return "bare-soil";
}

/** Region rollup: card-weighted mean recall across a region's topics. */
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
