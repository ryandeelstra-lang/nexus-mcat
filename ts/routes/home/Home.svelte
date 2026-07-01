<!--
Copyright: Ankitects Pty Ltd and contributors
License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html
-->
<script lang="ts">
    import { onMount } from "svelte";

    // Dense, ambient "living knowledge graph" hero (decorative, no data/RPC — see HeroGraph.svelte).
    import HeroGraph from "./HeroGraph.svelte";

    let mounted = false;
    onMount(() => {
        mounted = true;
    });

    function go(cmd: string): void {
        // JS -> Python bridge; handled by home_web.set_bridge_command(_on_home_cmd) in qt/aqt/main.py
        (globalThis as unknown as { pycmd?: (c: string) => void }).pycmd?.(cmd);
    }
</script>

<main class="nexus" class:ready={mounted}>
    <div class="graph-layer" aria-hidden="true">
        <HeroGraph />
    </div>
    <div class="scrim" aria-hidden="true"></div>

    <header class="brand">Nexus</header>

    <section class="hero">
        <h1>Perfect MCAT score<br />guaranteed</h1>
        <p class="sub">Backed by Alpha School</p>

        <div class="cta-row">
            <button class="cta primary" on:click={() => go("home:study")}>
                Start studying
            </button>
            <button class="cta ghost" on:click={() => go("home:map")}>
                Explore your map <span class="arrow">→</span>
            </button>
        </div>
    </section>

    <footer class="utility">
        <button on:click={() => go("home:scores")}>Scores</button>
        <span class="dot">·</span>
        <button on:click={() => go("home:browse")}>Browse</button>
        <span class="dot">·</span>
        <button on:click={() => go("home:add")}>Add</button>
        <span class="dot">·</span>
        <button on:click={() => go("home:sync")}>Sync</button>
    </footer>
</main>

<style>
    .nexus {
        position: relative;
        width: 100vw;
        height: 100vh;
        overflow: hidden;
        background: #fbfbfd;
        color: #1b1d2a;
        font-family: Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
    }

    /* the reused KnowledgeGraph (backdrop mode) fills this layer, behind everything */
    .graph-layer {
        position: absolute;
        inset: 0;
        z-index: 0;
        pointer-events: none;
    }
    .graph-layer :global(canvas) {
        width: 100%;
        height: 100%;
    }

    /* soft white scrim so the copy is legible while the graph glows through at the edges */
    .scrim {
        position: absolute;
        inset: 0;
        z-index: 1;
        pointer-events: none;
        background: radial-gradient(
            62% 56% at 50% 42%,
            rgba(251, 251, 253, 0.88) 0%,
            rgba(251, 251, 253, 0.64) 46%,
            rgba(251, 251, 253, 0.26) 100%
        );
    }

    .brand {
        position: absolute;
        top: 28px;
        left: 34px;
        z-index: 3;
        font-weight: 600;
        font-size: 19px;
        letter-spacing: 0.18em;
        text-transform: uppercase;
        opacity: 0.9;
    }

    .hero {
        position: relative;
        z-index: 3;
        text-align: center;
        transform: translateY(10px);
        opacity: 0;
        transition:
            opacity 0.9s ease,
            transform 0.9s ease;
    }
    .nexus.ready .hero {
        opacity: 1;
        transform: translateY(0);
    }

    h1 {
        margin: 0;
        font-weight: 600;
        font-size: clamp(38px, 6vw, 76px);
        line-height: 1.04;
        letter-spacing: -0.022em;
    }

    .sub {
        margin: 20px 0 0;
        font-size: clamp(15px, 1.4vw, 19px);
        font-weight: 400;
        letter-spacing: 0.05em;
        color: #565a6e;
    }

    .cta-row {
        margin-top: 44px;
        display: flex;
        gap: 16px;
        align-items: center;
        justify-content: center;
        flex-wrap: wrap;
    }

    .cta {
        font-family: inherit;
        font-size: 16px;
        font-weight: 500;
        border-radius: 12px;
        padding: 14px 26px;
        cursor: pointer;
        border: 1px solid transparent;
        transition:
            transform 0.15s ease,
            box-shadow 0.2s ease,
            background 0.2s ease,
            border-color 0.2s ease;
    }
    .cta:hover {
        transform: translateY(-1px);
    }
    .cta.primary {
        background: #3b82f6;
        color: #fff;
        box-shadow: 0 6px 20px rgba(59, 130, 246, 0.28);
    }
    .cta.primary:hover {
        background: #2f74e8;
        box-shadow: 0 10px 28px rgba(59, 130, 246, 0.34);
    }
    .cta.ghost {
        background: rgba(255, 255, 255, 0.72);
        border-color: rgba(27, 29, 42, 0.14);
        color: #1b1d2a;
    }
    .cta.ghost:hover {
        border-color: rgba(27, 29, 42, 0.3);
    }
    .arrow {
        opacity: 0.7;
    }

    .utility {
        position: absolute;
        bottom: 30px;
        z-index: 3;
        display: flex;
        gap: 12px;
        align-items: center;
        font-size: 14px;
        color: #565a6e;
    }
    .utility button {
        background: none;
        border: none;
        font-family: inherit;
        font-size: 14px;
        color: #565a6e;
        cursor: pointer;
        padding: 4px 2px;
        transition: color 0.15s ease;
    }
    .utility button:hover {
        color: #1b1d2a;
    }
    .dot {
        opacity: 0.4;
    }

    @media (prefers-reduced-motion: reduce) {
        .hero {
            transition: none;
            opacity: 1;
            transform: none;
        }
        .cta:hover {
            transform: none;
        }
    }
</style>
