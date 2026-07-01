// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up (Nexus): a TRUE 3D knowledge-graph engine, rendered in SVG with an in-house perspective
// projection — zero new dependencies (no three.js/WebGL, so it runs on every video driver and never
// trips the Yarn age-gate; Decision 33). The baked x/y/z become a real point cloud: we rotate it
// (slow ambient orbit + drag), project with perspective (near nodes grow, far nodes recede and fade),
// and depth-sort each frame. Node hue = section identity; bloom = mastery (the live RPC, never a
// fabricated number).
//
// SCALE (2026-07-01): the graph now carries the full AAMC outline — hundreds of topic/subtopic nodes.
// STRICT SEMANTIC ZOOM + LEVEL-OF-DETAIL CULLING is what keeps it smooth and never a hairball: only the
// nodes at the *visible altitude* are projected/painted each frame; the rest are culled to display:none
// and cost nothing. Overview shows section galaxies (+ their categories as you raise detail); drill into
// a section to reveal its categories, into a category to reveal its topics, into a topic for subtopics.

import { select } from "d3";

import { buildGlowDefs, color, KIND_RADIUS, type NodeState, type Sidecar, type SidecarNode } from "./graph-render";

const SVGNS = "http://www.w3.org/2000/svg";
const VIEW_W = 1000;
const VIEW_H = 720;
const CX = VIEW_W / 2;
const CY = VIEW_H / 2;
const CAM_D = 2.6; // camera distance from the cloud centre
const FOCAL = 2.0; // perspective focal length
const SCREEN = 235; // world→screen scale
const ORBIT_SPEED = 0.0019; // radians/frame ambient yaw — calm, never a jittery sim
const PITCH = -0.34; // a gentle 3/4 "from slightly above" tilt
const DEFAULT_DETAIL = 0.5; // opens calm: 4 section galaxies + their foundational-concept clusters
const REVEAL_EASE = 0.14; // per-frame crossfade toward a node's visible/hidden target
const CULL_EPS = 0.02; // below this reveal (and hidden) a node is display:none and skipped entirely

// Altitude of each node kind (0 = section galaxy .. 4 = subtopic leaf). Drives the strict semantic-zoom
// visibility gate below — the whole point is that only one altitude's worth of nodes is ever on screen.
const DEPTH: Record<string, number> = {
    section: 0,
    fc: 1,
    category: 2,
    cars: 2,
    topic: 3,
    subtopic: 4,
};

// Camera zoom as you drill deeper (the "fly in"): overview is 1, each altitude tightens.
const FOCUS_ZOOM: Record<string, number> = {
    section: 2.0,
    fc: 2.5,
    category: 3.3,
    cars: 3.3,
    topic: 4.1,
    subtopic: 4.6,
};

const SECTION_SHORT: Record<string, string> = {
    "C-P": "C/P",
    "B-B": "B/B",
    "P-S": "P/S",
    "CARS": "CARS",
};
const SECTION_LONG: Record<string, string> = {
    "C-P": "Chem / Phys",
    "B-B": "Bio / Biochem",
    "P-S": "Psych / Soc",
    "CARS": "Critical Analysis & Reasoning",
};

export interface HoverInfo {
    label: string;
    sectionLabel: string;
    unlocks: number;
    lit: boolean;
}

export interface Graph3DCallbacks {
    /** Fired on node hover (null on leave). clientX/clientY locate the tooltip in the page. */
    onHover?: (info: HoverInfo | null, clientX: number, clientY: number) => void;
    /** Fired when the focused node changes (null when back at the overview), so the host can show a breadcrumb. */
    onSectionFocus?: (focus: { id: string; label: string } | null) => void;
}

export interface Graph3D {
    setMastery(mastery: Record<string, NodeState>, bestNext: string | null): void;
    /** Set the semantic-zoom resolution (0 = calm overview .. 1 = finest grain). */
    setDetail(detail: number): void;
    clearFocus(): void;
    setReducedMotion(reduced: boolean): void;
    destroy(): void;
}

