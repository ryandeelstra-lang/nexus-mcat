// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: render the MCAT knowledge-graph sidecar as a 2.5D SVG scene (d3, no new dep).
// Structure comes from the <100KB sidecar (baked x/y/z); node glow comes from the LIVE
// MasteryQuery RPC (passed in as `mastery`) — never a fabricated number. The baked z gives a
// depth cue (size + draw order); lit nodes earn a soft bloom, the map "only gains light".

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

// Locked section palette (docs/17-UI-UX.md §section palette, 2026-06-29). Hue = section identity;
// mastery is carried by light/bloom on top of the hue, never a new color.
export const SECTION_COLOR: Record<string, string> = {
    "C-P": "#3B82F6", // Chemistry/Physics — blue
    "B-B": "#14B8A6", // Biology/Biochem — teal
    "P-S": "#F59E0B", // Psychology/Sociology — amber
    "CARS": "#8B5CF6", // Reading/Reasoning — purple
};

export const KIND_RADIUS: Record<string, number> = {
    section: 16,
    fc: 9,
    category: 6,
    cars: 6,
};

const WIDTH = 1000;
const HEIGHT = 720;
export const INK = "#1B1D2A";
export const FIELD = "#FBFBFD";
export const LABEL_FONT = "Inter, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
const GLOW_SUFFIX = ["soft", "strong"] as const;

export function color(section: string): string {
    // Fallback is a neutral slate (the give-up "opportunity" tone), never a failure grey.
    return SECTION_COLOR[section] ?? "#94A3B8";
}

// The per-section "watercolor bloom" filters (soft + strong) — shared by the 2D and 3D renderers.
// For each section hue: two blurred copies of the node silhouette (inner tight, outer wide),
// flood-tinted to the hue and masked to those silhouettes, stacked wide→tight→crisp. sRGB keeps
// the tint from washing out on the white field. Pure SVG, zero new deps.
export function buildGlowDefs(svg: SVGElement): void {
    const defs = select(svg).append("defs");
    const GLOWS = {
        soft: { blurInner: 2.2, blurOuter: 5.5, flood: 0.5 },
        strong: { blurInner: 3.2, blurOuter: 9, flood: 0.72 },
    };
    for (const [section, hue] of Object.entries(SECTION_COLOR)) {
        for (const suffix of GLOW_SUFFIX) {
            const gs = GLOWS[suffix];
            const f = defs
                .append("filter")
                .attr("id", `kg-glow-${section}-${suffix}`)
                .attr("x", "-120%")
                .attr("y", "-120%")
                .attr("width", "340%")
                .attr("height", "340%")
                .attr("color-interpolation-filters", "sRGB");
            f.append("feGaussianBlur").attr("in", "SourceAlpha").attr("stdDeviation", gs.blurInner).attr(
                "result",
                "bIn",
            );
            f.append("feGaussianBlur").attr("in", "SourceAlpha").attr("stdDeviation", gs.blurOuter).attr(
                "result",
                "bOut",
            );
            f.append("feFlood").attr("flood-color", hue).attr("flood-opacity", gs.flood).attr("result", "tint");
            f.append("feComposite").attr("in", "tint").attr("in2", "bIn").attr("operator", "in").attr(
                "result",
                "hazeIn",
            );
            f.append("feComposite").attr("in", "tint").attr("in2", "bOut").attr("operator", "in").attr(
                "result",
                "hazeOut",
            );
            const merge = f.append("feMerge");
            merge.append("feMergeNode").attr("in", "hazeOut");
            merge.append("feMergeNode").attr("in", "hazeIn");
            merge.append("feMergeNode").attr("in", "SourceGraphic");
        }
    }
}

