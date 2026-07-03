// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: client-only Phaser factory (doc 23 §12.3). Dynamic-imported by GardenApp so
// Phaser never loads on any other page and never runs during a prerender pass.
import { bus } from "../state/bus";
import type { MasterySnapshot } from "../state/mastery";

import type { GardenFlags } from "./scenes/world-scene";

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
): Promise<GardenGame> {
    const Phaser = await import("phaser");
    const { BootScene } = await import("./scenes/boot-scene");
    const { WorldScene } = await import("./scenes/world-scene");
    const { MapScene } = await import("./scenes/map-scene");

    const reducedMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches
        ?? false;

    const defaultFlags: GardenFlags = { paraphrase: {}, weeds: {} };

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
    game.registry.set("gardenFlags", defaultFlags);
    game.registry.set("panelOpen", false);
    game.registry.set("bus", bus);

    // Dev/verification handles (harmless in prod): let the CDP harness inspect scenes and
    // drive bus events (e.g. unlock sectors for per-region screenshots) when verifying
    // render fidelity (docs/26 gate evidence).
    (globalThis as Record<string, unknown>).__gardenGame = game;
    (globalThis as Record<string, unknown>).__gardenBus = bus;

    return game;
}
