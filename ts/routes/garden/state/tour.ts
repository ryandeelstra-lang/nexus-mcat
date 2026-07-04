// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: the Garden Tour — the first-entry concept walkthrough (spec:
// docs/superpowers/specs/2026-07-03-garden-tour-design.md; doc 23 §10.4 "teach one thing
// at a time"). The Keeper narrates every shipped mechanic AND names the learning science
// behind it, one beat per concept, before the action-gated tutorial (tutorial.ts) takes
// over. PURE: steps + copy + a tiny forward-only cursor; panels render it. It tells, the
// tutorial machine makes you do — neither replaces the other.

export interface TourStep {
    /** Stable id — persisted; never renumber. */
    id: number;
    /** Stable concept key — test-pinned so no app concept can silently drop out. */
    key: string;
    /** Short chip shown above the Keeper's name row (e.g. "Watering"). */
    title: string;
    /** The Keeper's spoken line (word-crawled; keep it one breath, not a lecture). */
    line: string;
    /** The "🌱 The science" footnote — the honest why, principle named. */
    science: string;
}

/** One beat per shipped concept (as-built per doc 27: water-anywhere, no planting). */
export const TOUR_STEPS: readonly TourStep[] = [
    {
        id: 0,
        key: "garden",
        title: "This garden",
        line: "So you've come. Welcome. This garden is your mind — four gardens, one for "
            + "each part of your exam. And nothing here is decoration: every sprout, bloom, "
            + "and weed is your real memory, measured. I never invent progress.",
        science: "The garden only grows from real, graded practice — never from time spent "
            + "or coins earned. Honest feedback about what you actually know (not what feels "
            + "familiar) is the foundation effective self-study stands on.",
    },
    {
        id: 1,
        key: "recall",
        title: "Answering",
        line: "I'm the Keeper. When we sit together I ask before I ever show: you tell me "
            + "what you remember, out loud or typed, and only then do we look at the truth "
            + "of it together.",
        science: "Retrieval practice, the “testing effect”: pulling a memory out "
            + "strengthens it far more than re-reading it (Roediger & Karpicke, 2006). Every "
            + "question here is practice at remembering, not recognizing.",
    },
    {
        id: 2,
        key: "honesty",
        title: "Not knowing",
        line: "And when you don't know? Say “I don't know.” No tricks, no penalty "
            + "games. A blank or wrong answer simply shows us where to dig.",
        science: "Failing to retrieve and then seeing the answer still deepens learning "
            + "(errorful learning — Kornell, Hays & Bjork, 2009). An honest miss teaches "
            + "more than a polished illusion of knowing.",
    },
    {
        id: 3,
        key: "water",
        title: "Watering",
        line: "Wherever you stand, press Space to water the ground. But hear this: water "
            + "alone never grew a mind — returning grows it. Knowledge fades, so I call each "
            + "plant back to you just before you'd forget it.",
        science: "The spacing effect: reviews timed near the edge of forgetting build far "
            + "more durable memory (Ebbinghaus's forgetting curve; Cepeda et al., 2006). The "
            + "scheduler models each memory and times your returns — that almost-forgot "
            + "struggle is the workout.",
    },
    {
        id: 4,
        key: "stages",
        title: "Plant stages",
        line: "Each plant wears its true stage — sprout, growing, budding… and drooping "
            + "when a memory thirsts. I don't nag. The garden simply shows you where you're "
            + "needed.",
        science: "Feeling fluent is not knowing — restudied material feels mastered long "
            + "after it would fail on test day (the fluency illusion; Bjork). Stages come "
            + "straight from the scheduler's memory model, so a drooping plant is a measured "
            + "forgetting risk, not a guilt trip.",
    },
    {
        id: 5,
        key: "bloom",
        title: "Blooming",
        line: "A bud becomes a bloom only one way: when your memory has grown strong, I "
            + "test you on it again — fresh — and you hold. No pour and no prize opens a "
            + "bud; only proof does.",
        science: "Recognizing a familiar phrasing is not the same as knowing — what counts "
            + "is holding up when the question comes back around in a new moment (transfer; "
            + "Barnett & Ceci's 2002 taxonomy). Explaining ideas back in your own words "
            + "builds that deeper trace (the generation effect).",
    },
    {
        id: 6,
        key: "weeds",
        title: "Weeds",
        line: "When you miss one, I'll ask what happened — a careless slip? a real gap? a "
            + "trap you stepped in? Name it, and a weed marks that spot, so we both know "
            + "exactly what kind of fix it needs.",
        science: "Different mistakes need different fixes: a misread needs slowing down, a "
            + "concept gap needs reteaching. Tagging the cause of an error — a metacognitive "
            + "habit — turns “study more” into a targeted repair.",
    },
    {
        id: 7,
        key: "economy",
        title: "Your water",
        line: "Every answer at my side refills your watering can — the only thing you'll "
            + "ever spend here. And no pour, prize, or trick can ripen a plant: growth is "
            + "only ever earned by knowing.",
        science: "The game layer stays cosmetic on purpose: rewards decorate the work but "
            + "never substitute for it. Because you can't pay the garden to grow, the garden "
            + "can't lie to you about what you know.",
    },
    {
        id: 8,
        key: "almanac",
        title: "The Almanac",
        line: "The Almanac keeps my ledgers: Memory, Performance, Readiness — real numbers "
            + "from the engine beneath us. When a number can't be computed honestly yet, it "
            + "says “not yet” rather than flatter you.",
        science: "Knowing precisely what you know — calibration — is what lets you spend "
            + "your hours where they count. An honest dashboard, even a humbling one, tells "
            + "you what to do next; a flattering one is how test day surprises you.",
    },
    {
        id: 9,
        key: "map",
        title: "The map",
        line: "When the morning mist has lifted, press M for your map — four gardens, one "
            + "for each exam section, and ideas that share soil grow side by side. Travel "
            + "freely, and tend what's due wherever it lives.",
        science: "Knowledge is a connected structure, not a pile of cards. Mixing your "
            + "practice across topics — interleaving — feels harder than blocking, but it "
            + "builds the discrimination between look-alike ideas that real exams demand "
            + "(Rohrer & Taylor, 2007).",
    },
    {
        id: 10,
        key: "harvest",
        title: "The harvest",
        line: "When a sitting ends I'll show you your harvest — what you watered, what "
            + "bloomed. The sky here keeps your real hours, and this garden rewards whoever "
            + "returns a little, daily. Now — come find me at the center, and we'll grow "
            + "something.",
        science: "Distributed practice: many short sittings beat one heroic cram for memory "
            + "that lasts (Cepeda et al., 2006). Seeing each session's progress accrue is "
            + "what turns tending into a habit.",
    },
];

export interface TourSnapshot {
    step: number;
    done: boolean;
}

export function currentStep(state: TourSnapshot): TourStep | null {
    if (state.done || state.step >= TOUR_STEPS.length || state.step < 0) {
        return null;
    }
    return TOUR_STEPS[state.step];
}

/** Forward one beat; finishing the last beat completes the tour. Terminal stays terminal. */
export function advanceTour(state: TourSnapshot): TourSnapshot {
    if (!currentStep(state)) {
        return state;
    }
    const next = state.step + 1;
    if (next >= TOUR_STEPS.length) {
        return { step: next, done: true };
    }
    return { step: next, done: false };
}

/** Skip out from any beat — done forever (the Help panel offers a replay). */
export function skipTour(state: TourSnapshot): TourSnapshot {
    if (state.done) {
        return state;
    }
    return { step: state.step, done: true };
}
