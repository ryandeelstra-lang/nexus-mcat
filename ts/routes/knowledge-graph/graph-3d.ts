// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up (Nexus): the 3D knowledge-graph engine — an in-house SVG perspective projection, zero new
// deps (runs on every video driver; Decision 33). Baked x/y/z become a rotating point cloud.
//
// THE DETAIL SLIDER IS A GLOBAL LEVEL-OF-DETAIL CONTROL (2026-07-01): it does NOT resize nodes — it
// ADDS them. Every node carries an `appear` threshold in [0,1]; the slider `t` shows exactly the nodes
// with `appear <= t`. t=0 => the 4 section galaxies (the minimalist default); sliding up STREAMS IN
// foundational concepts → categories → topics → subtopics → concepts → cards (10k+), parents always
// before children, higher-yield first. Node *size* is constant per kind; only opacity fades in.
//
// SCALE: DOM is created LAZILY (only for revealed nodes) and per-frame work is proportional to what's
// visible, not the ~10k total — so the low/default end stays buttery and the dense end still renders.
// When the visible set gets large the ambient orbit + edges switch off (a calm static constellation).

import { select } from "d3";

import { buildGlowDefs, color, KIND_RADIUS, type NodeState, type Sidecar, type SidecarNode } from "./graph-render";

const SVGNS = "http://www.w3.org/2000/svg";
const VIEW_W = 1000;
const VIEW_H = 720;
const CX = VIEW_W / 2;
const CY = VIEW_H / 2;
const CAM_D = 2.6;
const FOCAL = 2.0;
const SCREEN = 235;
const ORBIT_SPEED = 0.0019;
const PITCH = -0.34;
const ORBIT_MAX = 1600; // above this many visible nodes, stop the ambient orbit (calm static scene)
const EDGE_MAX = 1400; // above this many visible nodes, hide edges (they become noise + a perf drag)
const REVEAL_EASE = 0.16; // opacity fade-in as a node streams in

// Fallback appear-threshold by kind, for graphs whose nodes don't carry `appear` (e.g. the small spine).
const APPEAR_BY_KIND: Record<string, number> = {
    section: 0,
    fc: 0.08,
    category: 0.14,
    cars: 0.14,
    topic: 0.3,
    subtopic: 0.5,
    concept: 0.7,
    card: 0.85,
};

const SECTION_SHORT: Record<string, string> = { "C-P": "C/P", "B-B": "B/B", "P-S": "P/S", "CARS": "CARS" };
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
    onHover?: (info: HoverInfo | null, clientX: number, clientY: number) => void;
    onSectionFocus?: (focus: { id: string; label: string } | null) => void;
    /** Reports the visible node count as the slider moves, so the host can show "N / total". */
    onCount?: (visible: number, total: number) => void;
}

export interface Graph3D {
    setMastery(mastery: Record<string, NodeState>, bestNext: string | null): void;
    setDetail(detail: number): void;
    clearFocus(): void;
    setReducedMotion(reduced: boolean): void;
    destroy(): void;
}

interface NodeRT {
    n: SidecarNode;
    appear: number;
    nx: number;
    ny: number;
    nz: number;
    baseR: number;
    group: SVGGElement | null; // created lazily on first reveal
    circle: SVGCircleElement | null;
    label: SVGTextElement | null;
    sx: number;
    sy: number;
    rz: number;
    factor: number;
    reveal: number; // eased opacity 0..1
    active: boolean; // appear <= detail
}

