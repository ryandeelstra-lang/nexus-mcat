// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: the Super Depth Analysis snapshot — every stat the garden honestly knows,
// assembled for the Overlook (the floating stats island). Read-only: the stock `graphs`
// RPC (answer times, retention, streaks), the mastery snapshot (best/worst concept with
// the give-up floor — an untouched topic reports averageRecall 0.0 and must never be
// named "worst"), the scores dashboard (memory/readiness with honest abstentions; the
// engine emits the value under `point`, NOT `value`), and the additive sidecar doc.
// A failed source degrades to "—" with an honest detail line — never a fabricated number.

import type { DashboardData, DashboardMetric } from "../panels/rpc";
import type { MasterySnapshot } from "./mastery";
import type { GardenDoc } from "./store";

export interface DepthStat {
    /** Stable id — the island maps monuments to stats by this. */
    id: string;
    /** Short label carved under the value ("Answer time"). */
    label: string;
    /** The big number on the monument ("6.2s"), or "—" when the garden can't say. */
    value: string;
    /** The Keeper-voiced walk-up line (E/Space at the monument). */
    detail: string;
}

export interface DepthStats {
    stats: DepthStat[];
    generatedAtMs: number;
}

/** Monument ring order on the Overlook (arrival is at the south rim). */
export const DEPTH_STAT_ORDER = [
    "reviews",
    "answer-time",
    "retention",
    "streak",
    "best-concept",
    "worst-concept",
    "mastery",
    "due",
    "memory",
    "readiness",
    "blooms",
    "garden",
] as const;

/** A topic must clear this floor before we name it best/worst — matches the memory
 * low-confidence threshold in scores/give_up.py (no fabricated superlatives). */
export const CONCEPT_FLOOR_CARDS = 10;

/** Structural slice of GraphsResponse (proto/anki/stats.proto) — only what we read. */
export interface ReviewsBucket {
    learn?: number;
    relearn?: number;
    young?: number;
    mature?: number;
    filtered?: number;
}

interface RetentionLike {
    youngPassed?: number;
    youngFailed?: number;
    maturePassed?: number;
    matureFailed?: number;
}

export interface GraphsLike {
    today?: { answerCount?: number; answerMillis?: number };
    /** Day-offset maps (0 = today, -1 = yesterday … bucketed by the collection rollover). */
    reviews?: {
        count?: Record<number, ReviewsBucket>;
        time?: Record<number, ReviewsBucket>;
    };
    trueRetention?: {
        today?: RetentionLike;
        week?: RetentionLike;
        allTime?: RetentionLike;
    };
}

export interface WeedEntry {
    cause: string;
    ts: number;
}

export interface DepthStatsInputs {
    graphs?: GraphsLike;
    dashboard?: DashboardData;
    snapshot?: MasterySnapshot | null;
    doc?: GardenDoc | null;
    weeds?: Record<string, WeedEntry>;
    nowMs: number;
}

function bucketSum(b: ReviewsBucket | undefined): number {
    if (!b) {
        return 0;
    }
    return (b.learn ?? 0) + (b.relearn ?? 0) + (b.young ?? 0) + (b.mature ?? 0) + (b.filtered ?? 0);
}

function mapTotal(map: Record<number, ReviewsBucket> | undefined): number {
    if (!map) {
        return 0;
    }
    let total = 0;
    for (const key of Object.keys(map)) {
        total += bucketSum(map[Number(key)]);
    }
    return total;
}

/** Consecutive study days ending today (or yesterday — an unplayed today never
 * breaks a streak). Day keys come rollover-bucketed from the engine. */
export function studyStreakDays(count: Record<number, ReviewsBucket> | undefined): number {
    if (!count) {
        return 0;
    }
    const has = (d: number): boolean => bucketSum(count[d]) > 0;
    let day = has(0) ? 0 : -1;
    let streak = 0;
    while (has(day)) {
        streak += 1;
        day -= 1;
    }
    return streak;
}

/**
 * Days since the most recent day with ANY review activity (living-decay spec
 * 2026-07-05). Day keys are engine-rollover-bucketed offsets (0 = today). Zero
 * history ⇒ 0 — never-studied is fertile soil, not neglect (doc 23 §3).
 */
