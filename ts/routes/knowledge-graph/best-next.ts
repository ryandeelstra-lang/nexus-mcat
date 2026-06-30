// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: pick the single "start here" leaf — the weakest still-worth-studying topic whose
// prerequisites are already met, breaking ties toward the node that unlocks the most downstream.
// Topo-valid by construction (a node is only eligible once its prereqs clear the MET floor), and
// fully deterministic (no clock, no randomness) so the pulse never jumps around between renders.

import type { NodeState, Sidecar } from "./graph-render";

const MET = 0.6; // a prerequisite counts as "met" at this recall
const WEAK = 0.85; // a leaf is still worth recommending below this recall

export function computeBestNext(sidecar: Sidecar, mastery: Record<string, NodeState>): string | null {
    const incoming = new Map<string, string[]>();
    const outDegree = new Map<string, number>();
    for (const e of sidecar.edges) {
        if (e.kind !== "prerequisite") {
            continue;
        }
        const existing = incoming.get(e.dst);
        if (existing) {
            existing.push(e.src);
        } else {
            incoming.set(e.dst, [e.src]);
        }
        outDegree.set(e.src, (outDegree.get(e.src) ?? 0) + 1);
    }

    const recallOf = (id: string): number => {
        const m = mastery[id];
        return m && m.hasState ? m.recall : 0;
    };
    const prereqsMet = (id: string): boolean => (incoming.get(id) ?? []).every((src) => recallOf(src) >= MET);

    const candidates = sidecar.nodes.filter(
        (n) => (n.kind === "category" || n.kind === "cars") && recallOf(n.id) < WEAK && prereqsMet(n.id),
    );
    candidates.sort((a, b) => {
        const unlockDiff = (outDegree.get(b.id) ?? 0) - (outDegree.get(a.id) ?? 0);
        if (unlockDiff !== 0) {
            return unlockDiff; // most downstream unlock first
        }
        const recallDiff = recallOf(a.id) - recallOf(b.id);
        if (recallDiff !== 0) {
            return recallDiff; // weakest first
        }
        return a.id < b.id ? -1 : 1; // deterministic tie-break
    });

    const best = candidates[0];
    return best ? best.id : null;
}