interface NodeRT {
    n: SidecarNode;
    nx: number;
    ny: number;
    nz: number;
    baseR: number;
    group: SVGGElement;
    circle: SVGCircleElement;
    label: SVGTextElement | null;
    sx: number;
    sy: number;
    rz: number; // rotated depth (for sorting)
    factor: number; // perspective factor (near>far)
    reveal: number; // eased 0..1 visibility (level-of-detail crossfade)
    shown: boolean; // is the group currently attached/visible (for cheap cull toggling)
}

interface EdgeRT {
    src: string;
    dst: string;
    prereq: boolean;
    line: SVGLineElement;
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export function createGraph3D(
    svgEl: SVGSVGElement,
    sidecar: Sidecar,
    cb: Graph3DCallbacks = {},
): Graph3D {
    const root = select(svgEl);
    root.selectAll("*").remove();
    buildGlowDefs(svgEl);

    // ---- normalise the baked coords into a centred unit-ish cube ----
    const xs = sidecar.nodes.map((n) => n.x);
    const ys = sidecar.nodes.map((n) => n.y);
    const zs = sidecar.nodes.map((n) => n.z);
    const mid = (a: number[]): number => (Math.min(...a) + Math.max(...a)) / 2;
    const cx = mid(xs), cy = mid(ys), cz = mid(zs);
    const halfExtent = Math.max(
        ...sidecar.nodes.map((n) => Math.max(Math.abs(n.x - cx), Math.abs(n.y - cy), Math.abs(n.z - cz))),
    ) || 1;
    const norm = 1 / halfExtent;

    // ---- prerequisite adjacency (for focus chains) + out-degree (for the "unlocks N" tooltip) ----
    const prereqOut = new Map<string, string[]>();
    const prereqIn = new Map<string, string[]>();
    const push = (map: Map<string, string[]>, key: string, val: string): void => {
        const arr = map.get(key);
        if (arr) {
            arr.push(val);
        } else {
            map.set(key, [val]);
        }
    };
    for (const e of sidecar.edges) {
        if (e.kind !== "prerequisite") {
            continue;
        }
        push(prereqOut, e.src, e.dst);
        push(prereqIn, e.dst, e.src);
    }
    const outDegree = (id: string): number => prereqOut.get(id)?.length ?? 0;

    // ---- build DOM once ----
    const edgeLayer = root.append("g").attr("class", "kg-edges").node() as SVGGElement;
    const nodeLayer = root.append("g").attr("class", "kg-nodes").node() as SVGGElement;

    const edges: EdgeRT[] = sidecar.edges
        .filter((e) => sidecar.nodes.some((n) => n.id === e.src) && sidecar.nodes.some((n) => n.id === e.dst))
        .map((e) => {
            const line = document.createElementNS(SVGNS, "line");
            line.setAttribute("stroke-linecap", "round");
            edgeLayer.appendChild(line);
            return { src: e.src, dst: e.dst, prereq: e.kind === "prerequisite", line };
        });

    // Labels are created for the readable altitudes only (section / fc / category / cars); topics rely on hover.
    const hasLabel = (kind: string): boolean =>
        kind === "section" || kind === "fc" || kind === "category" || kind === "cars";

    const nodes: NodeRT[] = sidecar.nodes.map((n) => {
        const group = document.createElementNS(SVGNS, "g");
        group.setAttribute("class", "kg-node-group");
        const circle = document.createElementNS(SVGNS, "circle");
        circle.setAttribute("class", "kg-node");
        circle.setAttribute("fill", color(n.section));
        circle.setAttribute("data-id", n.id);
        circle.setAttribute("data-kind", n.kind);
        circle.setAttribute("data-section", n.section);
        group.appendChild(circle);
        let label: SVGTextElement | null = null;
        if (hasLabel(n.kind)) {
            label = document.createElementNS(SVGNS, "text");
            label.setAttribute("text-anchor", "middle");
            label.setAttribute("class", "kg-label");
            label.setAttribute("font-family", "Inter, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif");
            label.setAttribute("font-weight", n.kind === "section" ? "650" : "500");
            label.setAttribute("fill", n.kind === "section" ? "#1B1D2A" : "rgba(27,29,42,0.6)");
            // white halo so labels stay legible over the constellation
            label.setAttribute("stroke", "#FBFBFD");
            label.setAttribute("stroke-width", "3.5");
            label.setAttribute("stroke-linejoin", "round");
            label.setAttribute("paint-order", "stroke");
            label.style.pointerEvents = "none";
            label.textContent = n.kind === "section" ? (SECTION_SHORT[n.section] ?? n.section) : n.label;
            group.appendChild(label);
        }
        nodeLayer.appendChild(group);
        return {
            n,
            nx: (n.x - cx) * norm,
            ny: -(n.y - cy) * norm, // flip so the sidecar's +y reads as "up"
            nz: (n.z - cz) * norm,
            baseR: KIND_RADIUS[n.kind] ?? 5,
            group,
            circle,
            label,
            sx: CX,
            sy: CY,
            rz: 0,
            factor: 1,
            reveal: 0,
            shown: true,
        };
    });
    const byId = new Map(nodes.map((r) => [r.n.id, r]));

    // Per-section cluster centroid (normalised coords) — the camera flies to this when a galaxy is focused.
    const sectionCentroid = new Map<string, { nx: number; ny: number; nz: number }>();
    {
        const acc = new Map<string, { nx: number; ny: number; nz: number; c: number }>();
        for (const r of nodes) {
            const a = acc.get(r.n.section) ?? { nx: 0, ny: 0, nz: 0, c: 0 };
            a.nx += r.nx;
            a.ny += r.ny;
            a.nz += r.nz;
            a.c += 1;
            acc.set(r.n.section, a);
        }
        for (const [k, a] of acc) {
            sectionCentroid.set(k, { nx: a.nx / a.c, ny: a.ny / a.c, nz: a.nz / a.c });
        }
    }

    // ---- ancestry helpers (walk the containment parent chain) ----
    const parentOf = (id: string): string | null => byId.get(id)?.n.parent ?? null;
    // is `anc` an ancestor-or-self of `id`?
    const isDescOrSelf = (id: string, anc: string): boolean => {
        let cur: string | null = id;
        let guard = 0;
        while (cur && guard++ < 12) {
            if (cur === anc) {
                return true;
            }
            cur = parentOf(cur);
        }
        return false;
    };

    // ---- mutable view + data state ----
    let mastery: Record<string, NodeState> = {};
    let bestNext: string | null = null;
    let yaw = -0.5;
    let pitch = PITCH;
    let zoom = 1;
    let panX = 0;
    let panY = 0;
    let targetZoom = 1;
    let reduced = false;
    let detail = DEFAULT_DETAIL; // semantic-zoom "resolution": 0 = overview .. 1 = finest grain
    let entrance = 0; // 0→1 entrance ramp (nodes bloom in)
    let dragging = false;
    let dragMoved = false;
    let lastX = 0;
    let lastY = 0;
    let focusId: string | null = null; // the drilled node (section/category/topic) — the semantic-zoom root
    let focusNodeId: string | null = null; // node whose prerequisite chain is lit
    let chain: Set<string> | null = null; // focused node's prerequisite chain
    let running = false;
    let raf = 0;

    const lit = (id: string): boolean => {
        const m = mastery[id];
        return !!(m && m.hasState);
    };

    // STRICT SEMANTIC-ZOOM visibility gate. Returns whether a node belongs to the currently visible
    // altitude, given the drill focus + the detail slider. Bounded by construction: unfocused shows at
    // most the 48-node spine; a focus adds only its own subtree (a few levels) + siblings + anchors.
    // topics/subtopics NEVER show without drilling into a category, so it can never become a hairball.
    // How many altitudes below the focus to reveal: default shows ONE (drill a category → its topics),
    // high detail shows TWO (→ its subtopics too). Keeps each drill step calm, never a wall of leaves.
    const revealLevels = (): number => (detail < 0.55 ? 1 : 2);
    function isVisible(n: SidecarNode): boolean {
        const nd = DEPTH[n.kind] ?? 3;
        if (focusId === null) {
            if (nd <= 1) {
                return true; // sections + foundational concepts
            }
            if (n.kind === "category" || n.kind === "cars") {
                return detail > 0.33; // raise detail to reveal the whole category spine (still bounded, 34)
            }
            return false; // topics/subtopics need a drill
        }
        const f = byId.get(focusId)?.n;
        if (!f) {
            return nd <= 1;
        }
        if (n.id === focusId) {
            return true;
        }
        if (isDescOrSelf(focusId, n.id)) {
            return true; // n is an ancestor of the focus (the breadcrumb path)
        }
        if (isDescOrSelf(n.id, focusId)) {
            // n is under the focus. A section focus reveals its content CATEGORIES directly (FCs are just
            // context), so the map reads section → categories → topics → subtopics like map zoom levels.
            const fd = DEPTH[f.kind] ?? 0;
            const extra = fd === 0 ? 1 : 0; // section focus gets one extra altitude (its categories)
            const maxDepth = fd + revealLevels() + extra;
            if (nd > maxDepth) {
                return false;
            }
            if (nd >= 3 && fd < 2) {
                return false; // topics/subtopics only once you've drilled into a category
            }
            return true;
        }
        if (n.parent && n.parent === f.parent) {
            return true; // siblings of the focus, for context
        }
        return n.kind === "section"; // the 4 section galaxies stay as faint anchors
    }

    function project(): void {
        const cosY = Math.cos(yaw), sinY = Math.sin(yaw);
        const cosX = Math.cos(pitch), sinX = Math.sin(pitch);
        // recompute the pan that centres the focused node (rotation may still change via drag)
        let targetPanX = 0, targetPanY = 0;
        if (focusId) {
            const fr = byId.get(focusId);
            // a section focus centres on the galaxy centroid; deeper focus centres on the node itself
            const c = fr && fr.n.kind === "section" ? sectionCentroid.get(fr.n.section) : fr
                ? { nx: fr.nx, ny: fr.ny, nz: fr.nz }
                : undefined;
            if (c) {
                const p = projectPoint(c.nx, c.ny, c.nz, cosY, sinY, cosX, sinX, 0, 0, targetZoom);
                targetPanX = CX - p.sx;
                targetPanY = CY - p.sy;
            }
        }
        panX = lerp(panX, targetPanX, 0.12);
        panY = lerp(panY, targetPanY, 0.12);
        zoom = lerp(zoom, targetZoom, 0.12);

        // Active set = nodes with any reveal (the culled ones are skipped entirely — the perf win).
        const active: NodeRT[] = [];
        let minF = Infinity, maxF = -Infinity;
        for (const r of nodes) {
            if (r.reveal < CULL_EPS) {
                if (r.shown) {
                    r.group.style.display = "none";
                    r.shown = false;
                }
                continue;
            }
            if (!r.shown) {
                r.group.style.display = "";
                r.shown = true;
            }
            const p = projectPoint(r.nx, r.ny, r.nz, cosY, sinY, cosX, sinX, panX, panY, zoom);
            r.sx = p.sx;
            r.sy = p.sy;
            r.rz = p.rz;
            r.factor = p.factor;
            if (p.factor < minF) {
                minF = p.factor;
            }
            if (p.factor > maxF) {
                maxF = p.factor;
            }
            active.push(r);
        }
        const fSpan = maxF - minF || 1;

        // depth sort (far first) so nearer nodes paint on top — only the ACTIVE set is sorted/re-appended
        active.sort((a, b) => a.rz - b.rz);
        for (const r of active) {
            nodeLayer.appendChild(r.group);
        }
        for (const r of active) {
            const depthN = (r.factor - minF) / fSpan; // 0 far .. 1 near
            paintNode(r, depthN);
        }
        for (const e of edges) {
            paintEdge(e);
        }
    }

    function projectPoint(
        nx: number,
        ny: number,
        nz: number,
        cosY: number,
        sinY: number,
        cosX: number,
        sinX: number,
        px: number,
        py: number,
        z: number,
    ): { sx: number; sy: number; rz: number; factor: number } {
        const x1 = nx * cosY + nz * sinY;
        const z1 = -nx * sinY + nz * cosY;
        const y1 = ny;
        const y2 = y1 * cosX - z1 * sinX;
        const z2 = y1 * sinX + z1 * cosX;
        const factor = FOCAL / (CAM_D - z2);
        return {
            sx: CX + x1 * factor * SCREEN * z + px,
            sy: CY + y2 * factor * SCREEN * z + py,
            rz: z2,
            factor,
        };
    }

    // A node is "on the focus path or in the focused subtree" => full brightness; other visible nodes
    // (anchors / siblings / ancestors' other branches) are context => dimmed so the focus pops.
    function isContext(id: string): boolean {
        if (focusId === null) {
            return false;
        }
        return !(isDescOrSelf(id, focusId) || isDescOrSelf(focusId, id));
    }

    function paintNode(r: NodeRT, depthN: number): void {
        const { n, circle, group, label } = r;
        const isBest = n.id === bestNext;
        const isLit = lit(n.id);
        const dim = isContext(n.id) || (chain != null && !chain.has(n.id));
        const ent = 1 - (1 - entrance) ** 3; // ease-out entrance
        const reveal = r.reveal;
        const radius = r.baseR * r.factor * zoom * (0.72 + 0.42 * depthN) * (0.25 + 0.75 * ent)
            * (0.35 + 0.65 * reveal);
        group.setAttribute("transform", `translate(${r.sx.toFixed(2)},${r.sy.toFixed(2)})`);
        circle.setAttribute("r", radius.toFixed(2));
        // below the reveal floor the node is faded out — don't let a ghost node catch clicks.
        circle.style.pointerEvents = reveal < 0.2 ? "none" : "auto";

        // fill opacity: un-lit gap = colored-but-dim; lit saturates with recall; far nodes recede
        // (gentle atmosphere — keep lit nodes vivid even on the far side); reveal gates by detail.
        const m = mastery[n.id];
        const base = !m || !m.hasState ? 0.45 : 0.7 + 0.3 * clamp(m.recall, 0, 1);
        const atmos = 0.7 + 0.3 * depthN;
        circle.setAttribute("fill-opacity", ((dim ? 0.12 : base) * atmos * ent * reveal).toFixed(3));

        // earned bloom: lit nodes (and best-next, stronger) gain a section-tinted halo
        if (dim) {
            circle.removeAttribute("filter");
        } else if (isBest) {
            circle.setAttribute("filter", `url(#kg-glow-${n.section}-strong)`);
        } else if (isLit) {
            circle.setAttribute("filter", `url(#kg-glow-${n.section}-soft)`);
        } else {
            circle.removeAttribute("filter");
        }

        if (isBest) {
            circle.setAttribute("stroke", color(n.section));
            circle.setAttribute("stroke-width", "2.5");
            circle.setAttribute("stroke-opacity", "1");
        } else if (isLit) {
            circle.setAttribute("stroke", "rgba(27,29,42,0.10)");
            circle.setAttribute("stroke-width", "0.5");
            circle.setAttribute("stroke-opacity", dim ? "0.2" : "1");
        } else {
            circle.setAttribute("stroke", color(n.section));
            circle.setAttribute("stroke-width", "1");
            circle.setAttribute("stroke-opacity", dim ? "0.18" : "0.5");
        }
        // toggle (don't reassign className) so a live .kg-hover class isn't clobbered each frame
        circle.classList.toggle("kg-best-next", isBest);

        if (label) {
            // Declutter: sections are always labelled; FC labels show at the overview or within the
            // focused section; the 34 long category names show ONLY once you've drilled into their section
            // (never all at once at the overview). Topics/subtopics rely on hover — they carry no label DOM.
            const f = focusId ? byId.get(focusId)?.n : null;
            let showLabel = false;
            if (n.kind === "section") {
                showLabel = true;
            } else if (n.kind === "fc") {
                showLabel = !f || f.section === n.section;
            } else if (n.kind === "category" || n.kind === "cars") {
                showLabel = !!f && f.section === n.section;
            }
            const labelOpacity = showLabel && !dim ? clamp(reveal, 0, 1) * (0.55 + 0.45 * depthN) : 0;
            label.setAttribute("opacity", labelOpacity.toFixed(2));
            label.setAttribute("y", (-radius - 7).toString());
            label.setAttribute(
                "font-size",
                (n.kind === "section" ? 13 : n.kind === "fc" ? 10 : 9).toString(),
            );
        }
    }

    function paintEdge(e: EdgeRT): void {
        const a = byId.get(e.src), b = byId.get(e.dst);
        if (!a || !b) {
            return;
        }
        // an edge is only as present as its faintest endpoint's reveal (no orphan lines into culled nodes)
        const eReveal = Math.min(a.reveal, b.reveal);
        if (eReveal < CULL_EPS) {
            e.line.setAttribute("stroke-opacity", "0");
            return;
        }
        const dimA = isContext(a.n.id) || isContext(b.n.id)
            || (chain != null && !(chain.has(a.n.id) && chain.has(b.n.id)));
        const onChain = chain != null && chain.has(a.n.id) && chain.has(b.n.id);
        e.line.setAttribute("x1", a.sx.toFixed(2));
        e.line.setAttribute("y1", a.sy.toFixed(2));
        e.line.setAttribute("x2", b.sx.toFixed(2));
        e.line.setAttribute("y2", b.sy.toFixed(2));
        let opacity: number;
        let width: number;
        if (onChain) {
            opacity = 0.5;
            width = 1.6;
        } else if (dimA) {
            opacity = 0.03;
            width = 0.6;
        } else {
            opacity = e.prereq ? 0.18 : 0.08;
            width = e.prereq ? 1.1 : 0.6;
        }
        e.line.setAttribute("stroke", "#1B1D2A");
        e.line.setAttribute("stroke-opacity", (opacity * eReveal).toString());
        e.line.setAttribute("stroke-width", width.toString());
    }

    // ---- animation loop (only runs while there's motion) ----
    function settled(): boolean {
        const ambient = !reduced && !focusId && !dragging;
        let revealSettling = false;
        for (const r of nodes) {
            const target = isVisible(r.n) ? 1 : 0;
            if (Math.abs(r.reveal - target) > 0.001) {
                revealSettling = true;
                break;
            }
        }
        const animating = entrance < 1
            || Math.abs(zoom - targetZoom) > 0.001
            || Math.abs(panX) > 0.5 || Math.abs(panY) > 0.5
            || revealSettling;
        return !ambient && !animating;
    }
    function tick(): void {
        if (entrance < 1) {
            entrance = Math.min(1, entrance + 0.05);
        }
        // ease every node toward its semantic-zoom visibility target (the crossfade in/out)
        for (const r of nodes) {
            const target = isVisible(r.n) ? 1 : 0;
            if (reduced) {
                r.reveal = target;
            } else if (Math.abs(r.reveal - target) > 0.001) {
                r.reveal = lerp(r.reveal, target, REVEAL_EASE);
            } else {
                r.reveal = target;
            }
        }
        if (!reduced && !focusId && !dragging) {
            yaw += ORBIT_SPEED;
        }
        project();
        if (settled()) {
            running = false;
            return;
        }
        raf = requestAnimationFrame(tick);
    }
    function kick(): void {
        if (!running) {
            running = true;
            raf = requestAnimationFrame(tick);
        }
    }

    // ---- prerequisite chain for focus+context ----
    function buildChain(id: string): Set<string> {
        const set = new Set<string>([id]);
        const walk = (start: string, adj: Map<string, string[]>): void => {
            const stack = [start];
            while (stack.length) {
                const cur = stack.pop()!;
                for (const nxt of adj.get(cur) ?? []) {
                    if (!set.has(nxt)) {
                        set.add(nxt);
                        stack.push(nxt);
                    }
                }
            }
        };
        walk(id, prereqIn); // everything this node depends on
        walk(id, prereqOut); // everything it unlocks
        return set;
    }

    // ---- interactions ----
    function onCircleEnter(r: NodeRT, ev: PointerEvent): void {
        r.circle.classList.add("kg-hover");
        cb.onHover?.(
            {
                label: r.n.label,
                sectionLabel: SECTION_LONG[r.n.section] ?? r.n.section,
                unlocks: outDegree(r.n.id),
                lit: lit(r.n.id),
            },
            ev.clientX,
            ev.clientY,
        );
    }
    function onCircleLeave(r: NodeRT): void {
        r.circle.classList.remove("kg-hover");
        cb.onHover?.(null, 0, 0);
    }
    // A node with children DRILLS (semantic zoom); a leaf toggles its prerequisite-chain highlight.
    const hasChildren = (id: string): boolean => nodes.some((r) => r.n.parent === id);
    function onCircleClick(r: NodeRT): void {
        if (dragMoved) {
            return; // it was an orbit drag, not a click
        }
        if (hasChildren(r.n.id)) {
            focusNode(focusId === r.n.id ? parentOf(r.n.id) : r.n.id);
        } else if (focusNodeId === r.n.id) {
            focusNodeId = null;
            chain = null;
            kick();
        } else {
            focusNodeId = r.n.id;
            chain = buildChain(r.n.id);
            kick();
        }
    }
    function focusNode(id: string | null): void {
        focusId = id;
        focusNodeId = null;
        chain = null;
        const node = id ? byId.get(id)?.n : null;
        targetZoom = node ? (FOCUS_ZOOM[node.kind] ?? 2.4) : 1;
        const crumbLabel = node
            ? node.kind === "section" ? (SECTION_LONG[node.section] ?? node.label) : node.label
            : "";
        cb.onSectionFocus?.(node ? { id: node.id, label: crumbLabel } : null);
        kick();
    }

    for (const r of nodes) {
        r.circle.addEventListener("pointerenter", (ev) => onCircleEnter(r, ev as PointerEvent));
        r.circle.addEventListener("pointerleave", () => onCircleLeave(r));
        r.circle.addEventListener("click", () => onCircleClick(r));
        r.circle.style.cursor = "pointer";
    }

    let captured = -1;
    function onPointerDown(ev: PointerEvent): void {
        dragging = true;
        dragMoved = false;
        lastX = ev.clientX;
        lastY = ev.clientY;
        // NB: do NOT capture here — capturing on a plain click would retarget the `click` event to the
        // SVG (background) instead of the node. Capture only once a real drag begins (onPointerMove).
        kick();
    }
    function onPointerMove(ev: PointerEvent): void {
        if (!dragging) {
            return;
        }
        const dx = ev.clientX - lastX;
        const dy = ev.clientY - lastY;
        if (Math.abs(dx) + Math.abs(dy) > 3) {
            if (!dragMoved) {
                svgEl.setPointerCapture?.(ev.pointerId);
                captured = ev.pointerId;
            }
            dragMoved = true;
        }
        lastX = ev.clientX;
        lastY = ev.clientY;
        yaw += dx * 0.006;
        pitch = clamp(pitch + dy * 0.006, -1.2, 1.2);
        kick();
    }
    function onPointerUp(): void {
        dragging = false;
        if (captured >= 0) {
            svgEl.releasePointerCapture?.(captured);
            captured = -1;
        }
        kick();
    }
    // Clicking empty space pops UP one altitude (drill out), then finally back to the overview.
    function onBackgroundClick(ev: MouseEvent): void {
        if (ev.target === svgEl && !dragMoved) {
            if (focusNodeId) {
                focusNodeId = null;
                chain = null;
                kick();
            } else if (focusId) {
                focusNode(parentOf(focusId));
            } else {
                kick();
            }
        }
    }
    svgEl.addEventListener("pointerdown", onPointerDown);
    svgEl.addEventListener("pointermove", onPointerMove);
    svgEl.addEventListener("pointerup", onPointerUp);
    svgEl.addEventListener("click", onBackgroundClick);
    svgEl.style.touchAction = "none";

    // first paint + spin up
    project();
    kick();

    return {
        setMastery(m, bn) {
            mastery = m;
            bestNext = bn;
            project();
            kick();
        },
        setDetail(d) {
            detail = clamp(d, 0, 1);
            kick();
        },
        clearFocus() {
            chain = null;
            focusNode(null);
        },
        setReducedMotion(r) {
            reduced = r;
            if (r) {
                entrance = 1; // no entrance animation under reduced motion
            }
            kick();
        },
        destroy() {
            cancelAnimationFrame(raf);
            running = false;
            svgEl.removeEventListener("pointerdown", onPointerDown);
            svgEl.removeEventListener("pointermove", onPointerMove);
            svgEl.removeEventListener("pointerup", onPointerUp);
            svgEl.removeEventListener("click", onBackgroundClick);
            root.selectAll("*").remove();
        },
    };
}
