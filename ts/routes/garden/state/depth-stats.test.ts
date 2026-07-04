// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: the Super Depth Analysis assembler — the honesty rules under test:
// floors before superlatives (an untouched topic is never "worst"), `point` (not
// `value`) from the dashboard engine, streaks that respect rollover day-offsets,
// and "—" (never a fabricated number) when a source is missing.
import { describe, expect, it } from "vitest";

import type { TopicMastery } from "./mastery";
import {
    assembleDepthStats,
    CONCEPT_FLOOR_CARDS,
    DEPTH_STAT_ORDER,
    metricPoint,
    retentionFraction,
    studyStreakDays,
} from "./depth-stats";
import { emptyDoc } from "./store";

function mkTopic(partial: Partial<TopicMastery> & { nodeId: string }): TopicMastery {
    return {
        deckPath: `MCAT::X::${partial.nodeId}`,
        label: partial.nodeId,
        section: "B-B",
        totalCards: 100,
        cardsWithState: 0,
        masteredCount: 0,
        averageRecall: 0,
        gradedReviews: 0,
        dueCount: 0,
        newCount: 0,
        ...partial,
    };
}

function mkSnapshot(topics: TopicMastery[]) {
    return {
        topics,
        byNode: new Map(topics.map((t) => [t.nodeId, t])),
        byDeckPath: new Map(topics.map((t) => [t.deckPath, t])),
        fetchedAtMs: 1,
    };
}

function statById(stats: ReturnType<typeof assembleDepthStats>, id: string) {
    const stat = stats.stats.find((s) => s.id === id);
    expect(stat, `stat ${id} present`).toBeDefined();
    return stat!;
}

describe("assembleDepthStats — shape", () => {
    it("always yields every stat in monument-ring order", () => {
        const stats = assembleDepthStats({ nowMs: 5 });
        expect(stats.stats.map((s) => s.id)).toEqual([...DEPTH_STAT_ORDER]);
        expect(stats.generatedAtMs).toBe(5);
    });

    it("degrades to honest em-dashes when every source is missing", () => {
        const stats = assembleDepthStats({ nowMs: 1 });
        for (const stat of stats.stats) {
            expect(stat.value).toBe("—");
            expect(stat.detail.length).toBeGreaterThan(0);
        }
    });
});

describe("review-log stats (graphs)", () => {
    const graphs = {
        today: { answerCount: 2, answerMillis: 4000 },
        reviews: {
            count: {
                0: { learn: 1, young: 1 },
                [-1]: { mature: 2 },
                [-3]: { learn: 5 },
            },
            time: {
                0: { learn: 5000, young: 7400 },
                [-1]: { mature: 12400 },
                [-3]: { learn: 25000 },
            },
        },
        trueRetention: {
            allTime: { youngPassed: 6, youngFailed: 1, maturePassed: 2, matureFailed: 1 },
            week: { youngPassed: 4, youngFailed: 1, maturePassed: 0, matureFailed: 0 },
            today: { youngPassed: 1, youngFailed: 1, maturePassed: 0, matureFailed: 0 },
        },
    };
    const stats = assembleDepthStats({ graphs, nowMs: 1 });

    it("totals reviews across every day and bucket", () => {
        expect(statById(stats, "reviews").value).toBe("9");
        expect(statById(stats, "reviews").detail).toContain("2 today");
    });

    it("averages answer time from summed taken-millis over counts", () => {
        // (5000+7400+12400+25000) / 9 = 5533ms
        expect(statById(stats, "answer-time").value).toBe("5.5s");
        // Today: 4000/2 = 2.0s
        expect(statById(stats, "answer-time").detail).toContain("2.0s");
    });

    it("reports true retention with all-time / week / today", () => {
        const retention = statById(stats, "retention");
        expect(retention.value).toBe("80%"); // 8 passed / 10 attempted
        expect(retention.detail).toContain("80%");
        expect(retention.detail).toContain("Today: 50%");
    });

    it("walks the streak over consecutive day offsets (gap at -2 stops it)", () => {
        expect(statById(stats, "streak").value).toBe("2d");
    });

    it("keeps a streak alive when today has no reviews yet", () => {
        expect(studyStreakDays({ [-1]: { learn: 1 }, [-2]: { mature: 1 } })).toBe(2);
        expect(studyStreakDays({})).toBe(0);
    });

    it("has no retention (not 0%) for an empty log", () => {
        expect(retentionFraction({})).toBeNull();
        expect(retentionFraction(undefined)).toBeNull();
        const empty = assembleDepthStats({ graphs: { reviews: { count: {}, time: {} } }, nowMs: 1 });
        expect(statById(empty, "retention").value).toBe("—");
        expect(statById(empty, "answer-time").value).toBe("—");
        expect(statById(empty, "reviews").value).toBe("0");
    });
});

