// charged_up: the Knowledge Garden React app shell (Decisions 40-42).
// Two layers (doc 23 §10.1): the Phaser pixel world (canvas) underneath and the crisp DOM
// panel layer (HUD, Keeper, almanac, harvest) on top. This file owns lifecycle + glue:
//   - boot: load the additive store + the engine-truth snapshot, then mount the world
//   - keep the world's registry (masterySnapshot / gardenFlags / panelOpen) in sync
//   - drive the tutorial machine from bus events (doc 23 §10.4), persisting each beat
// It renders honestly: if the engine is unreachable there is no fake world, just the truth.
import React, { useCallback, useEffect, useRef, useState } from "react";

import { type MusicHandle, startGardenMusic } from "./audio";
import type { GardenGame } from "./game/create-game";
import { DEV_TOOLS_ENABLED, DevPanel } from "./panels/DevPanel";
import { GardenErrorBoundary } from "./panels/GardenErrorBoundary";
import { GardenUI } from "./panels/GardenUI";
import { activeWeeds } from "./panels/keeper-logic";
import { bus } from "./state/bus";
import {
    DECAY_REFRESH_INTERVAL_MS,
    type DecayRefreshEvent,
    initialDecayRefresh,
    nextDecayRefresh,
} from "./state/decay-refresh";
import { daysSinceLastActivity, fetchActivityDayBuckets } from "./state/depth-stats";
import { fetchMasterySnapshot, type MasterySnapshot } from "./state/mastery";
import { GardenStore } from "./state/store";
import { advance, currentBeat, type TutorialEvent } from "./state/tutorial";

type BootPhase = "booting" | "ready" | "error";

