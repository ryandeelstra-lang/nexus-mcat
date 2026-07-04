// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: the aim indicator's label formatter — the concept name + due/new
// text shown above the plot the watering can targets. Pure; no Phaser.
import { describe, expect, it } from "vitest";

import type { TopicMastery } from "../state/mastery";
import { aimLabelText, SHORT_CONCEPT_NAMES, shortConceptName } from "./aim-label";

import sidecarJson from "../../../lib/graph-sidecar.json" with { type: "json" };

const leafIds = (sidecarJson as { nodes: { id: string; path?: string }[] }).nodes
    .filter((n) => n.path)
    .map((n) => n.id);

function topic(over: Partial<TopicMastery>): TopicMastery {
    return {
        nodeId: "BB.1A",
        deckPath: "MCAT::B-B::1A",
        label: "Structure and function of proteins and their constituent amino acids",
        section: "B-B",
        totalCards: 0,
        cardsWithState: 0,
        masteredCount: 0,
        averageRecall: 0,
        gradedReviews: 0,
        dueCount: 0,
        newCount: 0,
        ...over,
    };
}

describe("shortConceptName", () => {
    it("returns the authored short name for a known leaf", () => {
        expect(shortConceptName("BB.1A")).toBe("Proteins & Amino Acids");
    });

    it("truncates an unknown id's full label to 24 chars with an ellipsis", () => {
        const long = "A very long concept label that overflows";
        expect(shortConceptName("ZZ.9Z", long)).toBe("A very long concept lab…");
        expect(shortConceptName("ZZ.9Z", long).length).toBe(24);
    });

    it("falls back to the nodeId when no name and no label are available", () => {
        expect(shortConceptName("ZZ.9Z")).toBe("ZZ.9Z");
    });
});

describe("aimLabelText", () => {
    it("shows due count when cards are due", () => {
        expect(aimLabelText("BB.1A", topic({ dueCount: 12, newCount: 3 })))
            .toBe("Proteins & Amino Acids · 12 due");
    });

    it("shows new count when nothing is due but new cards exist", () => {
        expect(aimLabelText("BB.1A", topic({ dueCount: 0, newCount: 5 })))
            .toBe("Proteins & Amino Acids · 5 new");
    });

    it("shows just the name when nothing is due or new", () => {
        expect(aimLabelText("BB.1A", topic({ dueCount: 0, newCount: 0 })))
            .toBe("Proteins & Amino Acids");
    });

    it("shows just the name when the topic is undefined (snapshot not loaded)", () => {
        expect(aimLabelText("BB.1A", undefined)).toBe("Proteins & Amino Acids");
    });
});

describe("short-name coverage", () => {
    it("has a short name for every sidecar leaf, each ≤ 24 chars", () => {
        for (const id of leafIds) {
            expect(SHORT_CONCEPT_NAMES[id], `missing short name for ${id}`).toBeDefined();
            expect(SHORT_CONCEPT_NAMES[id].length).toBeLessThanOrEqual(24);
        }
    });
});
