<!--
Copyright: Ankitects Pty Ltd and contributors
License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html
-->
<!--
charged_up: the MCAT knowledge-graph VIEW. Structure is the bundled <100KB sidecar; the glow on each
leaf comes from a LIVE MasteryQuery RPC at mount (never a stored/fabricated number). If the RPC is
unavailable (no open collection), the map still renders as un-lit structure — honest, never blank.
-->
<script lang="ts">
    import { masteryQuery } from "@generated/backend";
    import { onDestroy, onMount } from "svelte";

    import sidecar from "$lib/graph-sidecar.json";

    import { computeBestNext } from "./best-next";
    import { createGraph3D, type Graph3D, type HoverInfo } from "./graph-3d";
    import {
        type NodeState,
        renderGraph,
        rollupMastery,
        type Sidecar,
    } from "./graph-render";

    // Backdrop mode: a calm, dim, static structure map rendered behind the study-flow screens.
    // No live RPC, no interaction, no chrome — just the spine setting the scene.
    export let backdrop = false;

    const graph = sidecar as Sidecar;
    // Only leaf nodes carry a deck path; build deck-path -> sidecar-node-id for RPC mapping.
    const pathToId = new Map<string, string>(
        graph.nodes.filter((n) => n.path).map((n) => [n.path as string, n.id]),
    );

    let svg: SVGElement | null = null;
    let mastery: Record<string, NodeState> = {};
    let bestNext: string | null = null;
    let status: "loading" | "live" | "structure" = "loading";

    // 3D engine + overlay state (interactive mode only).
    let controller: Graph3D | null = null;
    let tooltip: { title: string; sub: string; x: number; y: number } | null = null;
    let crumb: { id: string; label: string } | null = null;
    // Resolution: a calm degree-of-interest "detail" slider (0 = overview .. 1 = finest grain).
    let detail = 0.5;

    function onDetail(e: Event): void {
        detail = Number((e.currentTarget as HTMLInputElement).value);
        controller?.setDetail(detail);
    }

    async function loadMastery(): Promise<void> {
        try {
            const resp = await masteryQuery(
                { search: "", masteredRetrievabilityThreshold: 0.9 },
                { alertOnError: false },
            );
            const next: Record<string, NodeState> = {};
            for (const topic of resp.topics) {
                const id = pathToId.get(topic.deckName);
                if (id) {
                    next[id] = {
                        recall: topic.averageRecall,
                        hasState: topic.cardsWithState > 0,
                        cards: topic.cardsWithState,
                    };
                }
            }
            // Roll leaf state up into the section / foundational-concept galaxies (card-weighted, honest)
            // so the calm Overview altitude reads "where you are" at a glance.
            mastery = rollupMastery(graph, next);
            bestNext = computeBestNext(graph, mastery);
            status = "live";
        } catch {
            // Graceful: the backend isn't reachable (no open collection) — render the structure un-lit.
            status = "structure";
        }
    }

    onMount(() => {
        if (!svg) {
            return;
        }
        if (backdrop) {
            renderGraph(svg, graph, {}, null); // calm, dim, static structure behind the study flow
            return;
        }
        const c = createGraph3D(svg as SVGSVGElement, graph, {
            onHover: (info: HoverInfo | null, x: number, y: number) => {
                tooltip = info
                    ? {
                          title: info.label,
                          // Gaps read as "not yet" (Dweck) — never a red/failure state.
                          sub:
                              (info.unlocks > 0
                                  ? `${info.sectionLabel} · unlocks ${info.unlocks}`
                                  : info.sectionLabel) + (info.lit ? "" : " · not yet"),
                          x,
                          y,
                      }
                    : null;
            },
            onSectionFocus: (sec) => {
                crumb = sec;
            },
        });
        controller = c;
        c.setReducedMotion(
            typeof window !== "undefined" &&
                window.matchMedia("(prefers-reduced-motion: reduce)").matches,
        );
        c.setDetail(detail);
        loadMastery().then(() => c.setMastery(mastery, bestNext));
    });

    onDestroy(() => controller?.destroy());

    $: bestNextNode = bestNext ? graph.nodes.find((n) => n.id === bestNext) : undefined;

    // The launchpad → the card loop: one click drops into the study surface (cards are home).
    function startStudy(): void {
        if (typeof window !== "undefined") {
            window.location.search = "?mode=study";
        }
    }
</script>