export function GardenApp(): React.ReactElement {
    const canvasHost = useRef<HTMLDivElement>(null);
    const gameRef = useRef<GardenGame | null>(null);
    const storeRef = useRef<GardenStore | null>(null);
    const musicRef = useRef<MusicHandle | null>(null);
    const [phase, setPhase] = useState<BootPhase>("booting");
    const [bootError, setBootError] = useState<string>("");
    const [snapshot, setSnapshot] = useState<MasterySnapshot | null>(null);

    /** Re-read engine truth and push it into the world (drives re-staging every plant). */
    const refreshSnapshot = useCallback(async (): Promise<void> => {
        const [next, buckets] = await Promise.all([
            fetchMasterySnapshot(),
            fetchActivityDayBuckets(),
        ]);
        setSnapshot(next);
        gameRef.current?.registry.set("masterySnapshot", next);
        gameRef.current?.registry.set("daysAway", daysSinceLastActivity(buckets));
        await pushFlags();
        bus.emit("mastery:refreshed", {});
    }, []);

    /** Push paraphrase passes + active weeds into the world's registry (read-only there). */
    const pushFlags = useCallback(async (): Promise<void> => {
        const store = storeRef.current;
        if (!store) {
            return;
        }
        let weeds: Record<string, unknown> = {};
        try {
            weeds = await activeWeeds();
        } catch {
            // weeds are cosmetic-adjacent; a failed read never blocks the world
        }
        const weedFlags: Record<string, boolean> = {};
        for (const key of Object.keys(weeds)) {
            weedFlags[key] = true;
        }
        gameRef.current?.registry.set("gardenFlags", {
            paraphrase: store.snapshot.paraphrase,
            weeds: weedFlags,
            // Gates the one-time island fog: false renders the shroud + plaza leash.
            placementDone: store.snapshot.placement.done,
        });
    }, []);

    /** Mute/unmute the lofi score (called by the HUD toggle; persistence lives in the store). */
    const setMusicMuted = useCallback((muted: boolean): void => {
        musicRef.current?.setMuted(muted);
    }, []);

    useEffect(() => {
        let cancelled = false;

        void (async () => {
            try {
                // 1. The additive store (currency / pending / tutorial) — sidecar-backed.
                const store = new GardenStore();
                await store.load();
                if (cancelled) {
                    return;
                }
                storeRef.current = store;

                // 2. Engine truth (masteryQuery + deckTree). Refuses to fake a world.
                const snap = await fetchMasterySnapshot();
                if (cancelled) {
                    return;
                }
                setSnapshot(snap);

                // 3. The Phaser world, client-only (doc 23 §12.3). The registry's
                // gardenFlags are seeded from the LOADED store before the game boots:
                // WorldScene latches the fog decision once in create(), and if it ever
                // read a placementDone-less default (the old boot race against the two
                // pushFlags RPCs) a done-placement player was fog-locked with no exit.
                const { createGame, initialGardenFlags } = await import("./game/create-game");
                if (cancelled || !canvasHost.current) {
                    return;
                }
                const game = await createGame(
                    canvasHost.current,
                    snap,
                    initialGardenFlags(store.snapshot),
                );
                gameRef.current = game;
                game.registry.set("floraState", store.snapshot.flora);
                // Living decay: the days-away signal (revlog day-buckets; fails to 0 =
                // pristine). Set before the ready flip; the emit below covers whichever
                // side of scene-create we landed on.
                const buckets = await fetchActivityDayBuckets();
                game.registry.set("daysAway", daysSinceLastActivity(buckets));
                await pushFlags();
                bus.emit("mastery:refreshed", {});
                setPhase("ready");
            } catch (err) {
                if (!cancelled) {
                    setBootError(err instanceof Error ? err.message : String(err));
                    setPhase("error");
                }
            }
        })();

        return () => {
            cancelled = true;
            bus.removeAllListeners();
            gameRef.current?.destroy(true);
            gameRef.current = null;
        };
    }, [pushFlags]);

    // ---- The tutorial driver (doc 23 §10.4): bus events -> machine -> persisted beat ----
    useEffect(() => {
        const store = storeRef.current;
        if (phase !== "ready" || !store) {
            return;
        }

        function feed(event: TutorialEvent): void {
            const s = storeRef.current;
            if (!s || s.snapshot.tutorial.done) {
                return;
            }
            const next = advance(s.snapshot.tutorial, event);
            if (next !== s.snapshot.tutorial) {
                s.setTutorial(next);
                const beat = currentBeat(next);
                bus.emit("tutorial:beat", { beat: beat ? String(beat.id) : "done" });
            }
        }

        const offs = [
            // Reaching the Keeper covers both "walk to the light" and "meet the Keeper".
            bus.on("keeper:interact", () => {
                feed({ kind: "reached-keeper" });
                feed({ kind: "keeper-opened" });
            }),
            bus.on("plant:watered", () => feed({ kind: "watered" })),
            bus.on("ground:watered", () => feed({ kind: "watered" })),
            bus.on("growth:tick", () => feed({ kind: "answered" })),
            bus.on("plant:bloomed", () => {
                feed({ kind: "bloomed" });
                void refreshSnapshot();
            }),
            bus.on("map:toggle", () => feed({ kind: "map-opened" })),
            // Ground-flora pours persist through the additive store (+ registry, so a scene
            // restart restores the grown garden without a reload).
            bus.on("flora:changed", ({ counts }) => {
                storeRef.current?.setFlora(counts);
                gameRef.current?.registry.set("floraState", counts);
            }),
            // Keep the world honest about UI covering it: GardenUI derives ONE open/closed
            // signal from its overlay+flavor state (pairing individual open/close events
            // desyncs — a swapped overlay skips `review:closed` and softlocks the world).
            // While covered we also disable Phaser's keyboard wholesale: its window-level
            // key capture preventDefaults Space/WASD/E/M even when focus is in the typed-
            // answer field, which silently ate those characters.
            bus.on("ui:overlay", ({ open }) => {
                gameRef.current?.registry.set("panelOpen", open);
                const kb = (gameRef.current as unknown as {
                    input?: { keyboard?: { enabled: boolean } };
                })?.input?.keyboard;
                if (kb) {
                    kb.enabled = !open;
                }
            }),
            bus.on("review:closed", () => {
                void refreshSnapshot();
            }),
            // The placement answers were real first reviews — pull the fresh engine truth
            // (and push placementDone into the world's flags) the moment the test ends.
            bus.on("placement:completed", () => {
                void refreshSnapshot();
            }),
        ];
        return () => offs.forEach((off) => off());
    }, [phase, refreshSnapshot]);

    // ---- Living decay (spec 2026-07-05): keep engine truth fresh while the app sits
    // open — a slow tick + window focus, ALWAYS deferred while an overlay is up so the
    // world never re-stages mid-card (three-tier reveal). Read-only; two RPCs per fire.
    useEffect(() => {
        if (phase !== "ready") {
            return;
        }
        let gate = initialDecayRefresh(Date.now());
        const apply = (event: DecayRefreshEvent): void => {
            const next = nextDecayRefresh(gate, event, Date.now());
            gate = next.state;
            if (next.refresh) {
                void refreshSnapshot();
            }
        };
        const interval = window.setInterval(
            () => apply({ kind: "tick" }),
            DECAY_REFRESH_INTERVAL_MS,
        );
        const onVisible = (): void => {
            if (document.visibilityState === "visible") {
                apply({ kind: "focus" });
            }
        };
        window.addEventListener("focus", onVisible);
        document.addEventListener("visibilitychange", onVisible);
        const offs = [
            bus.on("ui:overlay", ({ open }) => apply({ kind: "overlay", open })),
            bus.on("review:closed", () => apply({ kind: "review-closed" })),
        ];
        return () => {
            window.clearInterval(interval);
            window.removeEventListener("focus", onVisible);
            document.removeEventListener("visibilitychange", onVisible);
            offs.forEach((off) => off());
        };
    }, [phase, refreshSnapshot]);

    // ---- The adaptive lofi score (doc 23 §11, docs/26 G4.3) ----
    // Boot once the world is ready so we honor the player's saved sound settings. The audio
    // graph is created lazily on the first user gesture (autoplay policy), then the director
    // adapts the mix to garden + time-of-day + activity from the same bus the world drives.
    useEffect(() => {
        if (phase !== "ready") {
            return;
        }
        const settings = storeRef.current?.snapshot.settings;
        const handle = startGardenMusic({
            initialMuted: settings?.muted ?? false,
            initialVolume: settings?.volume ?? 0.7,
        });
        musicRef.current = handle;
        return () => {
            handle.dispose();
            musicRef.current = null;
        };
    }, [phase]);

    return (
        <div className="garden-app">
            <div ref={canvasHost} className="garden-canvas" />
            {phase === "booting" && (
                <div className="garden-boot" role="status">
                    <span className="garden-boot-text">Tending the soil…</span>
                </div>
            )}
            {phase === "error" && (
                <div className="garden-boot garden-boot-error" role="alert">
                    <span className="garden-boot-text">
                        The garden could not reach the engine: {bootError}
                    </span>
                </div>
            )}
            {phase === "ready" && snapshot && storeRef.current && (
                <GardenErrorBoundary label="panels">
                    <GardenUI
                        store={storeRef.current}
                        snapshot={snapshot}
                        refreshSnapshot={refreshSnapshot}
                        onMusicMutedChange={setMusicMuted}
                    />
                </GardenErrorBoundary>
            )}
            {
                /* Dev-only: skip the first-run flow while iterating. Never renders in a clean
              * public build (devToolsEnabled() is false without the Vite dev server or ?dev). */
            }
            {DEV_TOOLS_ENABLED && <DevPanel />}
        </div>
    );
}