describe("best/worst concept — the give-up floor", () => {
    it("names best and worst only among floored topics", () => {
        const topics = [
            mkTopic({ nodeId: "Strong", cardsWithState: 20, gradedReviews: 30, averageRecall: 0.91 }),
            mkTopic({ nodeId: "Weak", cardsWithState: 15, gradedReviews: 12, averageRecall: 0.22 }),
            // The trap: untouched topic reports averageRecall 0.0 — must never be named.
            mkTopic({ nodeId: "Untouched", cardsWithState: 0, gradedReviews: 0, averageRecall: 0 }),
        ];
        const stats = assembleDepthStats({ snapshot: mkSnapshot(topics), nowMs: 1 });
        expect(statById(stats, "best-concept").value).toBe("Strong");
        expect(statById(stats, "worst-concept").value).toBe("Weak");
        expect(statById(stats, "worst-concept").detail).toContain("22%");
    });

    it("abstains when no topic clears the floor", () => {
        const topics = [
            mkTopic({ nodeId: "Thin", cardsWithState: CONCEPT_FLOOR_CARDS - 1, gradedReviews: 5 }),
        ];
        const stats = assembleDepthStats({ snapshot: mkSnapshot(topics), nowMs: 1 });
        expect(statById(stats, "best-concept").value).toBe("—");
        expect(statById(stats, "worst-concept").value).toBe("—");
        expect(statById(stats, "worst-concept").detail).toContain("Still getting to know you");
    });

    it("sums mastery and due across topics", () => {
        const topics = [
            mkTopic({ nodeId: "A", totalCards: 50, masteredCount: 10, cardsWithState: 30, dueCount: 4, newCount: 6 }),
            mkTopic({ nodeId: "B", totalCards: 30, masteredCount: 5, cardsWithState: 10, dueCount: 1, newCount: 2 }),
        ];
        const stats = assembleDepthStats({ snapshot: mkSnapshot(topics), nowMs: 1 });
        expect(statById(stats, "mastery").value).toBe("15/80");
        expect(statById(stats, "due").value).toBe("5");
        expect(statById(stats, "due").detail).toContain("8 new seeds");
    });
});

describe("dashboard stats — point, not value", () => {
    it("reads the engine's `point` key (the Almanac's value-read is the known bug)", () => {
        expect(metricPoint({ point: 0.82 })).toBe(0.82);
        expect(metricPoint({ value: 0.7 })).toBe(0.7); // legacy fallback
        expect(metricPoint({})).toBeNull();
        const stats = assembleDepthStats({
            dashboard: {
                memory: { available: true, point: 0.82, range: [0.7, 0.9], confidence: "ok" },
                readiness: { available: true, point: 511.6, range: [498, 520] },
            } as never,
            nowMs: 1,
        });
        expect(statById(stats, "memory").value).toBe("82%");
        expect(statById(stats, "memory").detail).toContain("70%");
        expect(statById(stats, "readiness").value).toBe("512");
        expect(statById(stats, "readiness").detail).toContain("498");
    });

    it("relays the readiness abstention with its progress numbers", () => {
        const stats = assembleDepthStats({
            dashboard: {
                readiness: {
                    available: false,
                    reason: "not enough data",
                    graded_reviews: 6,
                    graded_reviews_required: 1000,
                },
                coverage: { gate_covered: 3, gate_total: 31 },
            } as never,
            nowMs: 1,
        });
        const readiness = statById(stats, "readiness");
        expect(readiness.value).toBe("—");
        expect(readiness.detail).toContain("6/1000");
        expect(readiness.detail).toContain("3/31");
    });
});

describe("sidecar stats", () => {
    it("counts blooms, weeds (with causes), and watered ground", () => {
        const doc = emptyDoc();
        doc.paraphrase = { "BB.1A": 111, "PS.2B": 222 };
        doc.flora = { "3,4": 3, "5,6": 2 };
        doc.economy = { ...doc.economy, water: 42, xp: 19 };
        const stats = assembleDepthStats({
            doc,
            weeds: { "BB.1A": { cause: "too-slow", ts: 1 } },
            nowMs: 1,
        });
        const blooms = statById(stats, "blooms");
        expect(blooms.value).toBe("2");
        expect(blooms.detail).toContain("1 weed");
        expect(blooms.detail).toContain("too-slow");
        const garden = statById(stats, "garden");
        expect(garden.value).toBe("2");
        expect(garden.detail).toContain("5 pours");
        expect(garden.detail).toContain("42 water");
    });
});