export function daysSinceLastActivity(
    count: Record<number, ReviewsBucket> | undefined,
): number {
    if (!count) {
        return 0;
    }
    let latest: number | null = null;
    for (const key of Object.keys(count)) {
        const day = Number(key);
        if (bucketSum(count[day]) > 0 && (latest === null || day > latest)) {
            latest = day;
        }
    }
    if (latest === null) {
        return 0;
    }
    const result = -latest;
    return result === 0 ? 0 : result; // Ensure -0 becomes 0
}

/** True-retention fraction (young+mature passed over attempted), or null when nothing
 * was attempted — an empty log has no retention, not 0%. */
export function retentionFraction(r: RetentionLike | undefined): number | null {
    if (!r) {
        return null;
    }
    const passed = (r.youngPassed ?? 0) + (r.maturePassed ?? 0);
    const failed = (r.youngFailed ?? 0) + (r.matureFailed ?? 0);
    if (passed + failed === 0) {
        return null;
    }
    return passed / (passed + failed);
}

function formatSeconds(ms: number): string {
    return `${(ms / 1000).toFixed(1)}s`;
}

function formatPct(fraction: number): string {
    return `${Math.round(fraction * 100)}%`;
}

/** The dashboard engine emits the metric value under `point` (scores/display.py);
 * the older `value` key is read as a fallback only. */
export function metricPoint(metric: DashboardMetric | null | undefined): number | null {
    if (!metric) {
        return null;
    }
    const point = metric["point"];
    if (typeof point === "number") {
        return point;
    }
    if (typeof metric.value === "number") {
        return metric.value;
    }
    return null;
}

function metricRange(metric: DashboardMetric | null | undefined): [number, number] | null {
    const range = metric?.range;
    if (
        Array.isArray(range) && range.length === 2
        && typeof range[0] === "number" && typeof range[1] === "number"
    ) {
        return [range[0], range[1]];
    }
    return null;
}

function asCount(value: unknown): number | null {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}

const UNKNOWN: Omit<DepthStat, "id" | "label"> = {
    value: "—",
    detail: "The garden can't see this number right now.",
};

/** Assemble the full Overlook snapshot. Pure — every source is optional and a missing
 * one degrades to an honest "—", so a dead bridge never fabricates a stat. */
