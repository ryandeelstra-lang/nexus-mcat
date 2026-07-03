// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: G4.1 gate — the 8-beat tutorial machine (docs/26 G4.1; doc 23 §10.4):
// completable in order, re-entrant, never advanced by the wrong event, bloom beat only
// advances on a real bloom.
import { describe, expect, it } from "vitest";

import {
    advance,
    BLOOM_BEAT_ID,
    currentBeat,
    TUTORIAL_BEATS,
    type TutorialEvent,
    type TutorialSnapshot,
} from "./tutorial";

const HAPPY_PATH: TutorialEvent["kind"][] = [
    "reached-keeper",
    "keeper-opened",
    "answered",
    "watered",
    "bloomed",
    "map-opened",
];

describe("tutorial — the doc 23 §10.4 beat sheet", () => {
    it("has exactly 6 beats with stable ids", () => {
        expect(TUTORIAL_BEATS).toHaveLength(6);
        expect(TUTORIAL_BEATS.map((b) => b.id)).toEqual([0, 1, 2, 3, 4, 5]);
    });

    it("completes start-to-finish on the happy path", () => {
        let state: TutorialSnapshot = { beat: 0, done: false };
        for (const kind of HAPPY_PATH) {
            expect(state.done).toBe(false);
            state = advance(state, { kind } as TutorialEvent);
        }
        expect(state.done).toBe(true);
        expect(currentBeat(state)).toBeNull();
    });

    it("ignores events that don't match the current beat (one thing at a time)", () => {
        const state: TutorialSnapshot = { beat: 0, done: false };
        const same = advance(state, { kind: "bloomed" });
        expect(same).toBe(state); // reference-equal: no state churn
    });

    it("is re-entrant: resuming mid-way lands on the persisted beat", () => {
        const resumed: TutorialSnapshot = { beat: 3, done: false };
        expect(currentBeat(resumed)?.advanceOn).toBe("watered");
    });

    it("the bloom beat only advances on a real bloom (I3 in the tutorial)", () => {
        const atBloom: TutorialSnapshot = { beat: BLOOM_BEAT_ID, done: false };
        expect(advance(atBloom, { kind: "answered" })).toBe(atBloom);
        expect(advance(atBloom, { kind: "watered" })).toBe(atBloom);
        const after = advance(atBloom, { kind: "bloomed" });
        expect(after.beat).toBe(BLOOM_BEAT_ID + 1);
    });

    it("a finished tutorial never re-opens", () => {
        const done: TutorialSnapshot = { beat: 6, done: true };
        expect(currentBeat(done)).toBeNull();
        expect(advance(done, { kind: "map-opened" })).toBe(done);
    });

    it("every beat's focus target is renderable", () => {
        for (const beat of TUTORIAL_BEATS) {
            expect(["keeper", "plant", "map", "none"]).toContain(beat.focus);
            expect(beat.hint.length).toBeGreaterThan(10);
        }
    });
});
