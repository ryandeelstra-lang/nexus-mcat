// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: the garden economy (docs/26 G2.4; doc 23 §7). PURE functions + ONE config
// object holding every balance knob, so tuning never touches logic. Integrity (docs/26 §1):
//   I4 — currency can never buy mastery or growth; water refills come only from graded
//        answers. A wrong answer refills NOTHING extra and never grows a plant.
// Seeds were removed as a currency entirely (Decision, 2026-07-03): planting is free,
// blooms pay nothing material — the bloom itself is the reward. Water is the only
// spendable resource; XP stays cosmetic.

export interface EconomyConfig {
    startWater: number;
    waterCostPerPour: number;
    /** Water refunded per graded answer delivered at the Keeper. */
    waterPerGradedAnswer: number;
    /** XP per graded review (cosmetic level; never gates content). */
    xpPerGradedAnswer: number;
    /** Water paid for every question ANSWERED in a sector-stone trial (participation base). */
    waterPerTrialQuestion: number;
    /** Escalating "stack" bonus: each further block of 3 correct pays this much MORE than the
     *  previous block (block 1 pays 1x, block 2 pays 2x, block 3 pays 3x, …). */
    trialStackPerThreeCorrect: number;
}

/** Doc 23 §7 defaults — the single tuning surface (docs/26 R6). */
export const ECONOMY: EconomyConfig = {
    startWater: 20,
    waterCostPerPour: 1,
    waterPerGradedAnswer: 1,
    xpPerGradedAnswer: 1,
    waterPerTrialQuestion: 1,
    trialStackPerThreeCorrect: 1,
};

export interface Balances {
    water: number;
    xp: number;
}

export function initialBalances(cfg: EconomyConfig = ECONOMY): Balances {
    return { water: cfg.startWater, xp: 0 };
}

export function canWater(b: Balances, cfg: EconomyConfig = ECONOMY): boolean {
    return b.water >= cfg.waterCostPerPour;
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

// --- sector-stone trials (a short MCQ exam at each quadrant's heart) -----------------------

/**
 * The exact water payout for a finished trial:
 *   base  = +waterPerTrialQuestion for every question ANSWERED (right or wrong — you're paid
 *           for the retrieval attempt, matching onGradedAnswer/I4), and
 *   stack = an escalating bonus for correctness: each completed block of 3 correct pays one
 *           step MORE than the last (blocks pay 1,2,3,… × trialStackPerThreeCorrect), i.e.
 *           t*(t+1)/2 steps where t = floor(correct/3). A perfect 15/15 = 15 + (1+2+3+4+5).
 * Currency still never buys mastery/growth (I4). Pure so the UI can preview before crediting.
 */
export function trialWaterReward(
    correct: number,
    answered: number,
    cfg: EconomyConfig = ECONOMY,
): number {
    const safeAnswered = Math.max(0, Math.floor(answered));
    const safeCorrect = Math.max(0, Math.min(Math.floor(correct), safeAnswered));
    const base = safeAnswered * cfg.waterPerTrialQuestion;
    const blocks = Math.floor(safeCorrect / 3);
    const stack = (blocks * (blocks + 1) / 2) * cfg.trialStackPerThreeCorrect;
    return base + stack;
}

/** Credit a finished trial's water (and cosmetic XP) to the balance. */
export function onTrialCompleted(
    b: Balances,
    correct: number,
    answered: number,
    cfg: EconomyConfig = ECONOMY,
): Balances {
    const safeAnswered = Math.max(0, Math.floor(answered));
    const safeCorrect = Math.max(0, Math.min(Math.floor(correct), safeAnswered));
    return {
        ...b,
        water: b.water + trialWaterReward(safeCorrect, safeAnswered, cfg),
        xp: b.xp + safeCorrect * cfg.xpPerGradedAnswer,
    };
}

// --- voice-Keeper bucket-scaled rewards (voice spec ruling 2; doc 24 §3) ------------------

/** Duplicated literal union (state must not import panels/voice-api — both are test-pinned). */
export type VoiceBucket = "good" | "okay" | "ask_again" | "dont_know";

/** Doc 24 §3 bucket-scaled WATER rewards. */
export const VOICE_WATER_REWARD: Record<VoiceBucket, number> = {
    good: 3,
    okay: 2,
    ask_again: 1,
    dont_know: 1,
};
/** A recovered second attempt (ask-again → good/okay) pays +2 (doc 24 §13). */
const RECOVERED_REWARD = 2;

/**
 * A voice-graded answer landed in the engine. Better answers pay more water; a recovered
 * second attempt pays +2; showing up always pays at least +1. Integrity unchanged (I4):
 * currency never buys mastery or growth.
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
