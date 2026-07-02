// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: the MUSIC DIRECTOR (docs/26 G4.3; doc 23 §11). The "environment brain" that
// wires the garden's world signals to the lofi engine so the score genuinely "changes with
// your environment": which garden you're in (region → musical identity), your device's real
// clock (day/night → brightness, per doc 23 §9.5), and what you're doing right now (bus
// events → the adaptive layer mix). It owns NO audio DSP (that's lofi-engine.ts) and NO
// musical facts (that's theory.ts) — it only decides *when* to move the knobs.
//
// The engine is injected (MusicEngine), so every decision here is testable with a fake and
// never needs Web Audio. Integrity: purely cosmetic, reads environment only (like the sky).
import type { GardenEvents } from "../state/bus";

import { type Mood, REGION_IDS, REGION_PROFILES, type RegionId, skyState, toneTargets } from "./theory";

function isRegionId(v: string): v is RegionId {
    return (REGION_IDS as readonly string[]).includes(v);
}
import type { MusicEngine } from "./lofi-engine";

/** The slice of the garden bus the director listens to. */
export interface EventBus {
    on<K extends keyof GardenEvents>(
        event: K,
        fn: (payload: GardenEvents[K]) => void,
    ): () => void;
}

export interface MusicDirectorOptions {
    engine: MusicEngine;
    bus: EventBus;
    /** Starting garden (the score's initial identity). Defaults to the v1 Sakura region. */
    initialRegion?: RegionId;
    /** Reduced-audio users start muted (companion to prefers-reduced-motion, doc 23 §10.5). */
    reducedAudio?: boolean;
    initialVolume?: number;
    initialMuted?: boolean;
    /** Injectable clock for deterministic tests. */
    now?: () => Date;
    /** How long the bloom "duck" holds before the bed returns (ms). */
    bloomDuckMs?: number;
    /** How long the harvest warmth holds before returning to wandering (ms). */
    harvestMs?: number;
    /** Cadence of the time-of-day re-evaluation (ms). */
    driftMs?: number;
}

type Overlay = "bloom" | "harvest" | null;

export class MusicDirector {
    private readonly engine: MusicEngine;
    private readonly bus: EventBus;
    private readonly now: () => Date;
    private readonly bloomDuckMs: number;
    private readonly harvestMs: number;
    private readonly driftMs: number;

    private region: RegionId;
    private panelOpen = false;
    private overlay: Overlay = null;

    private unsubs: Array<() => void> = [];
    private drift: ReturnType<typeof setInterval> | null = null;
    private overlayTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(opts: MusicDirectorOptions) {
        this.engine = opts.engine;
        this.bus = opts.bus;
        this.now = opts.now ?? (() => new Date());
        this.bloomDuckMs = opts.bloomDuckMs ?? 2600;
        this.harvestMs = opts.harvestMs ?? 4500;
        this.driftMs = opts.driftMs ?? 15000;
        this.region = opts.initialRegion ?? "sakura";

        this.engine.setRegion(REGION_PROFILES[this.region]);
        this.engine.setMasterVolume(opts.initialVolume ?? 0.7);
        this.engine.setMuted(opts.initialMuted ?? opts.reducedAudio ?? false);
    }

    /** Subscribe to the world + begin driving the mix. Returns a detach function. */
    attach(): () => void {
        this.unsubs.push(
            this.bus.on("keeper:interact", () => {
                this.panelOpen = true;
                this.apply();
            }),
            this.bus.on("review:closed", (p) => {
                this.panelOpen = false;
                // A session with blooms resolves warm; otherwise straight back to wandering.
                if (p.blooms > 0) {
                    this.setOverlay("harvest", this.harvestMs);
                } else {
                    this.apply();
                }
            }),
            this.bus.on("plant:bloomed", () => {
                // The keystone moment: duck the whole bed so the bloom chime rings out.
                this.setOverlay("bloom", this.bloomDuckMs);
            }),
            this.bus.on("region:entered", (p) => {
                // The world announces a border crossing; the score changes gardens with it.
                if (isRegionId(p.region)) {
                    this.setRegion(p.region);
                }
            }),
        );
        this.drift = setInterval(() => this.apply(), this.driftMs);
        this.apply();
        return () => this.detach();
    }

    detach(): void {
        for (const off of this.unsubs) {
            off();
        }
        this.unsubs = [];
        if (this.drift !== null) {
            clearInterval(this.drift);
            this.drift = null;
        }
        if (this.overlayTimer !== null) {
            clearTimeout(this.overlayTimer);
            this.overlayTimer = null;
        }
    }

    /** The world tells us which garden the avatar is standing in. */
    setRegion(region: RegionId): void {
        if (region === this.region) {
            return;
        }
        this.region = region;
        this.engine.setRegion(REGION_PROFILES[region]);
        // Region is a musical-identity change (handled in the engine at the next bar); the
        // mix/brightness also re-evaluates in case the new region shifts nothing else.
        this.apply();
    }

    setMuted(muted: boolean): void {
        this.engine.setMuted(muted);
    }

    setVolume(v: number): void {
        this.engine.setMasterVolume(v);
    }

    /** The active mood: a temporary overlay wins, else the base activity. */
    get mood(): Mood {
        if (this.overlay === "bloom") {
            return "bloom";
        }
        if (this.overlay === "harvest") {
            return "harvest";
        }
        return this.panelOpen ? "studying" : "wandering";
    }

    private setOverlay(kind: Exclude<Overlay, null>, holdMs: number): void {
        this.overlay = kind;
        this.apply();
        if (this.overlayTimer !== null) {
            clearTimeout(this.overlayTimer);
        }
        this.overlayTimer = setTimeout(() => {
            this.overlay = null;
            this.overlayTimer = null;
            this.apply();
        }, holdMs);
    }

    /** Recompute targets from (time-of-day × mood) and push them to the engine. */
    private apply(): void {
        const sky = skyState(this.now());
        const { mix, cutoffHz } = toneTargets(sky, this.mood);
        this.engine.setLayerMix(mix);
        this.engine.setCutoff(cutoffHz);
    }
}
