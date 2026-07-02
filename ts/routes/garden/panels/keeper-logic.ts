// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: pure Keeper delivery + local weeds bridge helpers (doc 23 §6.5/§10.3/§17).
import type { TopicMastery } from "../state/mastery";
import type { PendingEntry } from "../state/store";

export interface DeliveryItem {
    deckPath: string;
    nodeId: string;
    label: string;
    why: "queued" | "assigned";
}

export type WeedCause =
    | "careless"
    | "concept-gap"
    | "misread"
    | "trapped"
    | "too-slow";

export interface WeedEntry {
    cause: WeedCause;
    ts: number;
}

export type WeedsDoc = Record<string, WeedEntry>;

function compareTendNext(a: TopicMastery, b: TopicMastery): number {
    if (a.dueCount !== b.dueCount) {
        return b.dueCount - a.dueCount;
    }
    if (a.averageRecall !== b.averageRecall) {
        return a.averageRecall - b.averageRecall;
    }
    return a.label.localeCompare(b.label);
}

function selectAssignedTopic(topics: ReadonlyArray<TopicMastery>): TopicMastery | null {
    // Thirsty plants first (due reviews). On a fresh garden nothing is due yet — the
    // Keeper then assigns a topic with NEW cards to plant (SPOV1: he always has a next
    // rep; a fresh player is never told "come back later" — doc 24 §2, the diagnostic
    // planting beat).
    const due = topics.filter((topic) => topic.dueCount > 0);
    if (due.length > 0) {
        const sorted = [...due].sort(compareTendNext);
        return sorted[0] ?? null;
    }
    const fresh = topics.filter((topic) => topic.newCount > 0);
    if (fresh.length === 0) {
        return null;
    }
    const sorted = [...fresh].sort(
        (a, b) => a.averageRecall - b.averageRecall || a.label.localeCompare(b.label),
    );
    return sorted[0] ?? null;
}

export function planDelivery(
    pending: ReadonlyArray<PendingEntry>,
    topics: ReadonlyArray<TopicMastery>,
): DeliveryItem[] {
    const byNode = new Map(topics.map((topic) => [topic.nodeId, topic]));
    const byDeck = new Map(topics.map((topic) => [topic.deckPath, topic]));
    if (pending.length > 0) {
        return [...pending]
            .sort((a, b) => a.queuedAtMs - b.queuedAtMs)
            .map((entry) => {
                const topic = byNode.get(entry.nodeId) ?? byDeck.get(entry.deckPath);
                return {
                    deckPath: entry.deckPath,
                    nodeId: entry.nodeId,
                    label: topic?.label ?? entry.deckPath,
                    why: "queued" as const,
                };
            });
    }
    const assigned = selectAssignedTopic(topics);
    if (!assigned) {
        return [];
    }
    return [{
        deckPath: assigned.deckPath,
        nodeId: assigned.nodeId,
        label: assigned.label,
        why: "assigned",
    }];
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeWeeds(value: unknown): WeedsDoc {
    if (!isRecord(value)) {
        return {};
    }
    const out: WeedsDoc = {};
    for (const [nodeId, raw] of Object.entries(value)) {
        if (!isRecord(raw)) {
            continue;
        }
        const cause = raw.cause;
        const ts = raw.ts;
        if (
            typeof cause === "string"
            && (cause === "careless" || cause === "concept-gap" || cause === "misread"
                || cause === "trapped" || cause === "too-slow")
            && typeof ts === "number"
        ) {
            out[nodeId] = { cause, ts };
        }
    }
    return out;
}

async function gardenStatePost(body: unknown): Promise<unknown> {
    const resp = await fetch("/_anki/gardenState", {
        method: "POST",
        headers: { "Content-Type": "application/binary" },
        body: JSON.stringify(body),
    });
    if (!resp.ok) {
        throw new Error(`gardenState bridge failed: ${resp.status}`);
    }
    return await resp.json();
}

async function loadWeedsDoc(): Promise<WeedsDoc> {
    const payload = await gardenStatePost({ op: "get" });
    if (!isRecord(payload)) {
        return {};
    }
    return normalizeWeeds(payload.weeds);
}

async function saveWeedsDoc(doc: WeedsDoc): Promise<void> {
    await gardenStatePost({ op: "set", key: "weeds", doc });
}

/**
 * Local v1 seam for doc 23 §10.3 weeds.
 * Integrator note: this mirrors GardenStore's transport and can be folded into store.ts later.
 */
export async function recordWeed(nodeId: string, cause: WeedCause): Promise<void> {
    const weeds = await loadWeedsDoc();
    const next: WeedsDoc = {
        ...weeds,
        [nodeId]: { cause, ts: Date.now() },
    };
    await saveWeedsDoc(next);
}

export async function activeWeeds(): Promise<WeedsDoc> {
    return await loadWeedsDoc();
}
