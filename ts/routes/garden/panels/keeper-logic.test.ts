// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: pure Keeper delivery ordering tests (doc 23 §6.5 / §7.1).
import { describe, expect, it } from "vitest";

import type { TopicMastery } from "../state/mastery";
import type { PendingEntry } from "../state/store";
import { planDelivery } from "./keeper-logic";

function topic(overrides: Partial<TopicMastery>): TopicMastery {
    return {
        nodeId: overrides.nodeId ?? "PS.1A",
        deckPath: overrides.deckPath ?? "MCAT::P-S::1A",
        label: overrides.label ?? "Sensation",
        section: overrides.section ?? "P-S",
        totalCards: overrides.totalCards ?? 50,
        cardsWithState: overrides.cardsWithState ?? 20,
        masteredCount: overrides.masteredCount ?? 10,
        averageRecall: overrides.averageRecall ?? 0.7,
        gradedReviews: overrides.gradedReviews ?? 80,
        dueCount: overrides.dueCount ?? 0,
        newCount: overrides.newCount ?? 0,
    };
}

function pending(overrides: Partial<PendingEntry>): PendingEntry {
    return {
        nodeId: overrides.nodeId ?? "PS.1A",
        deckPath: overrides.deckPath ?? "MCAT::P-S::1A",
        kind: overrides.kind ?? "water",
        pours: overrides.pours ?? 1,
        queuedAtMs: overrides.queuedAtMs ?? 10,
    };
}

describe("planDelivery", () => {
    it("serves queued entries first, oldest queuedAtMs first", () => {
        const pendingEntries: PendingEntry[] = [
            pending({ nodeId: "CP.2A", deckPath: "MCAT::C-P::2A", queuedAtMs: 30 }),
            pending({ nodeId: "BB.1A", deckPath: "MCAT::B-B::1A", queuedAtMs: 10 }),
            pending({ nodeId: "PS.3A", deckPath: "MCAT::P-S::3A", queuedAtMs: 20 }),
        ];
        const topics = [
            topic({ nodeId: "BB.1A", deckPath: "MCAT::B-B::1A", label: "Biochemistry" }),
            topic({ nodeId: "PS.3A", deckPath: "MCAT::P-S::3A", label: "Behavior" }),
            topic({ nodeId: "CP.2A", deckPath: "MCAT::C-P::2A", label: "Thermo" }),
        ];

        expect(planDelivery(pendingEntries, topics)).toEqual([
            {
                deckPath: "MCAT::B-B::1A",
                nodeId: "BB.1A",
                label: "Biochemistry",
                why: "queued",
            },
            {
                deckPath: "MCAT::P-S::3A",
                nodeId: "PS.3A",
                label: "Behavior",
                why: "queued",
            },
            {
                deckPath: "MCAT::C-P::2A",
                nodeId: "CP.2A",
                label: "Thermo",
                why: "queued",
            },
        ]);
    });

    it("when pending is empty, assigns the highest due topic", () => {
        const topics = [
            topic({ nodeId: "A", deckPath: "MCAT::A", label: "A", dueCount: 3, averageRecall: 0.4 }),
            topic({ nodeId: "B", deckPath: "MCAT::B", label: "B", dueCount: 9, averageRecall: 0.7 }),
            topic({ nodeId: "C", deckPath: "MCAT::C", label: "C", dueCount: 5, averageRecall: 0.2 }),
        ];

        expect(planDelivery([], topics)).toEqual([{
            deckPath: "MCAT::B",
            nodeId: "B",
            label: "B",
            why: "assigned",
        }]);
    });

    it("breaks due ties with lower averageRecall (most fragile first)", () => {
        const topics = [
            topic({ nodeId: "A", deckPath: "MCAT::A", label: "A", dueCount: 4, averageRecall: 0.62 }),
            topic({ nodeId: "B", deckPath: "MCAT::B", label: "B", dueCount: 4, averageRecall: 0.31 }),
            topic({ nodeId: "C", deckPath: "MCAT::C", label: "C", dueCount: 2, averageRecall: 0.1 }),
        ];

        expect(planDelivery([], topics)[0]).toMatchObject({
            deckPath: "MCAT::B",
            nodeId: "B",
            why: "assigned",
        });
    });

    it("returns no assignment when nothing is due", () => {
        const topics = [
            topic({ nodeId: "A", dueCount: 0 }),
            topic({ nodeId: "B", dueCount: 0 }),
        ];
        expect(planDelivery([], topics)).toEqual([]);
    });
});
