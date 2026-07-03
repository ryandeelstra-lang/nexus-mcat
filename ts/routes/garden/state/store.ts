// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: the additive garden store (docs/26 I5, G1.3). One client for ALL persistent
// garden state — balances, the pending "sow now, answer next visit" queue, tutorial beats,
// paraphrase passes, unlocks, settings — persisted through the gardenState JSON bridge into
// the sidecar SQLite beside the collection (scores/telemetry/garden.py). NEVER the
// collection itself. The engine sees reads + answerCard only.

import { initialBalances, type Balances } from "./economy";

export interface PendingEntry {
    nodeId: string;
    deckPath: string;
    /** "plant" queues intro/new cards; "water" queues due reviews. */
    kind: "plant" | "water";
    /** Pours spent on this topic while pending (>=1). */
    pours: number;
    queuedAtMs: number;
}

export interface TutorialState {
    beat: number;
    done: boolean;
}

export interface GardenDoc {
    economy: Balances;
    pending: PendingEntry[];
    /** nodeId -> paraphrase-pass timestamp (mirrors the sidecar variant-pass truth). */
    paraphrase: Record<string, number>;
    tutorial: TutorialState;
    unlocks: { waystones: string[] };
    settings: { muted: boolean; volume: number };
}

export function emptyDoc(): GardenDoc {
    return {
        economy: initialBalances(),
        pending: [],
        paraphrase: {},
        tutorial: { beat: 0, done: false },
        unlocks: { waystones: [] },
        settings: { muted: false, volume: 0.7 },
    };
}

interface BridgeTransport {
    get(): Promise<Partial<GardenDoc>>;
    set(key: keyof GardenDoc, doc: unknown): Promise<void>;
}

/** POST /_anki/gardenState — the additive sidecar bridge (api-access page only). */
export const httpTransport: BridgeTransport = {
    async get() {
        const resp = await fetch("/_anki/gardenState", {
            method: "POST",
            headers: { "Content-Type": "application/binary" },
            body: JSON.stringify({ op: "get" }),
        });
        if (!resp.ok) {
            throw new Error(`gardenState get failed: ${resp.status}`);
        }
        return (await resp.json()) as Partial<GardenDoc>;
    },
    async set(key, doc) {
        const resp = await fetch("/_anki/gardenState", {
            method: "POST",
            headers: { "Content-Type": "application/binary" },
            body: JSON.stringify({ op: "set", key, doc }),
        });
        if (!resp.ok) {
            throw new Error(`gardenState set failed: ${resp.status}`);
        }
    },
};

/**
 * The in-memory working copy + write-through persistence. All mutations are synchronous
 * on the working copy (game feel), then written through to the sidecar; a failed
 * write-through surfaces on the next load, never blocks play.
 */
export class GardenStore {
    private doc: GardenDoc = emptyDoc();
    private transport: BridgeTransport;

    constructor(transport: BridgeTransport = httpTransport) {
        this.transport = transport;
    }

    async load(): Promise<GardenDoc> {
        const persisted = await this.transport.get();
        const base = emptyDoc();
        this.doc = {
            economy: { ...base.economy, ...(persisted.economy ?? {}) },
            pending: persisted.pending ?? [],
            paraphrase: persisted.paraphrase ?? {},
            tutorial: { ...base.tutorial, ...(persisted.tutorial ?? {}) },
            unlocks: { ...base.unlocks, ...(persisted.unlocks ?? {}) },
            settings: { ...base.settings, ...(persisted.settings ?? {}) },
        };
        return this.doc;
    }

    get snapshot(): GardenDoc {
        return this.doc;
    }

    setBalances(b: Balances): void {
        this.doc = { ...this.doc, economy: b };
        void this.transport.set("economy", b);
    }

    /** Queue a topic (plant or water). Multiple pours on the same topic accumulate. */
    enqueue(entry: Omit<PendingEntry, "pours" | "queuedAtMs">): void {
        const existing = this.doc.pending.find(
            (p) => p.nodeId === entry.nodeId && p.kind === entry.kind,
        );
        let pending: PendingEntry[];
        if (existing) {
            pending = this.doc.pending.map((p) =>
                p === existing ? { ...p, pours: p.pours + 1 } : p
            );
        } else {
            pending = [
                ...this.doc.pending,
                { ...entry, pours: 1, queuedAtMs: Date.now() },
            ];
        }
        this.doc = { ...this.doc, pending };
        void this.transport.set("pending", pending);
    }

    /** The Keeper serves the queue; delivered entries leave it. */
    dequeue(nodeIds: string[]): void {
        const drop = new Set(nodeIds);
        const pending = this.doc.pending.filter((p) => !drop.has(p.nodeId));
        this.doc = { ...this.doc, pending };
        void this.transport.set("pending", pending);
    }

    recordParaphrasePass(nodeId: string): void {
        const paraphrase = { ...this.doc.paraphrase, [nodeId]: Date.now() };
        this.doc = { ...this.doc, paraphrase };
        void this.transport.set("paraphrase", paraphrase);
    }

    hasParaphrasePass(nodeId: string): boolean {
        return nodeId in this.doc.paraphrase;
    }

    setTutorial(t: TutorialState): void {
        this.doc = { ...this.doc, tutorial: t };
        void this.transport.set("tutorial", t);
    }

    setSettings(s: GardenDoc["settings"]): void {
        this.doc = { ...this.doc, settings: s };
        void this.transport.set("settings", s);
    }

    unlockWaystone(id: string): void {
        if (this.doc.unlocks.waystones.includes(id)) {
            return;
        }
        const unlocks = { waystones: [...this.doc.unlocks.waystones, id] };
        this.doc = { ...this.doc, unlocks };
        void this.transport.set("unlocks", unlocks);
    }
}
