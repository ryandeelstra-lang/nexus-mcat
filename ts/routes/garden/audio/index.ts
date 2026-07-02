// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: the public entry for the adaptive lofi score (docs/26 G4.3; doc 23 §11).
// One call from the app shell — everything below (the Web Audio engine, the environment
// director) is wired here, code-split so Phaser/the world never pull the audio graph, and
// gesture-gated so we honor the browser's autoplay policy (audio starts on the player's
// first click/keypress, never before).
import { bus } from "../state/bus";

import { MusicDirector } from "./music-director";
import type { RegionId } from "./theory";

export { MusicDirector } from "./music-director";
export type { RegionId } from "./theory";

export interface MusicHandle {
    /** Which garden the score sounds like (call as the avatar crosses a border). */
    setRegion(region: RegionId): void;
    setMuted(muted: boolean): void;
    setVolume(v: number): void;
    /** Tear down: unsubscribe from the bus and close the audio context. */
    dispose(): void;
}

export interface StartMusicOptions {
    initialRegion?: RegionId;
    initialVolume?: number;
    initialMuted?: boolean;
    /** When true (or prefers-reduced-motion), the score starts muted. */
    reducedAudio?: boolean;
}

/** A no-op handle for when audio can't run (no Web Audio) — the garden never hard-fails on sound. */
function silentHandle(): MusicHandle {
    return {
        setRegion(_region) {
            return;
        },
        setMuted(_muted) {
            return;
        },
        setVolume(_v) {
            return;
        },
        dispose() {
            return;
        },
    };
}

/**
 * Boot the adaptive score. Returns immediately with a handle; the audio graph is created
 * lazily and only *starts* on the first user gesture. Safe to call during boot — if Web
 * Audio is unavailable (or a prerender pass), it returns a silent handle and logs nothing
 * scary.
 */
export function startGardenMusic(opts: StartMusicOptions = {}): MusicHandle {
    const reduced = opts.reducedAudio
        ?? globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches
        ?? false;

    let director: MusicDirector | null = null;
    let detach: (() => void) | null = null;
    let engineRef: { start(): Promise<void>; dispose(): void } | null = null;
    let disposed = false;
    let gestureBound = false;

    // Deferred region/volume/mute set before the engine exists.
    const pending: { region?: RegionId; volume?: number; muted?: boolean } = {};

    const onFirstGesture = (): void => {
        removeGestureListeners();
        if (disposed) {
            return;
        }
        void (async () => {
            try {
                const { LofiEngine } = await import("./lofi-engine");
                if (disposed) {
                    return;
                }
                const engine = new LofiEngine();
                engineRef = engine;
                director = new MusicDirector({
                    engine,
                    bus,
                    initialRegion: pending.region ?? opts.initialRegion ?? "sakura",
                    initialVolume: pending.volume ?? opts.initialVolume ?? 0.6,
                    initialMuted: pending.muted ?? opts.initialMuted ?? reduced,
                    reducedAudio: reduced,
                });
                detach = director.attach();
                await engine.start();
            } catch {
                // No audio? The garden plays on in silence — never a crash, never a blocker.
            }
        })();
    };

    const gestureEvents = ["pointerdown", "keydown", "touchstart"] as const;
    function addGestureListeners(): void {
        if (gestureBound || typeof globalThis.addEventListener !== "function") {
            return;
        }
        gestureBound = true;
        for (const ev of gestureEvents) {
            globalThis.addEventListener(ev, onFirstGesture, { once: true, passive: true });
        }
    }
    function removeGestureListeners(): void {
        if (!gestureBound) {
            return;
        }
        gestureBound = false;
        for (const ev of gestureEvents) {
            globalThis.removeEventListener?.(ev, onFirstGesture);
        }
    }

    addGestureListeners();

    return {
        setRegion(region) {
            if (director) {
                director.setRegion(region);
            } else {
                pending.region = region;
            }
        },
        setMuted(muted) {
            if (director) {
                director.setMuted(muted);
            } else {
                pending.muted = muted;
            }
        },
        setVolume(v) {
            if (director) {
                director.setVolume(v);
            } else {
                pending.volume = v;
            }
        },
        dispose() {
            disposed = true;
            removeGestureListeners();
            detach?.();
            engineRef?.dispose();
            director = null;
            engineRef = null;
        },
    };
}

export { silentHandle as __silentHandle };
