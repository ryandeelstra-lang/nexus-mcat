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

    let tab: "map" | "scores" = "map";
    // ssr is disabled for this app, so window is always available here. When the host loads the
    // route as "knowledge-graph?mode=backdrop", render only the calm static map (no tabs/chrome).
    const backdrop =
        typeof window !== "undefined" &&
        new URLSearchParams(window.location.search).get("mode") === "backdrop";
</script>

{#if backdrop}
    <KnowledgeGraph backdrop />
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
        background: #0c0e14;
    }

    .kg-page {
        display: flex;
        flex-direction: column;
        height: 100vh;
        font-family:
            Inter,
            -apple-system,
            "Segoe UI",
            Roboto,
            sans-serif;
    }

    .kg-tabs {
        display: flex;
        gap: 4px;
        padding: 10px 14px 0;
        background: #0c0e14;
    }

    .kg-tabs button {
        appearance: none;
        border: none;
        background: transparent;
        color: rgba(255, 255, 255, 0.5);
        font: inherit;
        font-size: 14px;
        padding: 8px 16px;
        border-radius: 8px 8px 0 0;
        cursor: pointer;
    }

    .kg-tabs button:hover {
        color: rgba(255, 255, 255, 0.8);
    }

    .kg-tabs button.active {
        color: #ffffff;
        background: rgba(255, 255, 255, 0.06);
    }

    .kg-body {
        flex: 1;
        min-height: 0;
        overflow: auto;
    }
</style>
