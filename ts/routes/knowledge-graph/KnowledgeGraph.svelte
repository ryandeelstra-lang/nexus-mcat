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
    import { onMount } from "svelte";

    import sidecar from "$lib/graph-sidecar.json";

    import { computeBestNext } from "./best-next";
    import { type NodeState, renderGraph, type Sidecar } from "./graph-render";

    const graph = sidecar as Sidecar;
    // Only leaf nodes carry a deck path; build deck-path -> sidecar-node-id for RPC mapping.
    const pathToId = new Map<string, string>(
        graph.nodes.filter((n) => n.path).map((n) => [n.path as string, n.id]),
    );

    let svg: SVGElement | null = null;
    let mastery: Record<string, NodeState> = {};
    let bestNext: string | null = null;
    let status: "loading" | "live" | "structure" = "loading";

    onMount(async () => {
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
    });

    // Re-render whenever the svg mounts or the live mastery/best-next arrives.
    $: if (svg) {
        renderGraph(svg, graph, mastery, bestNext);
    }

    $: bestNextNode = bestNext ? graph.nodes.find((n) => n.id === bestNext) : undefined;
</script>

<div class="kg-wrap">
    <svg
        bind:this={svg}
        viewBox="0 0 1000 720"
        preserveAspectRatio="xMidYMid meet"
        class="kg-svg"
        role="img"
        aria-label="MCAT knowledge graph"
    ></svg>
    {#if status === "structure"}
        <div class="kg-hint">
            Structure preview — open your MCAT deck to light the map.
        </div>
    {:else if status === "live" && bestNextNode}
        <div class="kg-starthere">
            <span class="kg-dot"></span>
            Start here ·
            <strong>{bestNextNode.label}</strong>
        </div>
    {/if}
</div>

<style lang="scss">
    .kg-wrap {
        position: relative;
        width: 100%;
        height: 100%;
        min-height: 480px;
        background: radial-gradient(circle at 50% 42%, #161a23 0%, #0c0e14 70%);
    }

    .kg-svg {
        display: block;
        width: 100%;
        height: 100%;
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
        padding: 6px 14px;
        border-radius: 999px;
        font-size: 13px;
        font-family:
            Inter,
            -apple-system,
            "Segoe UI",
            Roboto,
            sans-serif;
        color: rgba(255, 255, 255, 0.7);
        background: rgba(255, 255, 255, 0.06);
    }

    .kg-starthere strong {
        color: rgba(255, 255, 255, 0.95);
        font-weight: 600;
    }

    .kg-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #ffffff;
        box-shadow: 0 0 8px 2px rgba(255, 255, 255, 0.7);
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
</style>
