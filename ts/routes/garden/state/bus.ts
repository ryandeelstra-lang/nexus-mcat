// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: the ONE bridge between the React panel layer and the Phaser world
// (doc 23 §12.3 "pass events between React and the engine via an event emitter").
// Keep this surface tiny and typed; anything not expressible here is a design smell.

export interface GardenEvents {
    /** The player walked up to a plant and pressed interact. */
    "plant:interact": { nodeId: string };
    /** A pour was spent on a plant (already validated by the store). */
    "plant:watered": { nodeId: string };
    /** A seed was spent planting a topic (queues its intro cards). */
    "plant:planted": { nodeId: string };
    /** A graded answer landed in the engine; the world should tick growth. */
    "growth:tick": { nodeId: string; rating: number; msTaken: number; fast: boolean };
    /** The paraphrase gate passed for a topic — the bloom moment (biggest juice). */
    "plant:bloomed": { nodeId: string };
    /** The player interacted with the Keeper — open the review panel. */
    "keeper:interact": Record<string, never>;
    /** The review panel closed (session end) — the world may run the harvest beat. */
    "review:closed": { answered: number; blooms: number };
    /** Open/close the map overlay. */
    "map:toggle": Record<string, never>;
    /** Teleport the avatar to a waystone. */
    "map:travel": { waystoneId: string };
    /** Mastery snapshot refreshed — world should restage plants. */
    "mastery:refreshed": Record<string, never>;
    /** The avatar crossed into a garden region — cosmetic layers (sky, music) may react.
     *  `region` is one of the four garden ids (see audio/theory RegionId); typed as string
     *  here to keep the state layer decoupled from the audio layer. */
    "region:entered": { region: string };
    /** Tutorial scripting: focus the camera / show a beat marker. */
    "tutorial:beat": { beat: string };
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
