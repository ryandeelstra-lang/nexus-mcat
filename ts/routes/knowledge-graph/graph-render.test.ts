// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

import { expect, test } from "vitest";

import { type NodeState, rollupMastery, type Sidecar, type SidecarNode } from "./graph-render";

function node(id: string, kind: string, parent: string | null): SidecarNode {
    return { id, label: id, kind, parent, section: "B-B", x: 0, y: 0, z: 0, path: null };
}

// A tiny section → foundational-concept → three-category tree.
const sidecar: Sidecar = {
    version: 1,
    nodes: [
        node("S", "section", null),
        node("F", "fc", "S"),
        node("L1", "category", "F"),
        node("L2", "category", "F"),
        node("L3", "category", "F"),
    ],
    edges: [],
};

test("card-weighted rollup fills parents from real leaf state", () => {
    const leaf: Record<string, NodeState> = {
        L1: { recall: 0.9, hasState: true, cards: 10 },
        L2: { recall: 0.5, hasState: true, cards: 30 },
    };
    const out = rollupMastery(sidecar, leaf);
    // parent = card-count-weighted mean: (0.9·10 + 0.5·30) / 40 = 0.6 (docs/14 rollup math)
    expect(out.F.recall).toBeCloseTo(0.6, 10);
    expect(out.F.hasState).toBe(true);
    expect(out.F.cards).toBe(40);
    // the section agrees with its child FC — zoom never changes the number, only the grain
    expect(out.S.recall).toBeCloseTo(0.6, 10);
    expect(out.S.cards).toBe(40);
    // leaves are preserved untouched
    expect(out.L1).toEqual({ recall: 0.9, hasState: true, cards: 10 });
});

test("honesty: parents with no descendant state are never fabricated", () => {
    const out = rollupMastery(sidecar, {});
    expect(out.S).toBeUndefined();
    expect(out.F).toBeUndefined();
    expect(out.L3).toBeUndefined();
});

test("leaves without live state are excluded from the weighting", () => {
    const leaf: Record<string, NodeState> = {
        L1: { recall: 0.8, hasState: true, cards: 5 },
        L2: { recall: 0.2, hasState: false, cards: 100 },
    };
    const out = rollupMastery(sidecar, leaf);
    expect(out.F.recall).toBeCloseTo(0.8, 10);
    expect(out.F.cards).toBe(5);
});