interface EdgeRT {
    src: string;
    dst: string;
    prereq: boolean;
    line: SVGLineElement | null;
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export function createGraph3D(svgEl: SVGSVGElement, graph: Sidecar, cb: Graph3DCallbacks = {}): Graph3D {
    const root = select(svgEl);
    root.selectAll("*").remove();
    buildGlowDefs(svgEl);

    const xs = graph.nodes.map((n) => n.x);
    const ys = graph.nodes.map((n) => n.y);
    const zs = graph.nodes.map((n) => n.z);
    const mid = (a: number[]): number => (Math.min(...a) + Math.max(...a)) / 2;
    const cx = mid(xs), cy = mid(ys), cz = mid(zs);
    const halfExtent = Math.max(
        ...graph.nodes.map((n) => Math.max(Math.abs(n.x - cx), Math.abs(n.y - cy), Math.abs(n.z - cz))),
    ) || 1;
    const norm = 1 / halfExtent;

    const prereqOut = new Map<string, string[]>();
    const prereqIn = new Map<string, string[]>();
    const push = (m: Map<string, string[]>, k: string, v: string): void => {
        const a = m.get(k);
        if (a) {
            a.push(v);
        } else {
            m.set(k, [v]);
        }
    };
    for (const e of graph.edges) {
        if (e.kind === "prerequisite") {
            push(prereqOut, e.src, e.dst);
            push(prereqIn, e.dst, e.src);
        }
    }
    const outDegree = (id: string): number => prereqOut.get(id)?.length ?? 0;

    const edgeLayer = root.append("g").attr("class", "kg-edges").node() as SVGGElement;
    const nodeLayer = root.append("g").attr("class", "kg-nodes").node() as SVGGElement;

    const nodes: NodeRT[] = graph.nodes.map((n) => ({
        n,
        appear: n.appear ?? APPEAR_BY_KIND[n.kind] ?? 0.6,
        nx: (n.x - cx) * norm,
        ny: -(n.y - cy) * norm,
        nz: (n.z - cz) * norm,
        baseR: KIND_RADIUS[n.kind] ?? 1.2,
        group: null,
        circle: null,
        label: null,
        sx: CX,
        sy: CY,
        rz: 0,
        factor: 1,
        reveal: 0,
        active: false,
    }));
    const byId = new Map(nodes.map((r) => [r.n.id, r]));

    const edges: EdgeRT[] = graph.edges
        .filter((e) => byId.has(e.src) && byId.has(e.dst))
        .map((e) => ({ src: e.src, dst: e.dst, prereq: e.kind === "prerequisite", line: null }));

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

    const hasLabel = (kind: string): boolean =>
        kind === "section" || kind === "fc" || kind === "category" || kind === "cars";
    const parentOf = (id: string): string | null => byId.get(id)?.n.parent ?? null;
    const isDescOrSelf = (id: string, anc: string): boolean => {
        let cur: string | null = id;
        let g = 0;
        while (cur && g++ < 16) {
            if (cur === anc) {
                return true;
            }
            cur = parentOf(cur);
        }
        return false;
    };

    let mastery: Record<string, NodeState> = {};
    let bestNext: string | null = null;
    let yaw = -0.5;
    let pitch = PITCH;
    let zoom = 1;
    let panX = 0;
    let panY = 0;
    let targetZoom = 1;
    let reduced = false;
    let detail = 0; // global slider — 0 shows the 4 sections
    let dragging = false;
    let dragMoved = false;
    let lastX = 0;
    let lastY = 0;
    let focusId: string | null = null;
    let chain: Set<string> | null = null;
    let running = false;
    let raf = 0;
    let activeList: NodeRT[] = [];

    const lit = (id: string): boolean => {
        const m = mastery[id];
        return !!(m && m.hasState);
    };

    function ensureDom(r: NodeRT): void {
        if (r.group) {
            return;
        }
        const group = document.createElementNS(SVGNS, "g");
        const circle = document.createElementNS(SVGNS, "circle");
        circle.setAttribute("class", "kg-node");
        circle.setAttribute("fill", color(r.n.section));
        circle.setAttribute("data-id", r.n.id);
        circle.setAttribute("data-kind", r.n.kind);
        circle.style.cursor = "pointer";
        circle.addEventListener("pointerenter", (ev) => onCircleEnter(r, ev as PointerEvent));
        circle.addEventListener("pointerleave", () => onCircleLeave(r));
        circle.addEventListener("click", () => onCircleClick(r));
        group.appendChild(circle);
        r.group = group;
        r.circle = circle;
        if (hasLabel(r.n.kind)) {
            const label = document.createElementNS(SVGNS, "text");
            label.setAttribute("text-anchor", "middle");
            label.setAttribute("font-family", "Inter, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif");
            label.setAttribute("font-weight", r.n.kind === "section" ? "650" : "500");
            label.setAttribute("fill", r.n.kind === "section" ? "#1B1D2A" : "rgba(27,29,42,0.6)");
            label.setAttribute("stroke", "#FBFBFD");
            label.setAttribute("stroke-width", "3.2");
            label.setAttribute("stroke-linejoin", "round");
            label.setAttribute("paint-order", "stroke");
            label.style.pointerEvents = "none";
            label.textContent = r.n.kind === "section" ? (SECTION_SHORT[r.n.section] ?? r.n.section) : r.n.label;
            group.appendChild(label);
            r.label = label;
        }
        nodeLayer.appendChild(group);
    }

    // Recompute which nodes are within the slider threshold; create/hide DOM accordingly. Called only
    // when the slider (or data) changes — the per-frame loop then iterates just the active set.
    function recomputeActive(): void {
        const next: NodeRT[] = [];
        for (const r of nodes) {
            const on = r.appear <= detail + 1e-6;
            if (on) {
                r.active = true;
                ensureDom(r);
                next.push(r);
            } else if (r.active) {
                r.active = false;
                r.reveal = 0;
                if (r.group) {
                    r.group.style.display = "none";
                }
            }
        }
        for (const r of next) {
            if (r.group) {
                r.group.style.display = "";
            }
        }
        activeList = next;
        cb.onCount?.(activeList.length, nodes.length);
    }

    function projectPoint(
        nx: number,
        ny: number,
        nz: number,
        cY: number,
        sY: number,
        cX: number,
        sX: number,
        px: number,
        py: number,
        z: number,
    ) {
        const x1 = nx * cY + nz * sY;
        const z1 = -nx * sY + nz * cY;
        const y1 = ny;
        const y2 = y1 * cX - z1 * sX;
        const z2 = y1 * sX + z1 * cX;
        const factor = FOCAL / (CAM_D - z2);
        return { sx: CX + x1 * factor * SCREEN * z + px, sy: CY + y2 * factor * SCREEN * z + py, rz: z2, factor };
    }

    function project(): void {
        const cY = Math.cos(yaw), sY = Math.sin(yaw), cX = Math.cos(pitch), sX = Math.sin(pitch);
        let tPanX = 0, tPanY = 0;
        if (focusId) {
            const fr = byId.get(focusId);
            const c = fr && fr.n.kind === "section"
                ? sectionCentroid.get(fr.n.section)
                : fr
                ? { nx: fr.nx, ny: fr.ny, nz: fr.nz }
                : undefined;
            if (c) {
                const p = projectPoint(c.nx, c.ny, c.nz, cY, sY, cX, sX, 0, 0, targetZoom);
                tPanX = CX - p.sx;
                tPanY = CY - p.sy;
            }
        }
        panX = lerp(panX, tPanX, 0.12);
        panY = lerp(panY, tPanY, 0.12);
        zoom = lerp(zoom, targetZoom, 0.12);

        let minF = Infinity, maxF = -Infinity;
        for (const r of activeList) {
            const p = projectPoint(r.nx, r.ny, r.nz, cY, sY, cX, sX, panX, panY, zoom);
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
        }
        const span = (maxF - minF) || 1;

        // depth-sort only when the active set is small enough to re-append cheaply
        if (activeList.length <= ORBIT_MAX) {
            activeList.sort((a, b) => a.rz - b.rz);
            for (const r of activeList) {
                if (r.group) {
                    nodeLayer.appendChild(r.group);
                }
            }
        }
        for (const r of activeList) {
            paintNode(r, (r.factor - minF) / span);
        }
        paintEdges();
    }

    function paintNode(r: NodeRT, depthN: number): void {
        const { n, circle, group, label } = r;
        if (!circle || !group) {
            return;
        }
        const isBest = n.id === bestNext;
        const isLit = lit(n.id);
        const dim = chain != null && !chain.has(n.id);
        const rev = r.reveal;
        const radius = r.baseR * r.factor * zoom * (0.72 + 0.42 * depthN);
        group.setAttribute("transform", `translate(${r.sx.toFixed(2)},${r.sy.toFixed(2)})`);
        circle.setAttribute("r", radius.toFixed(2));
        circle.style.pointerEvents = rev < 0.3 ? "none" : "auto";

        const m = mastery[n.id];
        const base = !m || !m.hasState ? 0.45 : 0.7 + 0.3 * clamp(m.recall, 0, 1);
        const atmos = 0.7 + 0.3 * depthN;
        circle.setAttribute("fill-opacity", ((dim ? 0.1 : base) * atmos * rev).toFixed(3));

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
            circle.setAttribute("stroke-opacity", rev.toFixed(2));
        } else if (isLit) {
            circle.setAttribute("stroke", "rgba(27,29,42,0.10)");
            circle.setAttribute("stroke-width", "0.5");
            circle.setAttribute("stroke-opacity", (dim ? 0.2 : rev).toFixed(2));
        } else {
            circle.setAttribute("stroke", color(n.section));
            circle.setAttribute("stroke-width", n.kind === "section" || n.kind === "fc" ? "1" : "0.6");
            circle.setAttribute("stroke-opacity", ((dim ? 0.18 : 0.5) * rev).toFixed(2));
        }
        circle.classList.toggle("kg-best-next", isBest);

        if (label) {
            // Labels only for the readable altitudes, and only once they're prominent (keeps a 10k
            // constellation from becoming text soup — deep nodes rely on hover).
            const f = focusId ? byId.get(focusId)?.n : null;
            let show = false;
            if (n.kind === "section") {
                show = true;
            } else if (n.kind === "fc") {
                show = !f || f.section === n.section;
            } else if (n.kind === "category" || n.kind === "cars") {
                show = !!f && f.section === n.section;
            }
            const op = show && !dim ? rev * (0.55 + 0.45 * depthN) : 0;
            label.setAttribute("opacity", op.toFixed(2));
            label.setAttribute("y", (-radius - 6).toString());
            label.setAttribute("font-size", (n.kind === "section" ? 13 : n.kind === "fc" ? 10 : 9).toString());
        }
    }

