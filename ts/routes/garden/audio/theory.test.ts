// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: G4.3 gate — the adaptive-music BRAIN is pure + pinned (docs/26 G4.3).
// These lock the "changes with your environment" contract without touching Web Audio:
//   region → distinct musical identity · §9.5 clock → brightness · activity → layer mix.
import { describe, expect, it } from "vitest";

import { midiToFreq, type Mood, REGION_IDS, REGION_PROFILES, regionForSection, skyState, toneTargets } from "./theory";

const at = (h: number, m = 0): Date => {
    const d = new Date(2026, 6, 2, h, m, 0, 0); // fixed local wall-clock; DST-free math
    return d;
};

describe("midiToFreq — the tuning reference", () => {
    it("A4 (69) is 440 Hz and octaves double", () => {
        expect(midiToFreq(69)).toBeCloseTo(440, 6);
        expect(midiToFreq(81)).toBeCloseTo(880, 6);
        expect(midiToFreq(57)).toBeCloseTo(220, 6);
    });
});

describe("region profiles — every garden has a distinct, well-formed identity", () => {
    it("all four regions exist with a 4-bar loop and a non-empty scale", () => {
        expect(REGION_IDS).toHaveLength(4);
        for (const id of REGION_IDS) {
            const p = REGION_PROFILES[id];
            expect(p.id).toBe(id);
            expect(p.progression).toHaveLength(4);
            expect(p.leadScale.length).toBeGreaterThan(0);
            expect(p.bpm).toBeGreaterThanOrEqual(60);
            expect(p.bpm).toBeLessThanOrEqual(84);
            for (const chord of p.progression) {
                expect(chord.notes.length).toBeGreaterThanOrEqual(3);
                expect(Number.isFinite(chord.bass)).toBe(true);
            }
        }
    });

    it("regions are musically distinct (tempo or key differs), not one reskinned loop", () => {
        const tempos = REGION_IDS.map((id) => REGION_PROFILES[id].bpm);
        expect(new Set(tempos).size).toBeGreaterThan(1);
        const firstChords = REGION_IDS.map((id) => REGION_PROFILES[id].progression[0].bass);
        expect(new Set(firstChords).size).toBeGreaterThan(1);
    });

    it("maps MCAT sections onto themed gardens (doc 23 §9.3)", () => {
        expect(regionForSection("B-B")).toBe("keukenhof");
        expect(regionForSection("CARS")).toBe("gardens-by-the-bay");
        expect(regionForSection("")).toBe("sakura"); // safe v1 default
    });
});

describe("skyState — the doc 23 §9.5 clock drives brightness", () => {
    it("4:00–8:00 local is night (sparse, dark)", () => {
        expect(skyState(at(4, 30)).isNight).toBe(true);
        expect(skyState(at(7, 59)).isNight).toBe(true);
        expect(skyState(at(8, 0)).isNight).toBe(false);
        // 3:59 AM is the tail of the 20-hour daylight window (dusk), not night —
        // night doesn't begin until 4:00 (doc 23 §9.5: day runs 8 AM → 4 AM next day).
        expect(skyState(at(3, 59)).isNight).toBe(false);
        expect(skyState(at(3, 59)).dayProgress).toBeGreaterThan(0.95);
    });

    it("golden peak (6 PM) is the brightest moment of the day", () => {
        const peak = skyState(at(18, 0)).brightness;
        const dawn = skyState(at(8, 15)).brightness;
        const night = skyState(at(5, 0)).brightness;
        expect(peak).toBeGreaterThan(dawn);
        expect(peak).toBeGreaterThan(night);
        expect(peak).toBeCloseTo(1, 1);
        expect(night).toBeLessThan(0.2);
    });

    it("dayProgress runs 0 at sunrise toward 0.5 at the 6 PM peak", () => {
        expect(skyState(at(8, 0)).dayProgress).toBeCloseTo(0, 2);
        expect(skyState(at(18, 0)).dayProgress).toBeCloseTo(0.5, 2);
    });
});

describe("toneTargets — activity + time shape the adaptive mix", () => {
    const day = skyState(at(18, 0)); // bright peak
    const night = skyState(at(5, 0));

    it("bloom ducks the bed hard so the chime rings (contrast rule)", () => {
        const wandering = toneTargets(day, "wandering");
        const bloom = toneTargets(day, "bloom");
        expect(bloom.mix.pad).toBeLessThan(wandering.mix.pad);
        expect(bloom.mix.drums).toBeLessThan(wandering.mix.drums * 0.6);
        expect(bloom.cutoffHz).toBeLessThan(wandering.cutoffHz);
    });

    it("studying tucks the melody away for focus but keeps a soft bed", () => {
        const wandering = toneTargets(day, "wandering");
        const studying = toneTargets(day, "studying");
        expect(studying.mix.lead).toBeLessThan(wandering.mix.lead * 0.5);
        expect(studying.mix.pad).toBeGreaterThan(0.2);
        expect(studying.cutoffHz).toBeLessThan(wandering.cutoffHz);
    });

    it("night is warmer + darker + more vinyl than the bright peak", () => {
        const dayW = toneTargets(day, "wandering");
        const nightW = toneTargets(night, "wandering");
        expect(nightW.cutoffHz).toBeLessThan(dayW.cutoffHz);
        expect(nightW.mix.vinyl).toBeGreaterThan(dayW.mix.vinyl);
        expect(nightW.mix.drums).toBeLessThan(dayW.mix.drums);
    });

    it("every layer target stays within [0,1] across all moods and times", () => {
        const moods: Mood[] = ["wandering", "studying", "bloom", "harvest"];
        for (const sky of [day, night, skyState(at(8, 30))]) {
            for (const mood of moods) {
                const { mix, cutoffHz } = toneTargets(sky, mood);
                for (const v of Object.values(mix)) {
                    expect(v).toBeGreaterThanOrEqual(0);
                    expect(v).toBeLessThanOrEqual(1);
                }
                expect(cutoffHz).toBeGreaterThanOrEqual(500);
                expect(cutoffHz).toBeLessThanOrEqual(4000);
            }
        }
    });
});
