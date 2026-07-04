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
        expect(doc.economy).toEqual({ water: 80, xp: 0 });
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
        first.setBalances({ water: 79, xp: 1 });

        // "Restart": a brand-new store over the same sidecar disk.
        const second = new GardenStore({
            get: () => Promise.resolve(Object.fromEntries(disk) as Partial<GardenDoc>),
            set: transport.set,
        });
        const doc = await second.load();
        expect(doc.pending).toHaveLength(1);
        expect(doc.pending[0].nodeId).toBe("CP.4A");
        expect(doc.economy).toEqual({ water: 79, xp: 1 });
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

    it("a fresh profile has the placement test undone (the island boots fogged)", async () => {
        const { transport } = fakeSidecar();
        const store = new GardenStore(transport);
        const doc = await store.load();
        expect(doc.placement.done).toBe(false);
        expect(doc.placement.tally).toEqual({});
        expect(doc.placement.intake.examDateIso).toBeNull();
    });

    it("placement completion (tally + intake) survives a restart — the fog never returns", async () => {
        const { disk, transport } = fakeSidecar();
        const first = new GardenStore(transport);
        await first.load();
        first.setPlacement({
            done: true,
            answered: 20,
            knew: 13,
            tally: { "P-S": { asked: 5, knew: 4 } },
            intake: { examDateIso: "2026-10-15", targetScore: 515, minutesPerDay: 120 },
            completedAtMs: 1_780_000_000_000,
        });

        const second = new GardenStore({
            get: () => Promise.resolve(Object.fromEntries(disk) as Partial<GardenDoc>),
            set: transport.set,
        });
        const doc = await second.load();
        expect(doc.placement.done).toBe(true);
        expect(doc.placement.knew).toBe(13);
        expect(doc.placement.tally["P-S"]).toEqual({ asked: 5, knew: 4 });
        expect(doc.placement.intake.examDateIso).toBe("2026-10-15");
    });

    it("a fresh profile has the Garden Tour unplayed (it auto-plays on first entry)", async () => {
        const { transport } = fakeSidecar();
        const store = new GardenStore(transport);
        const doc = await store.load();
        expect(doc.tour).toEqual({ step: 0, done: false });
    });

    it("the tour cursor persists across a restart (pause mid-tour resumes; done stays done)", async () => {
        const { disk, transport } = fakeSidecar();
        const first = new GardenStore(transport);
        await first.load();
        first.setTour({ step: 4, done: false });
        // Tour writes ride a serialized chain (ordering guarantee), so they land a
        // microtask later than the other fire-and-forget keys — flush before "restart".
        await new Promise((resolve) => setTimeout(resolve, 0));

        const second = new GardenStore({
            get: () => Promise.resolve(Object.fromEntries(disk) as Partial<GardenDoc>),
            set: transport.set,
        });
        const doc = await second.load();
        expect(doc.tour).toEqual({ step: 4, done: false });

        second.setTour({ step: 11, done: true });
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect((disk.get("tour") as { done: boolean }).done).toBe(true);
    });

    it("racing tour writes land in call order — a finished tour can never be un-finished by a late advance", async () => {
        const { disk } = fakeSidecar();
        // A transport whose FIRST write stalls (slow connection) while later writes are
        // instant — without serialization the {done:true} would be overwritten.
        let firstCall = true;
        const store = new GardenStore({
            get: () => Promise.resolve(Object.fromEntries(disk) as Partial<GardenDoc>),
            set: (key, doc) => {
                const delay = firstCall ? 30 : 0;
                firstCall = false;
                return new Promise((resolve) =>
                    setTimeout(() => {
                        disk.set(key, doc);
                        resolve();
                    }, delay)
                );
            },
        });
        await store.load();
        store.setTour({ step: 10, done: false }); // the slow advance write
        store.setTour({ step: 11, done: true }); // skip/finish, milliseconds later
        await new Promise((resolve) => setTimeout(resolve, 80));
        expect(disk.get("tour")).toEqual({ step: 11, done: true });
    });

    it("partial/corrupt persisted docs merge over safe defaults (versioned-store discipline)", async () => {
        const { transport } = fakeSidecar({
            economy: { water: 12 } as never, // missing xp
            tutorial: { beat: 3 } as never, // missing done
        });
        const store = new GardenStore(transport);
        const doc = await store.load();
        expect(doc.economy.water).toBe(12);
        expect(doc.economy.xp).toBe(0);
        expect(doc.tutorial).toEqual({ beat: 3, done: false });
    });

    it("a pre-2026-07-03 saved doc with a seeds balance loads clean — the stale key is shed", async () => {
        const { disk, transport } = fakeSidecar({
            economy: { seeds: 17, water: 42, xp: 5 } as never, // legacy shape
        });
        const store = new GardenStore(transport);
        const doc = await store.load();
        expect(doc.economy).toEqual({ water: 42, xp: 5 });
        expect(doc.economy).not.toHaveProperty("seeds");
        // The next write-through persists the seedless shape.
        store.setBalances({ ...doc.economy, water: 41 });
        expect(disk.get("economy")).toEqual({ water: 41, xp: 5 });
    });
});
