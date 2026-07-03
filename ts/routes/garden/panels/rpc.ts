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

type RpcFn = (args?: unknown, opts?: unknown) => Promise<unknown>;

interface DeckNode {
    name?: string;
    deckId?: unknown;
    id?: unknown;
    did?: unknown;
    children?: DeckNode[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRpc(name: string): RpcFn {
    const candidate = (backend as Record<string, unknown>)[name];
    if (typeof candidate !== "function") {
        throw new Error(`Missing backend RPC: ${name}`);
    }
    return candidate as RpcFn;
}

function toDeckNode(value: unknown): DeckNode | null {
    if (!isRecord(value)) {
        return null;
    }
    const childrenRaw = value.children;
    const children = Array.isArray(childrenRaw)
        ? childrenRaw.map((child) => toDeckNode(child)).filter((child): child is DeckNode => child !== null)
        : [];
    return {
        name: typeof value.name === "string" ? value.name : undefined,
        deckId: value.deckId,
        id: value.id,
        did: value.did,
        children,
    };
}

function findDeckNodeByPath(node: DeckNode, wantedPath: string, prefix = ""): DeckNode | null {
    const path = node.name ? (prefix ? `${prefix}::${node.name}` : node.name) : prefix;
    if (path === wantedPath) {
        return node;
    }
    for (const child of node.children ?? []) {
        const found = findDeckNodeByPath(child, wantedPath, path);
        if (found) {
            return found;
        }
    }
    return null;
}

function pickDeckIdentifier(node: DeckNode | null): unknown {
    if (!node) {
        return undefined;
    }
    return node.deckId ?? node.id ?? node.did;
}

async function callSetCurrentDeck(id: unknown, deckPath: string): Promise<void> {
    const setDeck = asRpc("setCurrentDeck");
    const attempts: unknown[] = [
        { deckId: id },
        { did: id },
        { id },
        { deckName: deckPath },
        { name: deckPath },
        id,
        deckPath,
    ];
    let lastError: unknown = null;
    for (const args of attempts) {
        try {
            await setDeck(args, { alertOnError: false });
            return;
        } catch (err) {
            lastError = err;
        }
    }
    throw new Error(
        `setCurrentDeck failed for "${deckPath}"${lastError instanceof Error ? `: ${lastError.message}` : ""}`,
    );
}

/**
 * TODO(garden-g0): Integrator should pin exact generated RPC names/arg shapes here.
 * This seam intentionally centralizes name drift to one file.
 */
export async function scopeToDeck(deckPath: string): Promise<void> {
    const treeFn = asRpc("deckTree");
    const treeRaw = await treeFn(
        { now: BigInt(Math.floor(Date.now() / 1000)) },
        { alertOnError: false },
    );
    const treeObj = isRecord(treeRaw) && "top" in treeRaw ? toDeckNode(treeRaw.top) : toDeckNode(treeRaw);
    const target = findDeckNodeByPath(treeObj ?? { children: [] }, deckPath);
    const deckId = pickDeckIdentifier(target);
    await callSetCurrentDeck(deckId, deckPath);
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
