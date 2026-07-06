// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: the ONE bridge between the React panel layer and the Phaser world
// (doc 23 §12.3 "pass events between React and the engine via an event emitter").
// Keep this surface tiny and typed; anything not expressible here is a design smell.

import type { DepthStats } from "./depth-stats";

export interface GardenEvents {
    /** The player walked up to a plant and pressed interact. */
    "plant:interact": { nodeId: string };
    /** A pour was spent on a plant (already validated by the store). */
    "plant:watered": { nodeId: string };
    /**
     * The player watered the ground itself (Space anywhere — the primary tending verb).
     * `x`/`y` are world px for the cosmetic greening burst; `nodeId` is the nearest plot the
     * pour reaches (or null on open ground). `aimTileX/Y` is the tile the watering can
     * POINTS at (one tile ahead of the avatar's facing) — the bone-meal splash center.
     * The panel layer validates/spends water and, when a plot is reached, queues it for
     * the next Keeper visit.
     */
    "ground:watered": {
        x: number;
        y: number;
        nodeId: string | null;
        aimTileX: number;
        aimTileY: number;
    };
    /** The world asks the panel layer whether a pour is affordable (HUD feedback only). */
    "water:denied": Record<string, never>;
    /** A pour was PAID FOR (panel ledger) — the world grows the preset ground flora at the
     *  splash (aim +2, ring +1; bloom at each tile's own 3–7 threshold). */
    "flora:water": { aimTileX: number; aimTileY: number };
    /** Ground-flora watered counts changed — the app layer persists them (additive store). */
    "flora:changed": { counts: Record<string, number> };
    /** Every flower of one preset color band just bloomed — a cohesion celebration. */
    "flora:band-bloomed": { section: string; bandId: string; flowers: number };
    /** A graded answer landed in the engine; the world should tick growth. */
    "growth:tick": { nodeId: string; rating: number; msTaken: number; fast: boolean };
    /** The paraphrase gate passed for a topic — the bloom moment (biggest juice). */
    "plant:bloomed": { nodeId: string };
    /** The player interacted with the Keeper — open the review panel. */
    "keeper:interact": Record<string, never>;
    /** The player walked up to a sector stone and pressed interact — open that section's
     *  trial: a short multiple-choice exam drawn from the open MCQ bank. `section` is one
     *  of the four garden ids (P-S / B-B / C-P / CARS). */
    "trial:interact": { section: string };
    /** A stone trial paid out — the world answers with a reward shower over the garden
     *  (the "reward them with a bunch of water" beat). `water` is the amount granted. */
    "trial:rewarded": { water: number };
    /** The player walked up to a landmark/prop and pressed interact — a Keeper-voiced flavor
     *  line tied to the geography (the "items interact with each character" beat). */
    "world:flavor": { title: string; line: string };
    /** The review panel closed (session end) — the world may run the harvest beat. */
    "review:closed": { answered: number; blooms: number };
    /** Open/close the map overlay. */
    "map:toggle": Record<string, never>;
    /** Teleport the avatar to a waystone. */
    "map:travel": { waystoneId: string };
    /** Teleport the avatar to a clicked map tile (map-first "drop in", doc 23 §6.4).
     *  The world validates the landing — open GRASS only, never water/path/plaza, never
     *  a solid base box — and ignores invalid requests. */
    "map:teleport": { tileX: number; tileY: number };
    /** The map scene reports open/close (it also closes itself on Esc) so the
     *  panel layer can yield bottom-of-screen UI (e.g. the walk hint). */
    "map:visible": { open: boolean };
    /** Mastery snapshot refreshed — world should restage plants. */
    "mastery:refreshed": Record<string, never>;
    /** The avatar crossed into a garden region — cosmetic layers (sky, music) may react.
     *  `region` is one of the four garden ids (see audio/theory RegionId); typed as string
     *  here to keep the state layer decoupled from the audio layer. */
    "region:entered": { region: string };
    /** Tutorial scripting: focus the camera / show a beat marker. */
    "tutorial:beat": { beat: string };
    /** The master's 20-question placement test finished — the world lifts the island fog
     *  (one-time onboarding shroud) and the app refreshes engine truth (the answers were
     *  real first reviews). */
    "placement:completed": { answered: number; knew: number };
    /** ONE derived signal: some panel/overlay/flavor line covers the world. The world
     *  gates hotkeys + Phaser key-capture on it (never pair open/close events — a
     *  swapped overlay skips the close event and softlocks the world). */
    "ui:overlay": { open: boolean };
    /** Super Depth Analysis: teleport to the Overlook with a freshly assembled stats
     *  snapshot (the panel layer owns the fetch; the world owns the island). */
    "island:enter": { stats: DepthStats };
    /** Leave the Overlook — land back where you stood (validated, anti-softlock). */
    "island:exit": Record<string, never>;
    /** The world reports Overlook presence so the HUD can flip Depth ↔ Garden. */
    "island:state": { on: boolean };
}

type Handler<T> = (payload: T) => void;

export class TypedBus {
    private handlers = new Map<string, Set<Handler<unknown>>>();

    on<K extends keyof GardenEvents>(event: K, fn: Handler<GardenEvents[K]>): () => void {
        let set = this.handlers.get(event);
        if (!set) {
            set = new Set();
            this.handlers.set(event, set);
        }
        set.add(fn as Handler<unknown>);
        return () => this.off(event, fn);
    }

    off<K extends keyof GardenEvents>(event: K, fn: Handler<GardenEvents[K]>): void {
        this.handlers.get(event)?.delete(fn as Handler<unknown>);
    }

    emit<K extends keyof GardenEvents>(event: K, payload: GardenEvents[K]): void {
        this.handlers.get(event)?.forEach((fn) => fn(payload));
    }

    removeAllListeners(): void {
        this.handlers.clear();
    }
}

export const bus = new TypedBus();
