// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: the garden economy (docs/26 G2.4; doc 23 §7). PURE functions + ONE config
// object holding every balance knob, so tuning never touches logic. Integrity (docs/26 §1):
//   I4 — currency can never buy mastery or growth; refills come only from graded answers
//        (water) and paraphrase-gate blooms (seeds). A wrong answer refills NOTHING extra
//        and never grows a plant.

export interface EconomyConfig {
    startSeeds: number;
    startWater: number;
    plantCostSeeds: number;
    waterCostPerPour: number;
    /** Water refunded per graded answer delivered at the Keeper. */
    waterPerGradedAnswer: number;
    /** Seeds paid out when a plant blooms (paraphrase pass). */
    seedsPerBloom: number;
    /** XP per graded review (cosmetic level; never gates content). */
    xpPerGradedAnswer: number;
}

/** Doc 23 §7 defaults — the single tuning surface (docs/26 R6). */
export const ECONOMY: EconomyConfig = {
    startSeeds: 40,
    startWater: 80,
    plantCostSeeds: 1,
    waterCostPerPour: 1,
    waterPerGradedAnswer: 1,
    seedsPerBloom: 5,
    xpPerGradedAnswer: 1,
};

export interface Balances {
    seeds: number;
    water: number;
    xp: number;
}

export function initialBalances(cfg: EconomyConfig = ECONOMY): Balances {
    return { seeds: cfg.startSeeds, water: cfg.startWater, xp: 0 };
}

export function canPlant(b: Balances, cfg: EconomyConfig = ECONOMY): boolean {
    return b.seeds >= cfg.plantCostSeeds;
}

export function canWater(b: Balances, cfg: EconomyConfig = ECONOMY): boolean {
    return b.water >= cfg.waterCostPerPour;
}

/** Spend a seed to plant (queue a topic's intro cards). Throws if broke — callers gate on canPlant. */
export function spendPlant(b: Balances, cfg: EconomyConfig = ECONOMY): Balances {
    if (!canPlant(b, cfg)) {
        throw new Error("not enough seeds");
    }
    return { ...b, seeds: b.seeds - cfg.plantCostSeeds };
}

/** Spend water on a pour (queue one topic's next questions). */
export function spendWater(b: Balances, cfg: EconomyConfig = ECONOMY): Balances {
    if (!canWater(b, cfg)) {
        throw new Error("not enough water");
    }
    return { ...b, water: b.water - cfg.waterCostPerPour };
}

/**
 * A graded answer landed in the engine (the ONLY refill path for water — I4).
 * Refills the same for right and wrong answers: the retrieval attempt is the work being
 * paid for; growth (a different system) is what wrong answers never earn.
 */
export function onGradedAnswer(b: Balances, cfg: EconomyConfig = ECONOMY): Balances {
    return {
        ...b,
        water: b.water + cfg.waterPerGradedAnswer,
        xp: b.xp + cfg.xpPerGradedAnswer,
    };
}

/** A plant bloomed (paraphrase pass — the ONLY seed refill path). */
export function onBloom(b: Balances, cfg: EconomyConfig = ECONOMY): Balances {
    return { ...b, seeds: b.seeds + cfg.seedsPerBloom };
}

/** Mirrors voice-api's VoiceBucket — kept as a local literal union so the state layer
 * never imports from panels (both sides are pinned by tests). */
export type VoiceBucket = "good" | "okay" | "ask_again" | "dont_know";

/** Doc 24 §3 bucket-scaled WATER rewards (voice-Keeper spec ruling 2). Seeds still come
 * only from blooms. */
export const VOICE_WATER_REWARD: Record<VoiceBucket, number> = {
    good: 3,
    okay: 2,
    ask_again: 1,
    dont_know: 1,
};
const RECOVERED_REWARD = 2;

/**
 * A voice-graded answer landed in the engine. Better answers pay more water; a recovered
 * second attempt pays +2 (doc 24 §13 "recovered"); showing up always pays at least +1.
 * Integrity unchanged (I4): currency never buys mastery or growth.
 */
export function onVoiceGradedAnswer(
    b: Balances,
    bucket: VoiceBucket,
    recovered: boolean,
    cfg: EconomyConfig = ECONOMY,
): Balances {
    const reward = recovered && (bucket === "good" || bucket === "okay")
        ? RECOVERED_REWARD
        : VOICE_WATER_REWARD[bucket];
    return { ...b, water: b.water + reward, xp: b.xp + cfg.xpPerGradedAnswer };
}
