// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: engine-truth reads for the garden (docs/26 I1/I2). This module is the ONLY
// place the garden fetches mastery/due data; everything downstream (stages, world, HUD)
// derives from the snapshot. Read-only: masteryQuery + deckTree, never a write.
import { deckTree, masteryQuery } from "@generated/backend";

import sidecar from "$lib/graph-sidecar.json";

export interface TopicMastery {
    /** Sidecar node id, e.g. "BB.1A". */
    nodeId: string;
    /** Deck path, e.g. "MCAT::B-B::1A" — the join key everywhere. */
    deckPath: string;
    label: string;
    section: string;
    totalCards: number;
    cardsWithState: number;
    masteredCount: number;
    averageRecall: number;
    gradedReviews: number;
    /** Due right now (learning + review), from the deck tree. */
    dueCount: number;
    newCount: number;
}

export interface MasterySnapshot {
    topics: TopicMastery[];
    byNode: Map<string, TopicMastery>;
    byDeckPath: Map<string, TopicMastery>;
    fetchedAtMs: number;
}

interface SidecarNode {
    id: string;
    label: string;
    kind: string;
    parent: string | null;
    section: string;
    x: number;
    y: number;
    z: number;
    path?: string | null;
}

interface SidecarEdge {
    src: string;
    dst: string;
    kind: string;
}

const nodes = (sidecar as { nodes: SidecarNode[] }).nodes;
const edges = (sidecar as { edges: SidecarEdge[] }).edges;

/** Deck path -> sidecar node id, for the 34 leaves (path only exists on leaves). */
export const pathToId: ReadonlyMap<string, string> = new Map(
    nodes.filter((n) => n.path).map((n) => [n.path as string, n.id]),
);

export const idToNode: ReadonlyMap<string, SidecarNode> = new Map(
    nodes.map((n) => [n.id, n]),
);

/** Prerequisite edges (src must bloom before dst opens) among leaves. */
export const prereqEdges: ReadonlyArray<{ src: string; dst: string }> = edges
    .filter((e) => e.kind === "prerequisite")
    .map((e) => ({ src: e.src, dst: e.dst }));

interface DeckTreeCounts {
    name: string;
    dueCount: number;
    newCount: number;
}

function flattenDeckTree(
    node: {
        name: string;
        children: unknown[];
        learnCount?: number;
        reviewCount?: number;
        newCount?: number;
    },
    prefix: string,
    out: Map<string, DeckTreeCounts>,
): void {
    const path = prefix ? `${prefix}::${node.name}` : node.name;
    if (node.name) {
        out.set(path, {
            name: path,
            dueCount: (node.learnCount ?? 0) + (node.reviewCount ?? 0),
            newCount: node.newCount ?? 0,
        });
    }
    for (const child of node.children as (typeof node)[]) {
        flattenDeckTree(child, node.name ? path : "", out);
    }
}

/**
 * One engine round-trip for everything the world needs: per-topic mastery (masteryQuery)
 * joined with per-topic due/new counts (deckTree), keyed to sidecar nodes.
 */
export async function fetchMasterySnapshot(): Promise<MasterySnapshot> {
    const [mastery, tree] = await Promise.all([
        masteryQuery(
            { search: "", masteredRetrievabilityThreshold: 0.9 },
            { alertOnError: false },
        ),
        deckTree({ now: BigInt(Math.floor(Date.now() / 1000)) }, { alertOnError: false }),
    ]);

    const dueByPath = new Map<string, DeckTreeCounts>();
    if (tree.top) {
        for (const child of tree.top.children) {
            flattenDeckTree(child as never, "", dueByPath);
        }
    }

    const topics: TopicMastery[] = [];
    for (const t of mastery.topics) {
        const nodeId = pathToId.get(t.deckName);
        if (!nodeId) {
            continue; // decks outside the MCAT taxonomy don't exist in the garden
        }
        const node = idToNode.get(nodeId);
        const counts = dueByPath.get(t.deckName);
        topics.push({
            nodeId,
            deckPath: t.deckName,
            label: node?.label ?? t.deckName,
            section: node?.section ?? "",
            totalCards: t.totalCards,
            cardsWithState: t.cardsWithState,
            masteredCount: t.masteredCount,
            averageRecall: t.averageRecall,
            gradedReviews: t.gradedReviews,
            dueCount: counts?.dueCount ?? 0,
            newCount: counts?.newCount ?? 0,
        });
    }

    return {
        topics,
        byNode: new Map(topics.map((t) => [t.nodeId, t])),
        byDeckPath: new Map(topics.map((t) => [t.deckPath, t])),
        fetchedAtMs: Date.now(),
    };
}
