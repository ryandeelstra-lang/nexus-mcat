// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: G1.3 gate — pending-queue + persistence semantics of the additive garden
// store (docs/26 I5). The transport is faked; what's pinned is the CONTRACT: queue
// accumulation, delivery, paraphrase records, and survival across a simulated restart.
import { describe, expect, it } from "vitest";

import { type GardenDoc, GardenStore } from "./store";

/** In-memory fake of the gardenState bridge (simulates the sidecar across restarts). */
function fakeSidecar(initial: Partial<GardenDoc> = {}) {
    const disk = new Map<string, unknown>(Object.entries(initial));
    return {
        disk,
        transport: {
            get: () => Promise.resolve(Object.fromEntries(disk) as Partial<GardenDoc>),
            set: (key: keyof GardenDoc, doc: unknown) => {
                disk.set(key, doc);
                return Promise.resolve();
            },
        },
    };
}

describe("GardenStore — the additive store contract", () => {
    it("fresh profile loads the doc 23 §7 starting state", async () => {
        const { transport } = fakeSidecar();
        const store = new GardenStore(transport);
        const doc = await store.load();
        expect(doc.economy).toEqual({ seeds: 40, water: 80, xp: 0 });
        expect(doc.pending).toEqual([]);
        expect(doc.tutorial).toEqual({ beat: 0, done: false });
    });

    it("enqueue accumulates pours per topic+kind instead of duplicating entries", async () => {
        const { transport } = fakeSidecar();
        const store = new GardenStore(transport);
        await store.load();
        store.enqueue({ nodeId: "BB.1A", deckPath: "MCAT::B-B::1A", kind: "water" });
        store.enqueue({ nodeId: "BB.1A", deckPath: "MCAT::B-B::1A", kind: "water" });
        store.enqueue({ nodeId: "BB.1A", deckPath: "MCAT::B-B::1A", kind: "plant" });
        expect(store.snapshot.pending).toHaveLength(2);
        const water = store.snapshot.pending.find((p) => p.kind === "water");
        expect(water?.pours).toBe(2);
    });

    it("the pending queue survives a restart (write-through -> reload)", async () => {
        const { disk, transport } = fakeSidecar();
        const first = new GardenStore(transport);
        await first.load();
        first.enqueue({ nodeId: "CP.4A", deckPath: "MCAT::C-P::4A", kind: "water" });
        first.setBalances({ seeds: 39, water: 79, xp: 1 });

        // "Restart": a brand-new store over the same sidecar disk.
        const second = new GardenStore({
            get: () => Promise.resolve(Object.fromEntries(disk) as Partial<GardenDoc>),
            set: transport.set,
        });
        const doc = await second.load();
        expect(doc.pending).toHaveLength(1);
        expect(doc.pending[0].nodeId).toBe("CP.4A");
        expect(doc.economy).toEqual({ seeds: 39, water: 79, xp: 1 });
    });

    it("dequeue removes exactly the delivered topics", async () => {
        const { transport } = fakeSidecar();
        const store = new GardenStore(transport);
        await store.load();
        store.enqueue({ nodeId: "BB.1A", deckPath: "MCAT::B-B::1A", kind: "water" });
        store.enqueue({ nodeId: "CP.4A", deckPath: "MCAT::C-P::4A", kind: "water" });
        store.dequeue(["BB.1A"]);
        expect(store.snapshot.pending.map((p) => p.nodeId)).toEqual(["CP.4A"]);
    });

    it("paraphrase passes are recorded per topic and persist", async () => {
        const { disk, transport } = fakeSidecar();
        const store = new GardenStore(transport);
        await store.load();
        expect(store.hasParaphrasePass("BB.1A")).toBe(false);
        store.recordParaphrasePass("BB.1A");
        expect(store.hasParaphrasePass("BB.1A")).toBe(true);
        expect((disk.get("paraphrase") as Record<string, number>)["BB.1A"]).toBeTypeOf(
            "number",
        );
    });

    it("ground-flora watered counts persist across a restart", async () => {
        const { disk, transport } = fakeSidecar();
        const first = new GardenStore(transport);
        await first.load();
        expect(first.snapshot.flora).toEqual({});
        first.setFlora({ "4,7": 2, "5,7": 5 });

        const second = new GardenStore({
            get: () => Promise.resolve(Object.fromEntries(disk) as Partial<GardenDoc>),
            set: transport.set,
        });
        const doc = await second.load();
        expect(doc.flora).toEqual({ "4,7": 2, "5,7": 5 });
    });

    it("partial/corrupt persisted docs merge over safe defaults (versioned-store discipline)", async () => {
        const { transport } = fakeSidecar({
            economy: { seeds: 12 } as never, // missing water/xp
            tutorial: { beat: 3 } as never, // missing done
        });
        const store = new GardenStore(transport);
        const doc = await store.load();
        expect(doc.economy.seeds).toBe(12);
        expect(doc.economy.water).toBe(80);
        expect(doc.tutorial).toEqual({ beat: 3, done: false });
    });
});