<div class="kg-wrap" class:backdrop>
    <svg
        bind:this={svg}
        viewBox="0 0 1000 720"
        preserveAspectRatio="xMidYMid meet"
        class="kg-svg"
        role="img"
        aria-label="MCAT knowledge graph"
    ></svg>

    {#if !backdrop}
        <div class="kg-brand" aria-hidden="true">
            <span class="kg-brand-mark">Nexus</span>
            <span class="kg-brand-sub">the MCAT, mapped</span>
        </div>
    {/if}

    {#if !backdrop && crumb}
        <button class="kg-crumb" on:click={() => controller?.clearFocus()}>
            ← Overview ·
            <strong>{crumb.label}</strong>
        </button>
    {:else if !backdrop}
        <div class="kg-orbit-hint">drag to orbit · click to zoom in · click empty space to zoom out</div>
    {/if}

    {#if !backdrop}
        <div class="kg-detail" role="group" aria-label="Graph detail">
            <span class="kg-detail-end">Overview</span>
            <input
                class="kg-detail-range"
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={detail}
                on:input={onDetail}
                aria-label="Graph detail — from a calm overview to finer grain"
            />
            <span class="kg-detail-end">More detail</span>
        </div>
    {/if}

    {#if !backdrop && status === "structure"}
        <div class="kg-hint">
            Structure preview — open your MCAT deck to light the map.
        </div>
    {:else if !backdrop && status === "live"}
        <button class="kg-starthere" on:click={startStudy} title="Start studying">
            <span class="kg-dot"></span>
            {#if bestNextNode}
                Start here ·
                <strong>{bestNextNode.label}</strong>
            {:else}
                Start studying
            {/if}
        </button>
    {/if}

    {#if !backdrop && tooltip}
        <div class="kg-tooltip" style="left:{tooltip.x}px;top:{tooltip.y}px">
            <div class="kg-tt-title">{tooltip.title}</div>
            <div class="kg-tt-sub">{tooltip.sub}</div>
        </div>
    {/if}
</div>

<style lang="scss">
    .kg-wrap {
        position: relative;
        width: 100%;
        height: 100%;
        min-height: 480px;
        // The constellation floats on a clean near-white field (theme-correct via --canvas; falls back
        // to the locked #FBFBFD if the token is absent).
        background: var(--canvas, #fbfbfd);
    }

    // Backdrop mode: non-interactive (the deck/overview overlay in front controls the dim blend).
    .kg-wrap.backdrop {
        pointer-events: none;
        min-height: 100vh;
    }

    .kg-svg {
        display: block;
        width: 100%;
        height: 100%;
        cursor: grab;
        user-select: none;
        -webkit-user-select: none;
        touch-action: none;
    }
    .kg-svg:active {
        cursor: grabbing;
    }

    // Node interactions — circles are created in JS, so target them globally (within this wrap).
    :global(.kg-wrap .kg-node) {
        transition: transform 0.16s ease;
        transform-box: fill-box;
        transform-origin: center;
    }
    :global(.kg-wrap .kg-node.kg-hover) {
        transform: scale(1.45);
    }

    // Product wordmark — a quiet, premium top-center mark. The graph IS the product ("Nexus").
    .kg-brand {
        position: absolute;
        top: 14px;
        left: 50%;
        transform: translateX(-50%);
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 1px;
        pointer-events: none;
        user-select: none;
    }
    .kg-brand-mark {
        font-family: Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
        font-weight: 700;
        font-size: 17px;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: #1b1d2a;
    }
    .kg-brand-sub {
        font-family: Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
        font-size: 10.5px;
        letter-spacing: 0.06em;
        color: rgba(27, 29, 42, 0.42);
    }

    // Breadcrumb (zoom-out) chip — top-left, shown while a node is focused (drilled in).
    .kg-crumb {
        position: absolute;
        top: 16px;
        left: 16px;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 7px 14px;
        border: none;
        border-radius: 999px;
        font: inherit;
        font-size: 13px;
        color: rgba(27, 29, 42, 0.7);
        background: rgba(255, 255, 255, 0.86);
        box-shadow:
            0 1px 2px rgba(27, 29, 42, 0.06),
            0 8px 24px rgba(27, 29, 42, 0.1);
        backdrop-filter: blur(6px);
        -webkit-backdrop-filter: blur(6px);
        cursor: pointer;
    }
    .kg-crumb strong {
        color: #1b1d2a;
        font-weight: 600;
    }
    .kg-crumb:hover {
        color: #1b1d2a;
    }

    // Subtle orbit affordance — bottom-right.
    .kg-orbit-hint {
        position: absolute;
        right: 18px;
        bottom: 18px;
        font-size: 12px;
        color: rgba(27, 29, 42, 0.34);
        pointer-events: none;
    }

    // Resolution / "detail" slider — a calm frosted pill (top-right). Raising it reveals finer grain
    // (degree-of-interest semantic zoom); lowering it returns to the calm overview. Section-agnostic
    // neutral accent so it never implies one section's hue.
    .kg-detail {
        position: absolute;
        top: 16px;
        right: 16px;
        display: inline-flex;
        align-items: center;
        gap: 10px;
        padding: 8px 14px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.86);
        box-shadow:
            0 1px 2px rgba(27, 29, 42, 0.06),
            0 8px 24px rgba(27, 29, 42, 0.1);
        backdrop-filter: blur(6px);
        -webkit-backdrop-filter: blur(6px);
    }
    .kg-detail-end {
        font-size: 11px;
        letter-spacing: 0.02em;
        color: rgba(27, 29, 42, 0.5);
        user-select: none;
        white-space: nowrap;
    }
    .kg-detail-range {
        width: 132px;
        accent-color: rgba(27, 29, 42, 0.55);
        cursor: pointer;
    }

    // Hover tooltip — fixed to the cursor (clientX/clientY).
    .kg-tooltip {
        position: fixed;
        z-index: 20;
        transform: translate(14px, -120%);
        pointer-events: none;
        padding: 8px 12px;
        border-radius: 12px;
        background: rgba(255, 255, 255, 0.92);
        border: 1px solid rgba(27, 29, 42, 0.06);
        box-shadow:
            0 2px 6px rgba(27, 29, 42, 0.08),
            0 12px 32px rgba(27, 29, 42, 0.14);
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
        max-width: 280px;
    }
    .kg-tt-title {
        font-size: 13.5px;
        font-weight: 600;
        color: #1b1d2a;
        line-height: 1.3;
    }
    .kg-tt-sub {
        margin-top: 2px;
        font-size: 12px;
        color: rgba(27, 29, 42, 0.55);
    }

    .kg-hint,
    .kg-starthere {
        position: absolute;
        left: 50%;
        bottom: 18px;
        transform: translateX(-50%);
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 7px 16px;
        border-radius: 999px;
        font-size: 13px;
        font-family:
            Inter,
            system-ui,
            -apple-system,
            "Segoe UI",
            Roboto,
            sans-serif;
        // A frosted-glass pill on the white field: dark ink, soft two-layer shadow.
        color: rgba(27, 29, 42, 0.66);
        background: rgba(255, 255, 255, 0.82);
        box-shadow:
            0 1px 2px rgba(27, 29, 42, 0.06),
            0 8px 24px rgba(27, 29, 42, 0.08);
        backdrop-filter: blur(6px);
        -webkit-backdrop-filter: blur(6px);
    }

    // .kg-starthere is a button (the launchpad → study) — reset native chrome, keep the frosted pill.
    .kg-starthere {
        appearance: none;
        font: inherit;
        font-size: 13px;
        cursor: pointer;
        transition:
            transform 0.12s ease,
            box-shadow 0.12s ease;
    }
    .kg-starthere:hover {
        transform: translateX(-50%) translateY(-1px);
        box-shadow:
            0 2px 4px rgba(27, 29, 42, 0.08),
            0 12px 32px rgba(27, 29, 42, 0.12);
    }

    .kg-starthere strong {
        color: #1b1d2a;
        font-weight: 600;
    }

    .kg-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        // Calm amber "start here" accent (warm, not an alarm), with a soft halo.
        background: #f59e0b;
        box-shadow: 0 0 8px 2px rgba(245, 158, 11, 0.45);
        animation: kg-pulse-dot 2.4s ease-in-out infinite;
    }

    @keyframes kg-pulse-dot {
        0%,
        100% {
            opacity: 0.45;
        }
        50% {
            opacity: 1;
        }
    }

    // The best-next node breathes — a calm "start here", never an alarm.
    :global(.kg-best-next) {
        animation: kg-pulse 2.4s ease-in-out infinite;
    }

    @keyframes kg-pulse {
        0%,
        100% {
            stroke-opacity: 0.55;
        }
        50% {
            stroke-opacity: 1;
        }
    }

    @media (prefers-reduced-motion: reduce) {
        .kg-dot,
        :global(.kg-best-next) {
            animation: none;
        }
    }
</style>
