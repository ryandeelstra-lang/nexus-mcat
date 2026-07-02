// charged_up: the Knowledge Garden React app shell (Decisions 40-42).
// Two layers (doc 23 §10.1): the Phaser pixel world (canvas) underneath and the crisp DOM
// panel layer (HUD, Keeper, almanac, harvest) on top. This file owns lifecycle + glue:
//   - boot: load the additive store + the engine-truth snapshot, then mount the world
//   - keep the world's registry (masterySnapshot / gardenFlags / panelOpen) in sync
//   - drive the tutorial machine from bus events (doc 23 §10.4), persisting each beat
// It renders honestly: if the engine is unreachable there is no fake world, just the truth.
import React, { useCallback, useEffect, useRef, useState } from "react";

import type { GardenGame } from "./game/create-game";
import { GardenUI } from "./panels/GardenUI";
import { activeWeeds } from "./panels/keeper-logic";
import { bus } from "./state/bus";
import { fetchMasterySnapshot, type MasterySnapshot } from "./state/mastery";
import { GardenStore } from "./state/store";
import { advance, currentBeat, type TutorialEvent } from "./state/tutorial";

type BootPhase = "booting" | "ready" | "error";

export function GardenApp(): React.ReactElement {
    const canvasHost = useRef<HTMLDivElement>(null);
    const gameRef = useRef<GardenGame | null>(null);
    const storeRef = useRef<GardenStore | null>(null);
    const [phase, setPhase] = useState<BootPhase>("booting");
    const [bootError, setBootError] = useState<string>("");
    const [snapshot, setSnapshot] = useState<MasterySnapshot | null>(null);

    /** Re-read engine truth and push it into the world (drives re-staging every plant). */
    const refreshSnapshot = useCallback(async (): Promise<void> => {
        const next = await fetchMasterySnapshot();
        setSnapshot(next);
        gameRef.current?.registry.set("masterySnapshot", next);
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
        });
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

                // 3. The Phaser world, client-only (doc 23 §12.3).
                const { createGame } = await import("./game/create-game");
                if (cancelled || !canvasHost.current) {
                    return;
                }
                const game = await createGame(canvasHost.current, snap);
                gameRef.current = game;
                await pushFlags();
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
            bus.on("plant:planted", () => feed({ kind: "planted" })),
            bus.on("plant:watered", () => feed({ kind: "watered" })),
            bus.on("growth:tick", () => feed({ kind: "answered" })),
            bus.on("plant:bloomed", () => {
                feed({ kind: "bloomed" });
                void refreshSnapshot();
            }),
            bus.on("map:toggle", () => feed({ kind: "map-opened" })),
            // Keep the world's panelOpen flag honest so Space never double-fires.
            bus.on("keeper:interact", () => gameRef.current?.registry.set("panelOpen", true)),
            bus.on("review:closed", () => {
                gameRef.current?.registry.set("panelOpen", false);
                void refreshSnapshot();
            }),
        ];
        return () => offs.forEach((off) => off());
    }, [phase, refreshSnapshot]);

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
                <GardenUI
                    store={storeRef.current}
                    snapshot={snapshot}
                    refreshSnapshot={refreshSnapshot}
                />
            )}
        </div>
    );
}
