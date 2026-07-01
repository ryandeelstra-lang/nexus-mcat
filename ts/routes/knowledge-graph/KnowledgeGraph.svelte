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
    import { type NodeState, renderGraph, type Sidecar } from "./graph-render";

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
                    };
                }
            }
            mastery = next;
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
                          sub:
                              info.unlocks > 0
                                  ? `${info.sectionLabel} · unlocks ${info.unlocks}`
                                  : info.sectionLabel,
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

    {#if !backdrop && crumb}
        <button class="kg-crumb" on:click={() => controller?.clearFocus()}>
            ← All sections ·
            <strong>{crumb.label}</strong>
        </button>
    {:else if !backdrop}
        <div class="kg-orbit-hint">drag to orbit · click a galaxy to zoom in</div>
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

    // Breadcrumb (zoom-out) chip — top-left, shown while a section galaxy is focused.
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
