// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: the decay-refresh gate (living-decay spec 2026-07-05). Pins the
// three-tier-reveal discipline: NOTHING re-stages while an overlay is up — a
// mid-review tick defers and flushes the moment the overlay drops.
import { describe, expect, it } from "vitest";

import {
    DECAY_REFRESH_MIN_GAP_MS,
    type DecayRefreshEvent,
    initialDecayRefresh,
    nextDecayRefresh,
} from "./decay-refresh";

const T0 = 1_000_000;

function run(events: Array<[DecayRefreshEvent, number]>): boolean[] {
    let state = initialDecayRefresh(T0);
    const fired: boolean[] = [];
    for (const [event, at] of events) {
        const r = nextDecayRefresh(state, event, at);
        state = r.state;
        fired.push(r.refresh);
    }
    return fired;
}

const LATER = T0 + DECAY_REFRESH_MIN_GAP_MS + 1;

describe("nextDecayRefresh — panel-closed gating", () => {
    it("tick with no overlay and the gap passed ⇒ refresh", () => {
        expect(run([[{ kind: "tick" }, LATER]])).toEqual([true]);
    });
    it("tick inside the min gap ⇒ coalesced away", () => {
        expect(run([[{ kind: "tick" }, T0 + 5_000]])).toEqual([false]);
    });
    it("focus behaves like tick", () => {
        expect(run([[{ kind: "focus" }, LATER]])).toEqual([true]);
    });
    it("tick while the overlay is open ⇒ deferred, flushed when the overlay drops", () => {
        expect(run([
            [{ kind: "overlay", open: true }, T0],
            [{ kind: "tick" }, LATER],
            [{ kind: "overlay", open: false }, LATER + 1],
        ])).toEqual([false, false, true]);
    });
    it("overlay close with no debt ⇒ nothing fires", () => {
        expect(run([
            [{ kind: "overlay", open: true }, T0],
            [{ kind: "overlay", open: false }, LATER],
        ])).toEqual([false, false]);
    });
    it("review:closed clears the debt (its own handler already refreshes)", () => {
        expect(run([
            [{ kind: "overlay", open: true }, T0],
            [{ kind: "tick" }, LATER],
            [{ kind: "review-closed" }, LATER + 1],
            [{ kind: "overlay", open: false }, LATER + 2],
        ])).toEqual([false, false, false, false]);
    });
    it("a refresh restarts the min-gap clock", () => {
        expect(run([
            [{ kind: "tick" }, LATER],
            [{ kind: "focus" }, LATER + 5_000],
        ])).toEqual([true, false]);
    });
});
