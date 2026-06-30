// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: render the MCAT knowledge-graph sidecar as an SVG scene (d3, no new dep).
// Structure comes from the <100KB sidecar (baked x/y/z); node glow comes from the LIVE
// MasteryQuery RPC (passed in as `mastery`) — never a fabricated number.

import { max, min, scaleLinear, select } from "d3";

export interface SidecarNode {
    id: string;
    label: string;
    kind: string;
    parent: string | null;
    section: string;
    x: number;
    y: number;
    z: number;
    /** Deck path (e.g. "MCAT::B-B::1A") for leaf nodes; null for section/fc. */
    path: string | null;
}

export interface SidecarEdge {
    src: string;
    dst: string;
    kind: string;
}

export interface Sidecar {
    version: number;
    nodes: SidecarNode[];
    edges: SidecarEdge[];
}

/** Per-node live state from the MasteryQuery RPC (empty => un-lit "not yet lit" ghost). */
export interface NodeState {
    recall: number;
    hasState: boolean;
}

const SECTION_COLOR: Record<string, string> = {
    "C-P": "#5b8cff",
    "CARS": "#f5a623",
    "B-B": "#34d39e",
    "P-S": "#b07bff",
};

const KIND_RADIUS: Record<string, number> = {
    section: 16,
    fc: 9,
    category: 6,
    cars: 6,
};

const WIDTH = 1000;
const HEIGHT = 720;

function color(section: string): string {
    return SECTION_COLOR[section] ?? "#8a8f98";
}

export function renderGraph(
    svg: SVGElement,
    sidecar: Sidecar,
    mastery: Record<string, NodeState>,
    bestNext: string | null,
): void {
    const root = select(svg);
    root.selectAll("*").remove();

    const xs = sidecar.nodes.map((n) => n.x);
    const ys = sidecar.nodes.map((n) => n.y);
    const sx = scaleLinear().domain([min(xs) ?? 0, max(xs) ?? 1]).range([70, WIDTH - 70]);
    const sy = scaleLinear().domain([min(ys) ?? 0, max(ys) ?? 1]).range([70, HEIGHT - 70]);
    const pos = new Map(sidecar.nodes.map((n) => [n.id, { x: sx(n.x), y: sy(n.y) }]));
    const xy = (id: string): { x: number; y: number } => pos.get(id) ?? { x: 0, y: 0 };

    // Edges first (drawn under the nodes). Prerequisite edges are brighter than containment.
    const edges = root.append("g").attr("class", "kg-edges");
    edges
        .selectAll("line")
        .data(sidecar.edges.filter((e) => pos.has(e.src) && pos.has(e.dst)))
        .join("line")
        .attr("x1", (e) => xy(e.src).x)
        .attr("y1", (e) => xy(e.src).y)
        .attr("x2", (e) => xy(e.dst).x)
        .attr("y2", (e) => xy(e.dst).y)
        .attr("stroke", (e) => (e.kind === "prerequisite" ? "rgba(255,255,255,0.28)" : "rgba(255,255,255,0.07)"))
        .attr("stroke-width", (e) => (e.kind === "prerequisite" ? 1.4 : 0.7));

    // Nodes.
    const nodes = root.append("g").attr("class", "kg-nodes");
    const g = nodes
        .selectAll("g")
        .data(sidecar.nodes)
        .join("g")
        .attr("transform", (n) => `translate(${xy(n.id).x},${xy(n.id).y})`);

    g.append("circle")
        .attr("r", (n) => KIND_RADIUS[n.kind] ?? 6)
        .attr("fill", (n) => color(n.section))
        .attr("fill-opacity", (n) => {
            const m = mastery[n.id];
            // Un-lit "not yet lit" ghost (never dark-as-punishment); glow grows with mastery.
            if (!m || !m.hasState) {
                return 0.2;
            }
            return 0.35 + 0.6 * Math.max(0, Math.min(1, m.recall));
        })
        .attr("stroke", (n) => (n.id === bestNext ? "#ffffff" : "rgba(255,255,255,0.15)"))
        .attr("stroke-width", (n) => (n.id === bestNext ? 3 : 0.6))
        .attr("class", (n) => (n.id === bestNext ? "kg-node kg-best-next" : "kg-node"));

    // Labels for the higher altitudes only (keeps ~48 nodes legible).
    g.filter((n) => n.kind === "section" || n.kind === "fc")
        .append("text")
        .text((n) => n.label)
        .attr("dy", (n) => -(KIND_RADIUS[n.kind] ?? 6) - 4)
        .attr("text-anchor", "middle")
        .attr("fill", (n) => (n.kind === "section" ? "rgba(255,255,255,0.92)" : "rgba(255,255,255,0.6)"))
        .attr("font-size", (n) => (n.kind === "section" ? 14 : 10));
}
