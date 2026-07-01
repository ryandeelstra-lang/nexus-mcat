<!--
Copyright: Ankitects Pty Ltd and contributors
License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html
-->
<!--
charged_up: the knowledge-graph dialog hosts two read-only surfaces behind a calm tab bar — the
graph (the launchpad/check-in centerpiece) and the three honest scores. Both are read-only views
of the already-built engine; neither writes to the collection.
-->
<script lang="ts">
    import ScoresDashboard from "../scores-dashboard/ScoresDashboard.svelte";
    import KnowledgeGraph from "./KnowledgeGraph.svelte";
    import StudyCard from "./StudyCard.svelte";

    // ssr is disabled for this app, so window is always available here. The host loads the route in
    // one of three modes via ?mode=: "backdrop" (calm static map behind the deck/overview screens),
    // "study" (the card loop floating in front of the dim map — cards are home), or none (the full
    // explorable graph + scores). ?tab=scores opens directly on the Scores tab (from home:scores).
    const params =
        typeof window !== "undefined"
            ? new URLSearchParams(window.location.search)
            : null;
    const mode = params?.get("mode") ?? null;
    const backdrop = mode === "backdrop";
    const study = mode === "study";
    let tab: "map" | "scores" = params?.get("tab") === "scores" ? "scores" : "map";
</script>

{#if backdrop}
    <KnowledgeGraph backdrop />
{:else if study}
    <div class="kg-study">
        <div class="kg-study-bg">
            <KnowledgeGraph backdrop />
        </div>
        <StudyCard />
    </div>
{:else}
    <div class="kg-page">
        <nav class="kg-tabs">
            <button class:active={tab === "map"} on:click={() => (tab = "map")}>
                Map
            </button>
            <button class:active={tab === "scores"} on:click={() => (tab = "scores")}>
                Scores
            </button>
        </nav>
        <div class="kg-body">
            {#if tab === "map"}
                <KnowledgeGraph />
            {:else}
                <ScoresDashboard />
            {/if}
        </div>
    </div>
{/if}

<style lang="scss">
    :global(html),
    :global(body) {
        margin: 0;
        height: 100%;
        background: var(--canvas, #fbfbfd);
    }

    .kg-page {
        display: flex;
        flex-direction: column;
        height: 100vh;
        font-family:
            Inter,
            system-ui,
            -apple-system,
            "Segoe UI",
            Roboto,
            sans-serif;
    }

    .kg-tabs {
        display: flex;
        gap: 6px;
        padding: 12px 18px 0;
        background: var(--canvas, #fbfbfd);
        border-bottom: 1px solid var(--border-subtle, rgba(27, 29, 42, 0.08));
    }

    .kg-tabs button {
        appearance: none;
        border: none;
        background: transparent;
        color: rgba(27, 29, 42, 0.5);
        font: inherit;
        font-size: 14px;
        font-weight: 550;
        padding: 9px 18px;
        border-radius: 10px 10px 0 0;
        cursor: pointer;
        transition:
            color 0.15s ease,
            background 0.15s ease;
    }

    .kg-tabs button:hover {
        color: rgba(27, 29, 42, 0.82);
    }

    // The active tab reads as a white "raised card tab" on the near-white field — Linear/Arc restraint.
    .kg-tabs button.active {
        color: #1b1d2a;
        background: var(--canvas-elevated, #ffffff);
        box-shadow:
            0 -1px 0 var(--border-subtle, rgba(27, 29, 42, 0.08)),
            -1px 0 0 var(--border-subtle, rgba(27, 29, 42, 0.08)),
            1px 0 0 var(--border-subtle, rgba(27, 29, 42, 0.08));
    }

    .kg-body {
        flex: 1;
        min-height: 0;
        overflow: auto;
    }

    // Study mode: the dim map fills the screen; the card surface floats in front of it.
    .kg-study {
        position: relative;
        height: 100vh;
        overflow: hidden;
    }
    .kg-study-bg {
        position: absolute;
        inset: 0;
    }
</style>
