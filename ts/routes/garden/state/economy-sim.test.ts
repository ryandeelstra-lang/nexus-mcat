// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up W1a: docs/26 G2/R6 — "a diligent player never hard-stalls", proven over
// simulated days. Every day the player just shows up: the Keeper serves yesterday's
// queue or a fresh due/new assignment; answering refills water 1:1 through the ONE
// tuning surface (ECONOMY), so diligence is always self-sustaining. Also pins I3 at
// the stage layer: a wrong answer's engine state can never render "bloomed" without
// a paraphrase pass. (Seeds were removed as a currency 2026-07-03 — water is the
// only spendable, so the sim IS the worst case by construction.)
import { describe, expect, it } from "vitest";

import { planDelivery } from "../panels/keeper-logic";
import { type Balances, canWater, initialBalances, onGradedAnswer, spendWater } from "./economy";
import type { TopicMastery } from "./mastery";
import { stageFor } from "./stage";
import type { PendingEntry } from "./store";

function mkTopic(i: number, dueCount: number, newCount: number): TopicMastery {
    return {
        nodeId: `T.${i}`,
        deckPath: `MCAT::T::${i}`,
        label: `Topic ${i}`,
        section: "P-S",
        totalCards: 20,
        cardsWithState: 10,
        masteredCount: 0,
        averageRecall: 0.55,
        gradedReviews: 12,
        dueCount,
        newCount,
    };
}

describe("R6 — a diligent player never hard-stalls (simulated days)", () => {
    it("365 worst-case days: work exists daily and water never starves", () => {
        let b: Balances = initialBalances();
        let pending: PendingEntry[] = [];
        // A steady FSRS keeps ~5 cards due per topic daily; 2 unseen news remain.
        const topics = Array.from({ length: 34 }, (_, i) => mkTopic(i, 5, 2));

        for (let day = 0; day < 365; day++) {
            // Morning: the Keeper ALWAYS has something (queued or freshly assigned).
            const delivery = planDelivery(pending, topics);
            expect(delivery.length, `day ${day} must offer work`).toBeGreaterThan(0);
            // The diligent player answers one graded rep per delivered topic (refills water).
            for (const _item of delivery) {
                b = onGradedAnswer(b);
            }
            pending = [];
            // Evening: sow as much as the wallet allows (≤12 pours, §7.1 pattern).
            let pours = 0;
            while (pours < 12 && canWater(b)) {
                b = spendWater(b);
                pending.push({
                    nodeId: `T.${pours}`,
                    deckPath: `MCAT::T::${pours}`,
                    kind: "water",
                    pours: 1,
                    queuedAtMs: day * 86_400_000 + pours,
                });
                pours++;
            }
            expect(b.water).toBeGreaterThanOrEqual(0);
        }
        // After a year with ZERO blooms, water still hovers at its sustainable band:
        // every answered rep paid its pour back (never spirals to a starve-out).
        expect(b.water).toBeGreaterThanOrEqual(initialBalances().water - 12);
    });

    it("the empty-collection edge: no due, no new, nothing queued — delivery is empty, never a crash", () => {
        const exhausted = Array.from({ length: 5 }, (_, i) => mkTopic(i, 0, 0));
        expect(planDelivery([], exhausted)).toEqual([]);
    });
});

describe("I3 at the stage layer — a wrong answer can never render a bloom", () => {
    it("even perfect recall with nothing due stays 'budding' without the paraphrase pass", () => {
        const stage = stageFor({
            topic: {
                totalCards: 10,
                cardsWithState: 10,
                averageRecall: 0.99,
                gradedReviews: 40,
                dueCount: 0,
            },
            paraphrasePassed: false,
            hasActiveWeed: false,
        });
        expect(stage).toBe("budding");
    });

    it("a just-failed card (due again) never advances toward bloom — the gate still holds", () => {
        // Wilting removed 2026-07-05: a due card no longer droops. Without the paraphrase
        // pass (I3) it caps at "budding" — strong memory alone never reaches "bloomed".
        const stage = stageFor({
            topic: {
                totalCards: 10,
                cardsWithState: 1,
                averageRecall: 0.95,
                gradedReviews: 1,
                dueCount: 1,
            },
            paraphrasePassed: false,
            hasActiveWeed: false,
        });
        expect(stage).toBe("budding");
        expect(stage).not.toBe("bloomed");
    });
});