    function paintEdges(): void {
        const showEdges = activeList.length <= EDGE_MAX;
        for (const e of edges) {
            const a = byId.get(e.src), b = byId.get(e.dst);
            const bothActive = !!a && !!b && a.active && b.active;
            const onChain = chain != null && !!a && !!b && chain.has(a.n.id) && chain.has(b.n.id);
            const draw = onChain || (showEdges && bothActive && e.prereq);
            if (!draw || !a || !b) {
                if (e.line) {
                    e.line.setAttribute("stroke-opacity", "0");
                }
                continue;
            }
            if (!e.line) {
                e.line = document.createElementNS(SVGNS, "line");
                e.line.setAttribute("stroke", "#1B1D2A");
                e.line.setAttribute("stroke-linecap", "round");
                edgeLayer.appendChild(e.line);
            }
            const rev = Math.min(a.reveal, b.reveal);
            e.line.setAttribute("x1", a.sx.toFixed(2));
            e.line.setAttribute("y1", a.sy.toFixed(2));
            e.line.setAttribute("x2", b.sx.toFixed(2));
            e.line.setAttribute("y2", b.sy.toFixed(2));
            e.line.setAttribute("stroke-opacity", ((onChain ? 0.5 : 0.14) * rev).toFixed(3));
            e.line.setAttribute("stroke-width", onChain ? "1.6" : "0.8");
        }
    }