export function renderGraph(
    svg: SVGElement,
    sidecar: Sidecar,
    mastery: Record<string, NodeState>,
    bestNext: string | null,
): void {
    const root = select(svg);
    root.selectAll("*").remove();

    // The earned-light bloom filters (shared with the 3D engine).
    buildGlowDefs(svg);

    const xs = sidecar.nodes.map((n) => n.x);
    const ys = sidecar.nodes.map((n) => n.y);
    const zs = sidecar.nodes.map((n) => n.z);
    const sx = scaleLinear().domain([min(xs) ?? 0, max(xs) ?? 1]).range([70, WIDTH - 70]);
    const sy = scaleLinear().domain([min(ys) ?? 0, max(ys) ?? 1]).range([70, HEIGHT - 70]);
    const zmin = min(zs) ?? 0;
    const zmax = max(zs) ?? 1;
    const depth = (z: number): number => (zmax > zmin ? (z - zmin) / (zmax - zmin) : 0.5); // 0 far .. 1 near
    const pos = new Map(sidecar.nodes.map((n) => [n.id, { x: sx(n.x), y: sy(n.y) }]));
    const xy = (id: string): { x: number; y: number } => pos.get(id) ?? { x: 0, y: 0 };
    const lit = (n: SidecarNode): boolean => {
        const m = mastery[n.id];
        return !!(m && m.hasState);
    };

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
        // Faint pencil lines on white: prerequisites (load-bearing) read slightly stronger than
        // containment/related, which recede.
        .attr("stroke", (e) => (e.kind === "prerequisite" ? "rgba(27,29,42,0.18)" : "rgba(27,29,42,0.08)"))
        .attr("stroke-width", (e) => (e.kind === "prerequisite" ? 1.1 : 0.6))
        .attr("stroke-linecap", "round");

    // Nodes, painted far -> near so nearer (higher-z) nodes sit on top.
    const ordered = [...sidecar.nodes].sort((a, b) => a.z - b.z);
    const nodes = root.append("g").attr("class", "kg-nodes");
    const g = nodes
        .selectAll("g")
        .data(ordered)
        .join("g")
        .attr("transform", (n) => `translate(${xy(n.id).x},${xy(n.id).y})`);

    g.append("circle")
        .attr("r", (n) => (KIND_RADIUS[n.kind] ?? 6) * (0.8 + 0.45 * depth(n.z)))
        .attr("fill", (n) => color(n.section))
        .attr("fill-opacity", (n) => {
            const m = mastery[n.id];
            // Un-lit "not yet lit" gap: colored-but-dim on white (never grey, never invisible).
            if (!m || !m.hasState) {
                return 0.45;
            }
            // Lit: saturate toward a solid sphere as recall climbs.
            return 0.7 + 0.3 * Math.max(0, Math.min(1, m.recall));
        })
        .attr("filter", (n) => {
            if (n.id === bestNext) {
                return `url(#kg-glow-${n.section}-strong)`;
            }
            return lit(n) ? `url(#kg-glow-${n.section}-soft)` : null;
        })
        // Un-lit gaps get a quiet section-hued ring (a colored ghost, present-but-quiet); lit nodes get
        // a barely-there ink hairline (the bloom carries them); best-next is ringed in its section hue
        // (a white ring would vanish on the white field — "calm not alarm" is the gentle pulse).
        .attr("stroke", (n) => {
            if (n.id === bestNext) {
                return color(n.section);
            }
            return lit(n) ? "rgba(27,29,42,0.10)" : color(n.section);
        })
        .attr("stroke-opacity", (n) => (lit(n) || n.id === bestNext ? 1 : 0.55))
        .attr("stroke-width", (n) => {
            if (n.id === bestNext) {
                return 2.5;
            }
            return lit(n) ? 0.5 : 1;
        })
        .attr("class", (n) => (n.id === bestNext ? "kg-node kg-best-next" : "kg-node"));

    // Labels for the higher altitudes only (keeps ~48 nodes legible). A white halo (paint-order stroke)
    // lets text sit cleanly over nodes/edges without a chip background.
    g.filter((n) => n.kind === "section" || n.kind === "fc")
        .append("text")
        .text((n) => n.label)
        .attr("dy", (n) => -(KIND_RADIUS[n.kind] ?? 6) - 6)
        .attr("text-anchor", "middle")
        .attr("font-family", LABEL_FONT)
        .attr("font-size", (n) => (n.kind === "section" ? 12 : 10))
        .attr("font-weight", (n) => (n.kind === "section" ? 600 : 500))
        .attr("fill", (n) => (n.kind === "section" ? INK : "rgba(27,29,42,0.6)"))
        .attr("stroke", FIELD)
        .attr("stroke-width", 3.5)
        .attr("stroke-linejoin", "round")
        .attr("paint-order", "stroke");
}
