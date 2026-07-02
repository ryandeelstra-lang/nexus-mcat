// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: thin RPC seam for Keeper deck scoping + almanac bridge fetch (doc 23 §6.5/§6.6).
import * as backend from "@generated/backend";

export interface DashboardMetric extends Record<string, unknown> {
    available?: boolean;
    reason?: string;
    value?: number;
    range?: [number, number];
    confidence?: string;
    evidence?: unknown;
}

export interface DashboardCoverage extends Record<string, unknown> {
    gate_covered?: number;
    gate_total?: number;
    gate_fraction?: number;
    display_covered?: number;
    display_total?: number;
    display_fraction?: number;
    uncovered_content_categories?: string[];
}

export interface DashboardData extends Record<string, unknown> {
    available?: boolean;
    reason?: string;
    memory?: DashboardMetric | null;
    performance?: DashboardMetric | null;
    readiness?: DashboardMetric | null;
    coverage?: DashboardCoverage | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Scope the engine's queue to one deck subtree (the Keeper serving a pending topic).
 * Pinned generated names (out/ts/lib/generated/backend.ts):
 *   getDeckIdByName(generic.String{val}) -> DeckId{did}
 *   setCurrentDeck(DeckId{did}) -> OpChanges
 * This is the standard current-deck mechanism — getQueuedCards then serves that subtree;
 * FSRS still owns every interval (docs/26 I1).
 */
export async function scopeToDeck(deckPath: string): Promise<void> {
    const deck = await backend.getDeckIdByName({ val: deckPath }, { alertOnError: false });
    await backend.setCurrentDeck({ did: deck.did }, { alertOnError: false });
}

export async function fetchDashboard(): Promise<DashboardData> {
    const resp = await fetch("/_anki/scoresDashboard", {
        method: "POST",
        headers: { "Content-Type": "application/binary" },
        body: "",
    });
    if (!resp.ok) {
        throw new Error(`scoresDashboard failed: ${resp.status}`);
    }
    const payload = await resp.json();
    if (!isRecord(payload)) {
        return { available: false, reason: "Malformed dashboard payload" };
    }
    return payload as DashboardData;
}
