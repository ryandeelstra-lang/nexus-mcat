// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: the decay-refresh gate (living-decay spec 2026-07-05). A pure
// state machine deciding WHEN the app may re-read engine truth on its own
// (slow tick / window focus): only while no overlay covers the world — the
// three-tier reveal (docs/17 §reveal; "no plant popping mid-card") is canon.
// A tick that lands mid-review becomes a debt, flushed when the overlay drops;
// review:closed forgives the debt because its own handler already refreshes.

/** The slow decay tick — retrievability moves slowly; 30 min is plenty. */
export const DECAY_REFRESH_INTERVAL_MS = 30 * 60 * 1000;
/** Focus + visibility can double-fire; anything inside this window coalesces. */
export const DECAY_REFRESH_MIN_GAP_MS = 60 * 1000;

export interface DecayRefreshState {
    panelOpen: boolean;
    pending: boolean;
    lastRefreshMs: number;
}

export type DecayRefreshEvent =
    | { kind: "tick" }
    | { kind: "focus" }
    | { kind: "overlay"; open: boolean }
    | { kind: "review-closed" };

export function initialDecayRefresh(nowMs: number): DecayRefreshState {
    return { panelOpen: false, pending: false, lastRefreshMs: nowMs };
}

export function nextDecayRefresh(
    state: DecayRefreshState,
    event: DecayRefreshEvent,
    nowMs: number,
): { state: DecayRefreshState; refresh: boolean } {
    switch (event.kind) {
        case "tick":
        case "focus": {
            if (state.panelOpen) {
                return { state: { ...state, pending: true }, refresh: false };
            }
            if (nowMs - state.lastRefreshMs < DECAY_REFRESH_MIN_GAP_MS) {
                return { state, refresh: false };
            }
            return { state: { ...state, lastRefreshMs: nowMs }, refresh: true };
        }
        case "overlay": {
            if (!event.open && state.pending) {
                return {
                    state: { panelOpen: false, pending: false, lastRefreshMs: nowMs },
                    refresh: true,
                };
            }
            return { state: { ...state, panelOpen: event.open }, refresh: false };
        }
        case "review-closed":
            return { state: { ...state, pending: false, lastRefreshMs: nowMs }, refresh: false };
    }
}