    function ambientOn(): boolean {
        return !reduced && !focusId && !dragging && activeList.length <= ORBIT_MAX;
    }
    function settled(): boolean {
        let easing = false;
        for (const r of activeList) {
            if (Math.abs(r.reveal - 1) > 0.01) {
                easing = true;
                break;
            }
        }
        const moving = Math.abs(zoom - targetZoom) > 0.001 || Math.abs(panX) > 0.5 || Math.abs(panY) > 0.5;
        return !ambientOn() && !easing && !moving;
    }
    function tick(): void {
        for (const r of activeList) {
            if (reduced) {
                r.reveal = 1;
            } else if (r.reveal < 1) {
                r.reveal = Math.min(1, r.reveal + REVEAL_EASE);
            }
        }
        if (ambientOn()) {
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
        walk(id, prereqIn);
        walk(id, prereqOut);
        return set;
    }

    function onCircleEnter(r: NodeRT, ev: PointerEvent): void {
        r.circle?.classList.add("kg-hover");
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
        r.circle?.classList.remove("kg-hover");
        cb.onHover?.(null, 0, 0);
    }
    const FOCUS_ZOOM: Record<string, number> = {
        section: 2.0,
        fc: 2.5,
        category: 3.3,
        cars: 3.3,
        topic: 4.0,
        subtopic: 4.6,
        concept: 5.2,
        card: 5.6,
    };
    function onCircleClick(r: NodeRT): void {
        if (dragMoved) {
            return;
        }
        if (focusId === r.n.id) {
            focusNode(parentOf(r.n.id));
        } else {
            focusNode(r.n.id);
        }
    }
    function focusNode(id: string | null): void {
        focusId = id;
        const node = id ? byId.get(id)?.n : null;
        chain = id ? buildChain(id) : null;
        targetZoom = node ? (FOCUS_ZOOM[node.kind] ?? 2.4) : 1;
        const crumb = node
            ? node.kind === "section" ? (SECTION_LONG[node.section] ?? node.label) : node.label
            : "";
        cb.onSectionFocus?.(node ? { id: node.id, label: crumb } : null);
        kick();
    }

    let captured = -1;
    function onPointerDown(ev: PointerEvent): void {
        dragging = true;
        dragMoved = false;
        lastX = ev.clientX;
        lastY = ev.clientY;
        kick();
    }
    function onPointerMove(ev: PointerEvent): void {
        if (!dragging) {
            return;
        }
        const dx = ev.clientX - lastX, dy = ev.clientY - lastY;
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
        project();
    }
    function onPointerUp(): void {
        dragging = false;
        if (captured >= 0) {
            svgEl.releasePointerCapture?.(captured);
            captured = -1;
        }
        kick();
    }
    function onBackgroundClick(ev: MouseEvent): void {
        if (ev.target === svgEl && !dragMoved) {
            if (focusId) {
                focusNode(parentOf(focusId));
            }
        }
    }
    svgEl.addEventListener("pointerdown", onPointerDown);
    svgEl.addEventListener("pointermove", onPointerMove);
    svgEl.addEventListener("pointerup", onPointerUp);
    svgEl.addEventListener("click", onBackgroundClick);
    svgEl.style.touchAction = "none";

    recomputeActive();
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
            const t = clamp(d, 0, 1);
            if (Math.abs(t - detail) < 1e-6) {
                return;
            }
            detail = t;
            recomputeActive();
            kick();
        },
        clearFocus() {
            focusNode(null);
        },
        setReducedMotion(r) {
            reduced = r;
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
