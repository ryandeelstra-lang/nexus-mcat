// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: the garden gnome's one-a-day encouragement (feature 2026-07-05). A PURE,
// positive-ONLY insight selector: given the mastery snapshot (the graph/analytics truth) +
// the additive doc (+ optional review-log analytics), it returns ONE true, specific,
// encouraging line for the day. The little wandering gardener (game/gardener.ts) speaks it
// silently in a proximity bubble — it never talks TO the player.
//
// Design ruling (Ryan, 2026-07-05): the gnome celebrates only REAL wins the garden can see —
// it never names a weakness. Every candidate here is a genuine, earned, honest positive
// (floored like depth-stats so an untouched topic is never praised), and the pick is
// deterministic per ISO day (no Math.random — that would reshuffle the "one per day" line on
// every frame and let the same day drift), so the daily gate can persist exactly one.

import type { MasterySnapshot } from "./mastery";
import type { GardenDoc } from "./store";

/** Optional review-log analytics — the app passes them when it has them; the selector
 *  degrades gracefully to snapshot+doc signals when it doesn't. */
export interface GardenerAnalytics {
    streakDays?: number;
    /** 0..100 true-retention percentage. */
    retentionPct?: number;
    todayReviews?: number;
}

export interface GardenerInsightInputs {
    snapshot: MasterySnapshot | null;
    doc: GardenDoc | null;
    analytics?: GardenerAnalytics;
    /** ISO YYYY-MM-DD "today" — seeds the daily pick so it's stable within a day. */
    dateIso: string;
    /** The line shown last time — skipped when another option exists, so days feel fresh. */
    lastText?: string;
}

export interface GardenerInsight {
    dateIso: string;
    text: string;
}

/** Match depth-stats' give-up floor (CONCEPT_FLOOR_CARDS) — never celebrate a topic we
 *  barely know, exactly as the Overlook refuses to name a favourite too early. */
const CONCEPT_FLOOR_CARDS = 10;
/** A patch must clear this recall to be called "thriving" — a genuine win, not faint praise. */
const THRIVING_RECALL = 0.75;

function pct(fraction: number): string {
    return `${Math.round(fraction * 100)}%`;
}

/** Deterministic non-negative hash of the ISO date — same day → same pick. */
function daySeed(dateIso: string): number {
    let h = 0;
    for (let i = 0; i < dateIso.length; i++) {
        h = (h * 31 + dateIso.charCodeAt(i)) | 0;
    }
    return Math.abs(h);
}

/** Every earned, positive line the garden can honestly say today. Order is stable so the
 *  day-seed maps consistently; only lines whose signal is genuinely earned are included. */
export function gardenerCandidates(inputs: GardenerInsightInputs): string[] {
    const out: string[] = [];
    const topics = inputs.snapshot?.topics ?? [];
    const a = inputs.analytics ?? {};

    // Streak — the single most encouraging habit signal.
    if ((a.streakDays ?? 0) >= 2) {
        out.push(
            `${a.streakDays} days in a row you've shown up here. That streak is the whole `
                + `secret — keep it alive 🔆`,
        );
    }

    // Deepest roots — the strongest genuinely-known patch (floored, and only if truly high).
    const eligible = topics.filter(
        (t) => t.cardsWithState >= CONCEPT_FLOOR_CARDS && t.gradedReviews > 0,
    );
    if (eligible.length > 0) {
        const best = eligible.reduce((x, y) => (y.averageRecall > x.averageRecall ? y : x));
        if (best.averageRecall >= THRIVING_RECALL) {
            out.push(
                `Your ${best.label} patch is thriving — ${pct(best.averageRecall)} memory across `
                    + `${best.cardsWithState} cards. That's beautiful ground you've grown 🌸`,
            );
        }
    }

    // Retention — what you plant keeps coming back.
    if ((a.retentionPct ?? 0) >= 80) {
        out.push(
            `${a.retentionPct}% of what you plant here comes back remembered. Your roots hold — `
                + `trust them 💚`,
        );
    }

    // Cards mastered.
    const mastered = topics.reduce((n, t) => n + t.masteredCount, 0);
    if (mastered > 0) {
        out.push(
            `${mastered} card${mastered === 1 ? "" : "s"} now sit above the mastery line. `
                + `Every one of them was you, showing up 🌱`,
        );
    }

    // Blooms proven (paraphrase passes) — explained in your own words.
    const blooms = inputs.doc ? Object.keys(inputs.doc.paraphrase).length : 0;
    if (blooms > 0) {
        out.push(
            `You've explained ${blooms} concept${blooms === 1 ? "" : "s"} in your own words. `
                + `That's not memorising — that's understanding taking root ✨`,
        );
    }

    // Breadth — tending many corners rather than cramming one bed.
    const touched = topics.filter((t) => t.cardsWithState > 0).length;
    if (touched >= 3) {
        out.push(
            `You've tended ${touched} different corners of the garden. You're not cramming one `
                + `bed — you're growing something whole 🌿`,
        );
    }

    // All caught up — nothing thirsty right now.
    const due = topics.reduce((n, t) => n + t.dueCount, 0);
    if (touched > 0 && due === 0) {
        out.push(
            `Not one patch is thirsty right now. You're right on top of this garden — enjoy the `
                + `quiet 💧`,
        );
    }

    // Today's effort.
    if ((a.todayReviews ?? 0) >= 10) {
        out.push(
            `${a.todayReviews} answers already today. The garden felt every one of them — `
                + `lovely work 🌷`,
        );
    }

    return out;
}

/** The always-true fallbacks — used when the garden is too new to have an earned win yet.
 *  Still warm, still honest, never a fabricated stat. */
export const GARDENER_FALLBACKS: readonly string[] = [
    "Every gardener starts with a single seed. You showed up today — that's how gardens grow 🌱",
    "A quiet garden is still a garden. Plant one card today and something in here wakes 🌿",
    "The best time to plant was yesterday. The second best is right now — glad you're here ✨",
];

/** Pick THE one encouraging line for the day: deterministic per ISO date, positive-only, and
 *  — when there's a choice — never the same line as last time. Always returns a line. */
export function pickGardenerInsight(inputs: GardenerInsightInputs): GardenerInsight {
    const earned = gardenerCandidates(inputs);
    const pool = earned.length > 0 ? earned : [...GARDENER_FALLBACKS];
    const seed = daySeed(inputs.dateIso);
    let idx = seed % pool.length;
    if (pool.length > 1 && pool[idx] === inputs.lastText) {
        idx = (idx + 1) % pool.length;
    }
    return { dateIso: inputs.dateIso, text: pool[idx] };
}
