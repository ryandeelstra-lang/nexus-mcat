// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up W1a: doc 23 §7.1 worked example as an integration test (docs/26 G2 gate):
// Day 1 sows 15 pours (12 waters + 3 legacy "plant" intro entries — the kind survives in
// old saved queues even though seeds are gone) → Day 2 (a fresh boot on the same
// persisted doc) the Keeper serves ALL 15 FIFO → answering refills water → the loop can
// sow the next batch. Store + delivery + economy together, over a shared fake transport
// (the sidecar's role). The live end-to-end slice is ts/tests/e2e/garden-60-deferred.test.ts.
import { describe, expect, it } from "vitest";

import { planDelivery } from "../panels/keeper-logic";
import { ECONOMY, initialBalances, onGradedAnswer, spendWater } from "./economy";
import type { TopicMastery } from "./mastery";
import { type GardenDoc, GardenStore } from "./store";

function fakeTransport(shared: { doc: Partial<GardenDoc> }) {
    return {
        async get(): Promise<Partial<GardenDoc>> {
            return JSON.parse(JSON.stringify(shared.doc)) as Partial<GardenDoc>;
        },
        async set(key: keyof GardenDoc, doc: unknown): Promise<void> {
            (shared.doc as Record<string, unknown>)[key as string] = doc;
        },
    };
}

function topic(i: number): TopicMastery {
    return {
        nodeId: `T.${i}`,
        deckPath: `MCAT::T::${i}`,
        label: `Topic ${i}`,
        section: "P-S",
        totalCards: 10,
        cardsWithState: 5,
        masteredCount: 0,
        averageRecall: 0.5,
        gradedReviews: 3,
        dueCount: 1,
        newCount: 2,
    };
}

describe("doc 23 §7.1 — sow now, answer next visit (15 pending plots)", () => {
    it("day 1 queues 15; day 2 serves all 15 FIFO; refills close the loop", async () => {
        const shared = { doc: {} as Partial<GardenDoc> };
        const topics = Array.from({ length: 15 }, (_, i) => topic(i));

        // ---- Day 1: sow (every spend queues; nothing is asked yet) ----
        const day1 = new GardenStore(fakeTransport(shared));
        await day1.load();
        let b = initialBalances();
        for (let i = 0; i < 12; i++) {
            b = spendWater(b);
            day1.enqueue({ nodeId: topics[i].nodeId, deckPath: topics[i].deckPath, kind: "water" });
        }
        for (let i = 12; i < 15; i++) {
            // Planting costs nothing (seeds removed 2026-07-03) — queueing intro cards
            // is a free act; only pours spend water.
            day1.enqueue({ nodeId: topics[i].nodeId, deckPath: topics[i].deckPath, kind: "plant" });
        }
        day1.setBalances(b);
        expect(b).toEqual({
            water: ECONOMY.startWater - 12 * ECONOMY.waterCostPerPour,
            xp: 0,
        });
        expect(day1.snapshot.pending).toHaveLength(15);

        // ---- Day 2: a fresh boot loads the SAME persisted doc (the restart) ----
        const day2 = new GardenStore(fakeTransport(shared));
        await day2.load();
        expect(day2.snapshot.pending).toHaveLength(15);
        expect(day2.snapshot.economy).toEqual(b);

        // The Keeper serves last round's queue, oldest first, before any fresh assignment.
        const delivery = planDelivery(day2.snapshot.pending, topics);
        expect(delivery).toHaveLength(15);
        expect(delivery.map((d) => d.nodeId)).toEqual(topics.map((t) => t.nodeId));
        expect(delivery.every((d) => d.why === "queued")).toBe(true);

        // Answering all 15 refills 15 water (§7.1). Blooms pay nothing material now —
        // the bloom itself (and the gate it opens) is the reward.
        let b2 = day2.snapshot.economy;
        for (const d of delivery) {
            b2 = onGradedAnswer(b2);
            day2.dequeue([d.nodeId]);
        }
        day2.setBalances(b2);

        expect(day2.snapshot.pending).toHaveLength(0); // served entries leave the queue
        expect(b2.water).toBe(b.water + 15 * ECONOMY.waterPerGradedAnswer);
        // Day 3 can sow the next batch — the loop self-sustains (never a hard stall).
        expect(b2.water).toBeGreaterThanOrEqual(12 * ECONOMY.waterCostPerPour);
    });
});
