// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: the garden gnome's daily-insight CONTRACT (feature 2026-07-05). What's pinned:
// the pick is positive-ONLY (never names a weakness), honest (floored — an untouched topic is
// never praised), deterministic per ISO day, and never repeats yesterday's line when it can
// avoid it. Always returns SOMETHING (a warm fallback) even for a brand-new garden.
import { describe, expect, it } from "vitest";

import {
    GARDENER_FALLBACKS,
    gardenerCandidates,
    type GardenerInsightInputs,
    pickGardenerInsight,
} from "./gardener-insight";
import type { MasterySnapshot, TopicMastery } from "./mastery";
import { emptyDoc, type GardenDoc } from "./store";

function topic(p: Partial<TopicMastery>): TopicMastery {
    return {
        nodeId: "BB.1A",
        deckPath: "MCAT::B-B::1A",
        label: "Proteins & Amino Acids",
        section: "B-B",
        totalCards: 100,
        cardsWithState: 0,
        masteredCount: 0,
        averageRecall: 0,
        gradedReviews: 0,
        dueCount: 0,
        newCount: 0,
        ...p,
    };
}

function snapshot(topics: TopicMastery[]): MasterySnapshot {
    return {
        topics,
        byNode: new Map(topics.map((t) => [t.nodeId, t])),
        byDeckPath: new Map(topics.map((t) => [t.deckPath, t])),
        fetchedAtMs: 0,
    };
}

function doc(over: Partial<GardenDoc> = {}): GardenDoc {
    return { ...emptyDoc(), ...over };
}

const DAY = "2026-07-05";

function inputs(over: Partial<GardenerInsightInputs> = {}): GardenerInsightInputs {
    return { snapshot: null, doc: doc(), dateIso: DAY, ...over };
}

describe("garden gnome — daily insight contract", () => {
    it("brand-new garden falls back to a warm line (never empty, never a stat)", () => {
        const out = pickGardenerInsight(inputs());
        expect(GARDENER_FALLBACKS).toContain(out.text);
        expect(out.dateIso).toBe(DAY);
    });

    it("names a thriving patch only when it clears the card floor AND is genuinely high", () => {
        // 92% recall but only 4 cards with state — below the floor, never praised.
        const thin = gardenerCandidates(
            inputs({
                snapshot: snapshot([
                    topic({ cardsWithState: 4, gradedReviews: 4, averageRecall: 0.92 }),
                ]),
            }),
        );
        expect(thin.some((t) => t.includes("thriving"))).toBe(false);

        // 88% recall across 30 cards — a real, earned win.
        const strong = gardenerCandidates(
            inputs({
                snapshot: snapshot([
                    topic({ cardsWithState: 30, gradedReviews: 30, averageRecall: 0.88 }),
                ]),
            }),
        );
        expect(strong.some((t) => t.includes("thriving") && t.includes("88%"))).toBe(true);
    });

    it("never names a weakness — a low-recall-only garden yields NO 'thriving' line", () => {
        const weak = gardenerCandidates(
            inputs({
                snapshot: snapshot([
                    topic({ cardsWithState: 40, gradedReviews: 40, averageRecall: 0.12 }),
                ]),
            }),
        );
        // The topic is well past the floor but weak — the gnome stays silent about it.
        expect(weak.some((t) => t.includes("thriving"))).toBe(false);
        // ...yet it can still celebrate the honest breadth/effort signals if present.
        for (const line of weak) {
            expect(line.toLowerCase()).not.toContain("thirstiest");
            expect(line.toLowerCase()).not.toContain("worst");
            expect(line.toLowerCase()).not.toContain("weak");
        }
    });

    it("celebrates mastered cards, blooms, and streaks when earned", () => {
        const out = gardenerCandidates(
            inputs({
                snapshot: snapshot([topic({ cardsWithState: 20, masteredCount: 7 })]),
                doc: doc({ paraphrase: { "BB.1A": 1, "CP.4A": 1 } }),
                analytics: { streakDays: 4 },
            }),
        );
        expect(out.some((t) => t.includes("7 cards") && t.includes("mastery line"))).toBe(true);
        expect(out.some((t) => t.includes("2 concepts") && t.includes("own words"))).toBe(true);
        expect(out.some((t) => t.includes("4 days in a row"))).toBe(true);
    });

    it("is deterministic per ISO day (same day → same line)", () => {
        const a = pickGardenerInsight(inputs());
        const b = pickGardenerInsight(inputs());
        expect(a.text).toBe(b.text);
    });

    it("avoids repeating yesterday's line when another option exists", () => {
        const rich = inputs({
            snapshot: snapshot([topic({ cardsWithState: 20, masteredCount: 5 })]),
            doc: doc({ paraphrase: { "BB.1A": 1 } }),
            analytics: { streakDays: 3 },
        });
        const first = pickGardenerInsight(rich);
        const next = pickGardenerInsight({ ...rich, lastText: first.text });
        expect(next.text).not.toBe(first.text);
    });
});
