<!--
Copyright: Ankitects Pty Ltd and contributors
License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html
-->
<!--
charged_up: Nexus hero — a dense, ambient "living knowledge graph" for the landing background.
Purely decorative (no real data, no RPC): hundreds of section-hued nodes in four clusters, a rich
prerequisite-style edge web, perspective depth, and a slow calm rotation. Canvas 2D (no WebGL) so it
runs on every driver; deterministic layout (seeded) so it looks the same each launch. Honors
prefers-reduced-motion (renders one static frame). Kept dim — the copy always reads on top.
-->
<script lang="ts">
    import { onDestroy, onMount } from "svelte";

    // section-identity hues: C/P blue, B/B teal, P/S amber, CARS violet
    const HUES = ["#3B82F6", "#14B8A6", "#F59E0B", "#8B5CF6"];
    const TAU = Math.PI * 2;

    let canvas: HTMLCanvasElement;
    let frame = 0;
    let ro: ResizeObserver | null = null;
    let reduced = false;

    interface Node {
        x: number;
        y: number;
        z: number;
        base: number;
        hue: string;
    }
    let nodes: Node[] = [];
    let edges: Array<[number, number]> = [];

    // small seeded PRNG (mulberry32) for a stable, hand-tuned layout
    function rng(seed: number): () => number {
        let s = seed >>> 0;
        return () => {
            s = (s + 0x6d2b79f5) >>> 0;
            let t = Math.imul(s ^ (s >>> 15), s | 1);
            t = (t + Math.imul(t ^ (t >>> 7), t | 61)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    function build(): void {
        const r = rng(0x4e455855); // "NEXU"
        nodes = [];
        edges = [];
        const perSection = 150;
        const hubsPer = 8;
        // four section centres arranged around the origin in 3D
        const centers = [
            { x: -1.45, y: 0.2, z: 0.4 },
            { x: 1.45, y: 0.1, z: -0.4 },
            { x: -0.15, y: 1.25, z: -0.2 },
            { x: 0.2, y: -1.3, z: 0.25 },
        ];
        const gauss = () => (r() + r() + r() - 1.5) * 0.95; // ~normal, mean 0

        for (let s = 0; s < 4; s++) {
            const c = centers[s];
            const hue = HUES[s];
            const hubIdx: number[] = [];
            for (let h = 0; h < hubsPer; h++) {
                hubIdx.push(nodes.length);
                nodes.push({
                    x: c.x + gauss() * 0.38,
                    y: c.y + gauss() * 0.38,
                    z: c.z + gauss() * 0.38,
                    base: 3.0 + r() * 2.2,
                    hue,
                });
            }
            // interconnect the hubs into a spine
            for (let a = 0; a < hubsPer; a++) {
                for (let b = a + 1; b < hubsPer; b++) {
                    if (r() < 0.45) {
                        edges.push([hubIdx[a], hubIdx[b]]);
                    }
                }
            }
            // leaves scattered around a random hub, webbed to neighbours
            for (let i = 0; i < perSection; i++) {
                const hub = hubIdx[(r() * hubsPer) | 0];
                const idx = nodes.length;
                nodes.push({
                    x: nodes[hub].x + gauss() * 0.6,
                    y: nodes[hub].y + gauss() * 0.6,
                    z: nodes[hub].z + gauss() * 0.6,
                    base: 1.3 + r() * 1.7,
                    hue,
                });
                edges.push([idx, hub]);
                if (i > 3 && r() < 0.72) {
                    edges.push([idx, idx - 1 - ((r() * 3) | 0)]);
                }
            }
        }
        // a handful of cross-section bridges (interdisciplinary links)
        for (let k = 0; k < 14; k++) {
            edges.push([(r() * nodes.length) | 0, (r() * nodes.length) | 0]);
        }
    }

    function hexA(hex: string, a: number): string {
        const n = parseInt(hex.slice(1), 16);
        return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
    }

    function draw(t: number): void {
        const ctx = canvas.getContext("2d");
        if (!ctx) {
            return;
        }
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const w = canvas.clientWidth;
        const h = canvas.clientHeight;
        if (w === 0 || h === 0) {
            return;
        }
        if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
            canvas.width = w * dpr;
            canvas.height = h * dpr;
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);

        const yaw = reduced ? 0.45 : t * 0.00006; // slow ambient rotation
        const pitch = 0.34;
        const cy = Math.cos(yaw);
        const sy = Math.sin(yaw);
        const cp = Math.cos(pitch);
        const sp = Math.sin(pitch);
        const focal = 5.2;
        const scale = Math.min(w, h) * 0.32;
        const ox = w / 2;
        const oy = h / 2;

        const P = nodes.map((n) => {
            const x = n.x * cy - n.z * sy;
            let z = n.x * sy + n.z * cy;
            const y = n.y * cp - z * sp;
            z = n.y * sp + z * cp;
            const persp = focal / (focal - z);
            return {
                sx: ox + x * persp * scale,
                sy: oy + y * persp * scale,
                depth: persp,
                r: n.base * persp,
                hue: n.hue,
            };
        });

        // edges behind
        ctx.lineWidth = 1;
        for (const [a, b] of edges) {
            const pa = P[a];
            const pb = P[b];
            const d = (pa.depth + pb.depth) / 2;
            const alpha = Math.min(0.2, Math.max(0, (d - 0.62) * 0.26));
            if (alpha <= 0.012) {
                continue;
            }
            ctx.strokeStyle = hexA(pa.hue, alpha);
            ctx.beginPath();
            ctx.moveTo(pa.sx, pa.sy);
            ctx.lineTo(pb.sx, pb.sy);
            ctx.stroke();
        }

        // nodes, far-to-near
        const order = P.map((_, i) => i).sort((i, j) => P[i].depth - P[j].depth);
        for (const i of order) {
            const p = P[i];
            const a = Math.min(0.85, Math.max(0.05, (p.depth - 0.56) * 0.95));
            if (p.depth > 1.02) {
                ctx.beginPath();
                ctx.arc(p.sx, p.sy, p.r * 2.8, 0, TAU);
                ctx.fillStyle = hexA(p.hue, 0.05 * (p.depth - 1));
                ctx.fill();
            }
            ctx.beginPath();
            ctx.arc(p.sx, p.sy, Math.max(0.6, p.r), 0, TAU);
            ctx.fillStyle = hexA(p.hue, a);
            ctx.fill();
        }
    }

    function loop(t: number): void {
        draw(t);
        frame = requestAnimationFrame(loop);
    }

    onMount(() => {
        reduced =
            typeof window !== "undefined" &&
            window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        build();
        ro = new ResizeObserver(() => {
            if (reduced) {
                draw(0);
            }
        });
        ro.observe(canvas);
        if (reduced) {
            draw(0);
        } else {
            frame = requestAnimationFrame(loop);
        }
    });

    onDestroy(() => {
        if (frame) {
            cancelAnimationFrame(frame);
        }
        ro?.disconnect();
    });
</script>

<canvas bind:this={canvas} class="hero-graph"></canvas>

<style>
    .hero-graph {
        display: block;
        width: 100%;
        height: 100%;
    }
</style>