export function assembleDepthStats(inputs: DepthStatsInputs): DepthStats {
    const { graphs, dashboard, snapshot, doc, weeds } = inputs;
    const stats: DepthStat[] = [];
    const push = (id: string, label: string, partial?: Partial<DepthStat>): void => {
        stats.push({ id, label, ...UNKNOWN, ...partial });
    };

    // Reviews + answer time + retention + streak — the review-log family.
    const totalReviews = mapTotal(graphs?.reviews?.count);
    const totalTimeMs = mapTotal(graphs?.reviews?.time);
    const todayCount = graphs?.today?.answerCount ?? 0;
    const todayMs = graphs?.today?.answerMillis ?? 0;
    if (graphs?.reviews?.count) {
        push("reviews", "Reviews given", {
            value: `${totalReviews}`,
            detail: totalReviews > 0
                ? `You've answered ${totalReviews} cards in all — ${todayCount} today. `
                    + `Every one of them watered this garden.`
                : "No reviews yet — the Keeper is waiting at the gazebo.",
        });
    } else {
        push("reviews", "Reviews given");
    }

    if (totalReviews > 0) {
        const todayLine = todayCount > 0
            ? ` Today you're averaging ${formatSeconds(todayMs / todayCount)} over ${todayCount} answers.`
            : "";
        push("answer-time", "Answer time", {
            value: formatSeconds(totalTimeMs / totalReviews),
            detail: `${formatSeconds(totalTimeMs / totalReviews)} per card across `
                + `${totalReviews} answers, lifetime.${todayLine}`,
        });
    } else {
        push("answer-time", "Answer time", {
            detail: "No answers yet — answer at the Keeper and this stone wakes up.",
        });
    }

    const allTime = retentionFraction(graphs?.trueRetention?.allTime);
    if (allTime !== null) {
        const week = retentionFraction(graphs?.trueRetention?.week);
        const today = retentionFraction(graphs?.trueRetention?.today);
        const parts = [`${formatPct(allTime)} of reviews come back remembered, all-time.`];
        if (week !== null) {
            parts.push(`This week: ${formatPct(week)}.`);
        }
        if (today !== null) {
            parts.push(`Today: ${formatPct(today)}.`);
        }
        push("retention", "True retention", {
            value: formatPct(allTime),
            detail: parts.join(" "),
        });
    } else {
        push("retention", "True retention", {
            detail: "No graded reviews to measure yet — retention grows from real answers.",
        });
    }

    const streak = studyStreakDays(graphs?.reviews?.count);
    push(
        "streak",
        "Study streak",
        streak > 0
            ? {
                value: `${streak}d`,
                detail: `You've tended the garden ${streak} day${streak === 1 ? "" : "s"} in a row.`,
            }
            : { detail: "Tend the garden today and a streak takes root." },
    );

    // Best / worst concept — floored so an untouched topic is never named.
    const topics = snapshot?.topics ?? [];
    const eligible = topics.filter((t) => t.cardsWithState >= CONCEPT_FLOOR_CARDS && t.gradedReviews > 0);
    if (eligible.length > 0) {
        const best = eligible.reduce((a, b) => (b.averageRecall > a.averageRecall ? b : a));
        const worst = eligible.reduce((a, b) => (b.averageRecall < a.averageRecall ? b : a));
        push("best-concept", "Deepest roots", {
            value: best.label,
            detail: `${best.label} — ${formatPct(best.averageRecall)} memory across `
                + `${best.cardsWithState} cards. Your strongest ground.`,
        });
        push("worst-concept", "Thirstiest patch", {
            value: worst.label,
            detail: `${worst.label} holds ${formatPct(worst.averageRecall)} memory across `
                + `${worst.cardsWithState} cards. Water here next.`,
        });
    } else {
        const why = `The garden names favorites only after ${CONCEPT_FLOOR_CARDS}+ cards `
            + `of a topic have real memory state.`;
        push("best-concept", "Deepest roots", { detail: `Still getting to know you. ${why}` });
        push("worst-concept", "Thirstiest patch", { detail: `Still getting to know you. ${why}` });
    }

    if (topics.length > 0) {
        const mastered = topics.reduce((n, t) => n + t.masteredCount, 0);
        const total = topics.reduce((n, t) => n + t.totalCards, 0);
        const touched = topics.reduce((n, t) => n + t.cardsWithState, 0);
        push("mastery", "Cards mastered", {
            value: `${mastered}/${total}`,
            detail: `${mastered} of ${total} cards sit above the mastery line; `
                + `${touched} carry real memory state across ${topics.length} topics.`,
        });
        const due = topics.reduce((n, t) => n + t.dueCount, 0);
        const fresh = topics.reduce((n, t) => n + t.newCount, 0);
        push("due", "Due now", {
            value: `${due}`,
            detail: `${due} cards ask for water right now; ${fresh} new seeds wait in the soil.`,
        });
    } else {
        push("mastery", "Cards mastered");
        push("due", "Due now");
    }

    // Dashboard: memory + readiness — the engine abstains honestly, and so do we.
    const memory = dashboard?.memory ?? null;
    const memoryPoint = memory?.available === false ? null : metricPoint(memory);
    if (memoryPoint !== null) {
        const range = metricRange(memory);
        const rangeLine = range ? ` Likely between ${formatPct(range[0])} and ${formatPct(range[1])}.` : "";
        const confidence = typeof memory?.confidence === "string" ? memory.confidence : null;
        push("memory", "Memory", {
            value: formatPct(memoryPoint),
            detail: `The engine expects ${formatPct(memoryPoint)} of your cards to come back `
                + `if asked now.${rangeLine}${confidence ? ` Confidence: ${confidence}.` : ""}`,
        });
    } else {
        push("memory", "Memory", {
            detail: typeof memory?.reason === "string"
                ? memory.reason
                : "The memory model needs more real answers before it will speak.",
        });
    }

    const readiness = dashboard?.readiness ?? null;
    const readinessPoint = readiness?.available === false ? null : metricPoint(readiness);
    if (readinessPoint !== null) {
        const range = metricRange(readiness);
        push("readiness", "Readiness", {
            value: `${Math.round(readinessPoint)}`,
            detail: range
                ? `Projected ${Math.round(readinessPoint)}, likely between ${Math.round(range[0])} `
                    + `and ${Math.round(range[1])}.`
                : `Projected ${Math.round(readinessPoint)}.`,
        });
    } else {
        const graded = asCount(readiness?.["graded_reviews"]);
        const gradedNeed = asCount(readiness?.["graded_reviews_required"]) ?? 1000;
        const gates = asCount(dashboard?.coverage?.gate_covered);
        const gatesTotal = asCount(dashboard?.coverage?.gate_total) ?? 31;
        const progress = graded !== null ? ` ${graded}/${gradedNeed} reviews` : "";
        const gateLine = gates !== null ? `, gates ${gates}/${gatesTotal}` : "";
        push("readiness", "Readiness", {
            detail: `Still growing —${progress}${gateLine}. The barn refuses to guess.`,
        });
    }

    // Sidecar: blooms/weeds + garden wealth.
    if (doc) {
        const blooms = Object.keys(doc.paraphrase).length;
        const weedEntries = Object.values(weeds ?? {});
        const causes = weedEntries.map((w) => w.cause);
        const causeLine = causes.length > 0 ? ` (${[...new Set(causes)].join(", ")})` : "";
        push("blooms", "Blooms proven", {
            value: `${blooms}`,
            detail: `${blooms} concept${blooms === 1 ? "" : "s"} explained in your own words. `
                + `${weedEntries.length} weed${weedEntries.length === 1 ? "" : "s"} active${causeLine}.`,
        });
        const patches = Object.keys(doc.flora).length;
        const pours = Object.values(doc.flora).reduce((n, p) => n + p, 0);
        push("garden", "Ground watered", {
            value: `${patches}`,
            detail: `💧${doc.economy.water} water · ${doc.economy.xp} XP. `
                + `You've watered ${patches} patch${patches === 1 ? "" : "es"} of ground with ${pours} pours.`,
        });
    } else {
        push("blooms", "Blooms proven");
        push("garden", "Ground watered");
    }

    return { stats, generatedAtMs: inputs.nowMs };
}

