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
            <div class="kg-switch">
                <button class:active={tab === "map"} on:click={() => (tab = "map")}>
                    Map
                </button>
                <button
                    class:active={tab === "scores"}
                    on:click={() => (tab = "scores")}
                >
                    Scores
                </button>
            </div>
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

    // A centered segmented control (pill switcher) — premium and quiet: the two read-only surfaces
    // share one soft track. Behavior is unchanged; only the chrome is refined.
    .kg-tabs {
        display: flex;
        justify-content: center;
        padding: 14px 18px;
        background: var(--canvas, #fbfbfd);
        border-bottom: 1px solid var(--border-subtle, rgba(27, 29, 42, 0.06));
    }

    .kg-switch {
        display: inline-flex;
        gap: 2px;
        padding: 3px;
        border-radius: 999px;
        background: rgba(27, 29, 42, 0.05);
        box-shadow: inset 0 0 0 1px rgba(27, 29, 42, 0.04);
    }

    .kg-tabs button {
        appearance: none;
        border: none;
        background: transparent;
        color: rgba(27, 29, 42, 0.55);
        font: inherit;
        font-size: 13.5px;
        font-weight: 550;
        padding: 7px 22px;
        border-radius: 999px;
        cursor: pointer;
        transition:
            color 0.15s ease,
            background 0.2s ease,
            box-shadow 0.2s ease;
    }

    .kg-tabs button:hover {
        color: rgba(27, 29, 42, 0.82);
    }

    // The active segment lifts onto a white thumb with a soft shadow — Linear/Arc restraint.
    .kg-tabs button.active {
        color: #1b1d2a;
        background: var(--canvas-elevated, #ffffff);
        box-shadow:
            0 1px 2px rgba(27, 29, 42, 0.08),
            0 2px 8px rgba(27, 29, 42, 0.06);
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
