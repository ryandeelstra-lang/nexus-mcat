// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: the Garden Tour machine (spec: docs/superpowers/specs/
// 2026-07-03-garden-tour-design.md): completable in order, re-entrant, skippable from
// anywhere, terminal stays terminal — and the concept coverage is PINNED so no shipped
// mechanic (nor its named learning science) can silently drop out of the tour.
import { describe, expect, it } from "vitest";

import { advanceTour, currentStep, skipTour, TOUR_STEPS, type TourSnapshot } from "./tour";

/** The full concept map the tour must cover — one key per shipped mechanic (spec §beats). */
const REQUIRED_CONCEPTS = [
    "garden",
    "recall",
    "honesty",
    "water",
    "stages",
    "bloom",
    "weeds",
    "economy",
    "almanac",
    "map",
    "harvest",
];

/** Each concept's science note must NAME its principle, not gesture vaguely. */
const SCIENCE_MARKERS: Record<string, RegExp> = {
    recall: /retrieval practice|testing effect/i,
    honesty: /errorful learning/i,
    water: /spacing effect|forgetting curve/i,
    stages: /fluency illusion/i,
    bloom: /transfer|generating/i,
    weeds: /metacognitive/i,
    almanac: /calibration/i,
    map: /interleaving/i,
    harvest: /distributed practice/i,
};

describe("garden tour — every app concept, science named", () => {
    it("covers exactly the pinned concept set, in order, with stable ids", () => {
        expect(TOUR_STEPS.map((s) => s.key)).toEqual(REQUIRED_CONCEPTS);
        expect(TOUR_STEPS.map((s) => s.id)).toEqual(TOUR_STEPS.map((_, i) => i));
    });

    it("names the learning-science principle behind each mechanic", () => {
        for (const [key, marker] of Object.entries(SCIENCE_MARKERS)) {
            const step = TOUR_STEPS.find((s) => s.key === key);
            expect(step, `missing tour step for concept "${key}"`).toBeDefined();
            expect(step!.science, `science note for "${key}" must name its principle`)
                .toMatch(marker);
        }
    });

    it("completes start-to-finish, one Continue per beat", () => {
        let state: TourSnapshot = { step: 0, done: false };
        for (let i = 0; i < TOUR_STEPS.length; i++) {
            expect(state.done).toBe(false);
            expect(currentStep(state)?.id).toBe(i);
            state = advanceTour(state);
        }
        expect(state.done).toBe(true);
        expect(currentStep(state)).toBeNull();
    });

    it("is re-entrant: resuming mid-way lands on the persisted step", () => {
        const resumed: TourSnapshot = { step: 5, done: false };
        expect(currentStep(resumed)?.key).toBe("bloom");
    });

    it("skips out from any beat, and a skipped tour stays done", () => {
        const skipped = skipTour({ step: 3, done: false });
        expect(skipped.done).toBe(true);
        expect(currentStep(skipped)).toBeNull();
        expect(skipTour(skipped)).toBe(skipped); // reference-equal: no state churn
    });

    it("a finished tour never re-opens", () => {
        const done: TourSnapshot = { step: TOUR_STEPS.length, done: true };
        expect(currentStep(done)).toBeNull();
        expect(advanceTour(done)).toBe(done);
    });

    it("an out-of-range cursor renders nothing instead of crashing", () => {
        expect(currentStep({ step: -1, done: false })).toBeNull();
        expect(currentStep({ step: 99, done: false })).toBeNull();
    });

    it("every beat is renderable: a chip-sized title, a spoken line, a real science note", () => {
        for (const step of TOUR_STEPS) {
            expect(step.title.length).toBeGreaterThan(2);
            expect(step.title.length).toBeLessThanOrEqual(24);
            expect(step.line.length).toBeGreaterThan(40);
            expect(step.science.length).toBeGreaterThan(40);
            expect(step.line).not.toMatch(/TODO|TBD|lorem/i);
            expect(step.science).not.toMatch(/TODO|TBD|lorem/i);
        }
    });
});
