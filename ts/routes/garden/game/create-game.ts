// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: client-only Phaser factory (doc 23 §12.3). Dynamic-imported by GardenApp so
// Phaser never loads on any other page and never runs during a prerender pass.
import { bus } from "../state/bus";
import type { MasterySnapshot } from "../state/mastery";
import type { GardenDoc } from "../state/store";

import type { GardenFlags } from "./scenes/world-scene";

/**
 * The first-frame gardenFlags seed, from the already-loaded store document. WorldScene
 * latches the onboarding-fog decision ONCE in create(), and the only later lift is
 * placement:completed — an event a done-placement player can never re-fire. So the seed
 * must carry the truthful placementDone (and paraphrase passes) BEFORE the game boots;
 * only the RPC-sourced weeds may land later via pushFlags.
 */
export function initialGardenFlags(doc: GardenDoc): GardenFlags {
    return {
        paraphrase: doc.paraphrase,
        weeds: {},
        placementDone: doc.placement.done,
    };
}

export interface GardenGame {
    destroy(removeCanvas: boolean): void;
    registry: {
        set(key: string, value: unknown): unknown;
        get(key: string): unknown;
    };
}

export async function createGame(
    parent: HTMLElement,
    snapshot: MasterySnapshot,
    flags: GardenFlags,
): Promise<GardenGame> {
    const Phaser = await import("phaser");
    const { BootScene } = await import("./scenes/boot-scene");
    const { WorldScene } = await import("./scenes/world-scene");
    const { MapScene } = await import("./scenes/map-scene");

    const reducedMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches
        ?? false;

    const game = new Phaser.Game({
        type: Phaser.AUTO,
        parent,
        pixelArt: true,
        backgroundColor: "#1a2b1e",
        scale: {
            mode: Phaser.Scale.RESIZE,
            width: "100%",
            height: "100%",
        },
        physics: {
            default: "arcade",
            arcade: { debug: false },
        },
        scene: [BootScene, WorldScene, MapScene],
    });

    game.registry.set("masterySnapshot", snapshot);
    game.registry.set("reducedMotion", reducedMotion);
    game.registry.set("gardenFlags", flags);
    game.registry.set("panelOpen", false);
    game.registry.set("bus", bus);

    // Dev/verification handles (harmless in prod): let the CDP harness inspect scenes and
    // drive bus events (e.g. unlock sectors for per-region screenshots) when verifying
    // render fidelity (docs/26 gate evidence).
    (globalThis as Record<string, unknown>).__gardenGame = game;
    (globalThis as Record<string, unknown>).__gardenBus = bus;

    return game;
}