/** Anki search scoping every review-log stat to the garden's deck subtree. */
export const DEPTH_DECK_SEARCH = "deck:MCAT";

/**
 * Fetch + assemble the live snapshot. Bridges are imported lazily so this module
 * stays unit-testable without the generated backend. Each source may fail
 * independently — assembly degrades per-stat.
 */
export async function fetchDepthStats(deps: {
    snapshot: MasterySnapshot | null;
    doc: GardenDoc | null;
    weeds: Record<string, WeedEntry>;
}): Promise<DepthStats> {
    const [graphsRes, dashboardRes] = await Promise.allSettled([
        import("@generated/backend").then((backend) =>
            backend.graphs({ search: DEPTH_DECK_SEARCH, days: 0 }, { alertOnError: false })
        ),
        import("../panels/rpc").then((rpc) => rpc.fetchDashboard()),
    ]);
    return assembleDepthStats({
        graphs: graphsRes.status === "fulfilled" ? graphsRes.value as GraphsLike : undefined,
        dashboard: dashboardRes.status === "fulfilled" ? dashboardRes.value : undefined,
        snapshot: deps.snapshot,
        doc: deps.doc,
        weeds: deps.weeds,
        nowMs: Date.now(),
    });
}

/**
 * Just the revlog day-buckets, for the decay layer (read-only `graphs` RPC —
 * the same call the Overlook makes). Fails toward pristine: any error ⇒
 * undefined ⇒ daysAway 0 ⇒ no overgrowth. Never fabricate neglect.
 */
export async function fetchActivityDayBuckets(): Promise<
    Record<number, ReviewsBucket> | undefined
> {
    try {
        const backend = await import("@generated/backend");
        const res = await backend.graphs(
            { search: DEPTH_DECK_SEARCH, days: 0 },
            { alertOnError: false },
        ) as GraphsLike;
        return res.reviews?.count;
    } catch {
        return undefined;
    }
}
