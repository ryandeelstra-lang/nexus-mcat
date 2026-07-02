// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: G4.3 gate — the MusicDirector wires world signals to the mix correctly
// (docs/26 G4.3), with the Web Audio engine faked so the whole decision path is testable:
//   keeper → studying (melody recedes) · bloom → duck-then-return · region → new identity ·
//   mute passthrough · time-of-day drift.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TypedBus } from "../state/bus";
import type { MusicEngine } from "./lofi-engine";
import { MusicDirector, type MusicDirectorOptions } from "./music-director";
import { type LayerMix, REGION_PROFILES, type RegionProfile } from "./theory";

class FakeEngine implements MusicEngine {
    running = false;
    region: RegionProfile | null = null;
    mix: LayerMix | null = null;
    cutoff = 0;
    volume = -1;
    muted: boolean | null = null;
    mixHistory: LayerMix[] = [];

    start(): Promise<void> {
        this.running = true;
        return Promise.resolve();
    }
    stop(): void {
        this.running = false;
    }
    dispose(): void {
        return;
    }
    setRegion(p: RegionProfile): void {
        this.region = p;
    }
    setLayerMix(mix: LayerMix): void {
        this.mix = mix;
        this.mixHistory.push(mix);
    }
    setCutoff(hz: number): void {
        this.cutoff = hz;
    }
    setMasterVolume(v: number): void {
        this.volume = v;
    }
    setMuted(muted: boolean): void {
        this.muted = muted;
    }
}

/** A fixed daytime clock so tests aren't wall-clock dependent. */
const noonish = () => new Date(2026, 6, 2, 18, 0, 0);

let engine: FakeEngine;
let bus: TypedBus;
let director: MusicDirector;
let detach: () => void;

function makeDirector(over: Partial<MusicDirectorOptions> = {}) {
    director = new MusicDirector({
        engine,
        bus,
        now: noonish,
        driftMs: 1_000_000, // keep the drift timer out of the way in tests
        ...over,
    });
    detach = director.attach();
}

beforeEach(() => {
    vi.useFakeTimers();
    engine = new FakeEngine();
    bus = new TypedBus();
});

afterEach(() => {
    detach?.();
    vi.useRealTimers();
});

describe("MusicDirector — construction", () => {
    it("sets the initial region identity + volume on the engine", () => {
        makeDirector({ initialRegion: "keukenhof", initialVolume: 0.5 });
        expect(engine.region).toBe(REGION_PROFILES.keukenhof);
        expect(engine.volume).toBe(0.5);
        expect(engine.muted).toBe(false);
    });

    it("reduced-audio users start muted (doc 23 §10.5 companion)", () => {
        makeDirector({ reducedAudio: true });
        expect(engine.muted).toBe(true);
    });

    it("pushes an initial mix on attach", () => {
        makeDirector();
        expect(engine.mix).not.toBeNull();
        expect(engine.cutoff).toBeGreaterThan(0);
    });
});

describe("MusicDirector — activity drives the mix", () => {
    it("keeper:interact recedes the melody (studying focus mix)", () => {
        makeDirector();
        const wanderingLead = engine.mix!.lead;
        bus.emit("keeper:interact", {});
        expect(director.mood).toBe("studying");
        expect(engine.mix!.lead).toBeLessThan(wanderingLead * 0.5);
        expect(engine.mix!.pad).toBeGreaterThan(0.2); // bed stays present
    });

    it("review:closed with no blooms returns to wandering", () => {
        makeDirector();
        bus.emit("keeper:interact", {});
        expect(director.mood).toBe("studying");
        bus.emit("review:closed", { answered: 5, blooms: 0 });
        expect(director.mood).toBe("wandering");
    });
});

describe("MusicDirector — the bloom duck (contrast rule)", () => {
    it("ducks the bed on bloom, then restores it after the hold", () => {
        makeDirector({ bloomDuckMs: 2000 });
        const before = engine.mix!.pad;
        bus.emit("plant:bloomed", { nodeId: "PS.1A" });
        expect(director.mood).toBe("bloom");
        expect(engine.mix!.pad).toBeLessThan(before);

        vi.advanceTimersByTime(2000);
        expect(director.mood).toBe("wandering");
        expect(engine.mix!.pad).toBeCloseTo(before, 5);
    });

    it("a bloom mid-study returns to studying, not wandering", () => {
        makeDirector({ bloomDuckMs: 1500 });
        bus.emit("keeper:interact", {});
        bus.emit("plant:bloomed", { nodeId: "PS.1A" });
        expect(director.mood).toBe("bloom");
        vi.advanceTimersByTime(1500);
        expect(director.mood).toBe("studying");
    });

    it("review:closed with blooms resolves warm (harvest) then settles", () => {
        makeDirector({ harvestMs: 3000 });
        bus.emit("keeper:interact", {});
        bus.emit("review:closed", { answered: 8, blooms: 2 });
        expect(director.mood).toBe("harvest");
        vi.advanceTimersByTime(3000);
        expect(director.mood).toBe("wandering");
    });
});

describe("MusicDirector — region + settings", () => {
    it("crossing into a new garden swaps the musical identity", () => {
        makeDirector({ initialRegion: "sakura" });
        expect(engine.region).toBe(REGION_PROFILES.sakura);
        director.setRegion("gardens-by-the-bay");
        expect(engine.region).toBe(REGION_PROFILES["gardens-by-the-bay"]);
    });

    it("follows a region:entered bus event from the world", () => {
        makeDirector({ initialRegion: "sakura" });
        bus.emit("region:entered", { region: "versailles" });
        expect(engine.region).toBe(REGION_PROFILES.versailles);
    });

    it("ignores an unknown region string (fails safe, stays put)", () => {
        makeDirector({ initialRegion: "sakura" });
        bus.emit("region:entered", { region: "atlantis" });
        expect(engine.region).toBe(REGION_PROFILES.sakura);
    });

    it("re-entering the same region is a no-op (no needless reschedule)", () => {
        makeDirector({ initialRegion: "sakura" });
        const calls = engine.mixHistory.length;
        director.setRegion("sakura");
        expect(engine.mixHistory.length).toBe(calls);
    });

    it("mute + volume pass through to the engine", () => {
        makeDirector();
        director.setMuted(true);
        expect(engine.muted).toBe(true);
        director.setVolume(0.33);
        expect(engine.volume).toBe(0.33);
    });

    it("detach stops driving the mix (bus events go ignored)", () => {
        makeDirector();
        detach();
        const calls = engine.mixHistory.length;
        bus.emit("keeper:interact", {});
        expect(engine.mixHistory.length).toBe(calls);
    });
});
