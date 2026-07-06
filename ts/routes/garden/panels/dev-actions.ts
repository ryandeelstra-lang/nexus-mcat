// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: PURE descriptors for the dev-only "skip onboarding" buttons (see DevPanel.tsx —
// a dev tool gated OFF in clean public builds). Kept pure + tested so a skip always lands the
// garden in a genuinely first-run OR a fully-onboarded state, never a half-written limbo.
// Integrity (doc 23): these flip only the tutorial/placement GATES — mastery stays engine
// truth, so a skipped garden is honestly bare soil, never fabricated blooms.

import {
    emptyPlacement,
    type GardenDoc,
    type PlacementState,
    type TutorialState,
} from "../state/store";
import { TUTORIAL_BEATS } from "../state/tutorial";

/** One sidecar write: which GardenDoc key, and the value to persist through the bridge. */
export interface SidecarWrite {
    key: keyof GardenDoc;
    doc: unknown;
}

/** The action tutorial, marked complete (beat parked past the last beat). */
export function skippedTutorial(): TutorialState {
    return { beat: TUTORIAL_BEATS.length, done: true };
}

/**
 * The placement test, marked done so the island fog lifts — but with ZERO fabricated
 * answers (answered/knew stay 0, tally empty). Skipping the ceremony must never invent a
 * readiness number; it only opens the gate the real test would have opened.
 */
export function skippedPlacement(nowMs: number): PlacementState {
    return { ...emptyPlacement(), done: true, completedAtMs: nowMs };
}

/** Every sidecar write to jump a fresh gardener straight past the intro flow to free-play. */
export function skipAllWrites(nowMs: number): SidecarWrite[] {
    return [
        { key: "tutorial", doc: skippedTutorial() },
        { key: "placement", doc: skippedPlacement(nowMs) },
    ];
}

/** Every sidecar write to drop the garden back to its untouched, first-run state. */
export function resetOnboardingWrites(): SidecarWrite[] {
    return [
        { key: "tutorial", doc: { beat: 0, done: false } satisfies TutorialState },
        { key: "placement", doc: emptyPlacement() },
    ];
}
