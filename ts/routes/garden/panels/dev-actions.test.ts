// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: the dev "skip onboarding" descriptors are PURE, so pin them — a skip must land
// a real terminal/first-run state (never a half-written limbo) and, above all, must NEVER
// fabricate progress. The integrity assertions here are the guardrail that keeps this dev
// convenience from ever teaching the garden to lie.
import { describe, expect, it } from "vitest";

import { emptyPlacement } from "../state/store";
import { currentBeat, TUTORIAL_BEATS } from "../state/tutorial";
import { resetOnboardingWrites, skipAllWrites, skippedPlacement, skippedTutorial } from "./dev-actions";

describe("dev skip-onboarding descriptors", () => {
    it("skipped tutorial is genuinely complete and has no active beat", () => {
        const tut = skippedTutorial();
        expect(tut.done).toBe(true);
        expect(tut.beat).toBe(TUTORIAL_BEATS.length);
        expect(currentBeat(tut)).toBeNull();
    });

    it("skipped placement lifts the fog WITHOUT inventing a readiness number", () => {
        const placement = skippedPlacement(1_234);
        expect(placement.done).toBe(true);
        expect(placement.completedAtMs).toBe(1_234);
        // The integrity line: no fabricated answers, no fabricated per-section tally.
        expect(placement.answered).toBe(0);
        expect(placement.knew).toBe(0);
        expect(placement.tally).toEqual({});
        expect(placement.intake).toEqual(emptyPlacement().intake);
    });

    it("skip-all writes exactly the two onboarding gates, all done", () => {
        const writes = skipAllWrites(7);
        expect(writes.map((w) => w.key)).toEqual(["tutorial", "placement"]);
        expect(writes.every((w) => (w.doc as { done: boolean }).done)).toBe(true);
    });

    it("reset writes drop every gate back to its untouched first-run value", () => {
        const writes = resetOnboardingWrites();
        const byKey = Object.fromEntries(writes.map((w) => [w.key, w.doc]));
        expect(byKey.tutorial).toEqual({ beat: 0, done: false });
        // Deep-equals a brand-new placement: reset must leave nothing of a prior run behind.
        expect(byKey.placement).toEqual(emptyPlacement());
    });
});
