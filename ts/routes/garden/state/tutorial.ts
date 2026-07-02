// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: the first-open tutorial state machine (docs/26 G4.1; doc 23 §10.4).
// Eight beats, one thing at a time, resumable (the beat index persists in the additive
// store). PURE: the machine consumes garden events and answers "what beat are we on, what
// hint shows, may this beat advance" — the world/panels render it. Zelda-warm copy lives
// here so the script is testable and translatable in one place.

export interface TutorialBeat {
    /** Stable id — persisted; never renumber. */
    id: number;
    /** The Keeper's line / on-screen hint for this beat. */
    hint: string;
    /** Where the bouncing arrow points ("keeper" | "plant" | "map" | "none"). */
    focus: "keeper" | "plant" | "map" | "none";
    /** The event that completes this beat. */
    advanceOn: TutorialEvent["kind"];
}

export type TutorialEvent =
    | { kind: "moved" }
    | { kind: "reached-keeper" }
    | { kind: "planted" }
    | { kind: "watered" }
    | { kind: "keeper-opened" }
    | { kind: "answered" }
    | { kind: "bloomed" }
    | { kind: "map-opened" };

/** Doc 23 §10.4, beats 1–8 (the splash is outside the machine — Decision 37 owns it). */
export const TUTORIAL_BEATS: readonly TutorialBeat[] = [
    {
        id: 0,
        hint: "Dawn. Use the arrow keys to walk toward the light at the center.",
        focus: "keeper",
        advanceOn: "reached-keeper",
    },
    {
        id: 1,
        hint: "The Keeper: \u201cThis garden is your mind — mostly bare paths, for now. "
            + "That's not a verdict; it's room to grow. Let's plant something.\u201d",
        focus: "keeper",
        advanceOn: "keeper-opened",
    },
    {
        id: 2,
        hint: "\u201cEvery plant starts as a question.\u201d Walk to the glowing plot and plant a seed \uD83C\uDF31.",
        focus: "plant",
        advanceOn: "planted",
    },
    {
        id: 3,
        hint:
            "\u201cTend it — walk up and water it.\u201d Each pour \uD83D\uDCA7 queues its questions for your next visit.",
        focus: "plant",
        advanceOn: "watered",
    },
    {
        id: 4,
        hint: "\u201cKnowledge fades if you don't return. Your questions are growing underground — "
            + "come see me when you're ready.\u201d",
        focus: "keeper",
        advanceOn: "keeper-opened",
    },
    {
        id: 5,
        hint: "Answer the questions you queued. Each graded answer grows the plant — and refills your water.",
        focus: "keeper",
        advanceOn: "answered",
    },
    {
        id: 6,
        hint: "\u201cYou didn't just remember it — you can explain it.\u201d When a reworded check passes, "
            + "the plant BLOOMS and a gate on the path opens.",
        focus: "plant",
        advanceOn: "bloomed",
    },
    {
        id: 7,
        hint: "\u201cThis is your whole world. Bloom it, and paths open. Come back daily — "
            + "I'll tell you what to tend.\u201d Press M to see your map, then start today's tending.",
        focus: "map",
        advanceOn: "map-opened",
    },
];

export interface TutorialSnapshot {
    beat: number;
    done: boolean;
}

export function currentBeat(state: TutorialSnapshot): TutorialBeat | null {
    if (state.done || state.beat >= TUTORIAL_BEATS.length) {
        return null;
    }
    return TUTORIAL_BEATS[state.beat];
}

/**
 * Feed an event; returns the next state (unchanged reference-equal state when the event
 * doesn't advance the current beat — beats only ever move FORWARD, doc 23 §10.4's
 * "one thing at a time" + re-entrant after force-quit).
 */
export function advance(state: TutorialSnapshot, event: TutorialEvent): TutorialSnapshot {
    const beat = currentBeat(state);
    if (!beat || event.kind !== beat.advanceOn) {
        return state;
    }
    const next = state.beat + 1;
    if (next >= TUTORIAL_BEATS.length) {
        return { beat: next, done: true };
    }
    return { beat: next, done: false };
}

/** The bloom beat (id 6) must never be skippable by non-bloom events — pinned by tests. */
export const BLOOM_BEAT_ID = 6;
