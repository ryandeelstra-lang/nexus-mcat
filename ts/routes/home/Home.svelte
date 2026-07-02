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
        <h1>
            Perfect MCAT score
            <br />
            guaranteed
        </h1>
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
        font-family:
            Inter,
            system-ui,
            -apple-system,
            "Segoe UI",
            Roboto,
            sans-serif;
        font-optical-sizing: auto;
        font-feature-settings:
            "liga" 1,
            "calt" 1;
        -webkit-font-smoothing: antialiased;
        -moz-osx-font-smoothing: grayscale;
        text-rendering: optimizeLegibility;
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

    /* a bright legibility pocket under the copy; the sides stay open so the graph
       glows through, with a whisper of top/bottom seating for the brand + footer
       and a faint cool vignette in the far corners for depth */
    .scrim {
        position: absolute;
        inset: 0;
        z-index: 1;
        pointer-events: none;
        background:
            radial-gradient(
                58% 52% at 50% 43%,
                rgba(251, 251, 253, 0.9) 0%,
                rgba(251, 251, 253, 0.66) 48%,
                rgba(251, 251, 253, 0.12) 100%
            ),
            linear-gradient(
                to bottom,
                rgba(251, 251, 253, 0.55) 0%,
                rgba(251, 251, 253, 0) 15%,
                rgba(251, 251, 253, 0) 85%,
                rgba(251, 251, 253, 0.5) 100%
            ),
            radial-gradient(
                125% 125% at 50% 50%,
                rgba(27, 29, 42, 0) 68%,
                rgba(27, 29, 42, 0.035) 100%
            );
    }

    /* shared entrance: a gentle, staggered fade-up (delays + .ready below) */
    .brand,
    .hero h1,
    .sub,
    .cta-row,
    .utility {
        opacity: 0;
        transform: translateY(14px);
        transition:
            opacity 0.85s cubic-bezier(0.16, 1, 0.3, 1),
            transform 0.85s cubic-bezier(0.16, 1, 0.3, 1);
    }
    .nexus.ready .brand,
    .nexus.ready .hero h1,
    .nexus.ready .sub,
    .nexus.ready .cta-row,
    .nexus.ready .utility {
        opacity: 1;
        transform: translateY(0);
    }
    .nexus.ready .brand {
        transition-delay: 0.05s;
    }
    .nexus.ready .hero h1 {
        transition-delay: 0.14s;
    }
    .nexus.ready .sub {
        transition-delay: 0.26s;
    }
    .nexus.ready .cta-row {
        transition-delay: 0.38s;
    }
    .nexus.ready .utility {
        transition-delay: 0.52s;
    }

    .brand {
        position: absolute;
        top: 30px;
        left: 36px;
        z-index: 3;
        font-weight: 600;
        font-size: 18px;
        letter-spacing: 0.2em;
        text-transform: uppercase;
        color: #1b1d2a;
    }

    .hero {
        position: relative;
        z-index: 3;
        text-align: center;
        padding: 0 24px;
    }

    h1 {
        margin: 0;
        font-weight: 600;
        font-size: clamp(40px, 6.2vw, 82px);
        line-height: 1.02;
        letter-spacing: -0.03em;
        text-wrap: balance;
        background: linear-gradient(180deg, #1b1d2a 0%, #3a3e55 100%);
        -webkit-background-clip: text;
        background-clip: text;
        color: transparent;
        -webkit-text-fill-color: transparent;
    }

    .sub {
        margin: 22px 0 0;
        font-size: clamp(15px, 1.4vw, 19px);
        font-weight: 400;
        letter-spacing: 0.04em;
        color: #565a6e;
    }

    .cta-row {
        margin-top: 46px;
        display: flex;
        gap: 14px;
        align-items: center;
        justify-content: center;
        flex-wrap: wrap;
    }

    .cta {
        position: relative;
        font-family: inherit;
        font-size: 16px;
        font-weight: 500;
        letter-spacing: -0.01em;
        border-radius: 13px;
        padding: 14px 28px;
        cursor: pointer;
        border: 1px solid transparent;
        transition:
            transform 0.18s cubic-bezier(0.16, 1, 0.3, 1),
            box-shadow 0.22s ease,
            background 0.22s ease,
            border-color 0.22s ease;
    }

    .cta.primary {
        color: #fff;
        background: linear-gradient(180deg, #4c8df7 0%, #3b82f6 100%);
        box-shadow:
            0 1px 2px rgba(27, 29, 42, 0.14),
            0 10px 26px -8px rgba(59, 130, 246, 0.55),
            inset 0 1px 0 rgba(255, 255, 255, 0.28);
    }
    .cta.primary:hover {
        transform: translateY(-1px);
        background: linear-gradient(180deg, #5a95f8 0%, #3f86f7 100%);
        box-shadow:
            0 2px 4px rgba(27, 29, 42, 0.16),
            0 16px 34px -8px rgba(59, 130, 246, 0.62),
            inset 0 1px 0 rgba(255, 255, 255, 0.32);
    }
    .cta.primary:active {
        transform: translateY(0);
        box-shadow:
            0 1px 2px rgba(27, 29, 42, 0.16),
            0 6px 16px -8px rgba(59, 130, 246, 0.5),
            inset 0 1px 0 rgba(255, 255, 255, 0.2);
    }
    .cta.primary:focus-visible {
        outline: none;
        box-shadow:
            0 1px 2px rgba(27, 29, 42, 0.14),
            0 12px 30px -8px rgba(59, 130, 246, 0.6),
            inset 0 1px 0 rgba(255, 255, 255, 0.3),
            0 0 0 4px rgba(59, 130, 246, 0.3);
    }

    .cta.ghost {
        color: #1b1d2a;
        background: rgba(255, 255, 255, 0.6);
        border-color: rgba(27, 29, 42, 0.12);
        backdrop-filter: blur(10px) saturate(1.1);
        -webkit-backdrop-filter: blur(10px) saturate(1.1);
        box-shadow: 0 1px 2px rgba(27, 29, 42, 0.05);
    }
    .cta.ghost:hover {
        transform: translateY(-1px);
        background: rgba(255, 255, 255, 0.78);
        border-color: rgba(27, 29, 42, 0.24);
        box-shadow: 0 6px 18px -8px rgba(27, 29, 42, 0.22);
    }
    .cta.ghost:active {
        transform: translateY(0);
    }
    .cta.ghost:focus-visible {
        outline: none;
        border-color: rgba(59, 130, 246, 0.5);
        box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.22);
    }
    .arrow {
        display: inline-block;
        opacity: 0.65;
        transition: transform 0.18s cubic-bezier(0.16, 1, 0.3, 1);
    }
    .cta.ghost:hover .arrow {
        transform: translateX(3px);
        opacity: 0.9;
    }

    .utility {
        position: absolute;
        bottom: 28px;
        z-index: 3;
        display: flex;
        gap: 4px;
        align-items: center;
        font-size: 13.5px;
        color: #565a6e;
    }
    .utility button {
        background: none;
        border: none;
        font-family: inherit;
        font-size: 13.5px;
        letter-spacing: 0.01em;
        color: #565a6e;
        cursor: pointer;
        padding: 5px 10px;
        border-radius: 8px;
        transition:
            color 0.16s ease,
            background 0.16s ease;
    }
    .utility button:hover {
        color: #1b1d2a;
        background: rgba(27, 29, 42, 0.05);
    }
    .utility button:focus-visible {
        outline: none;
        color: #1b1d2a;
        box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.25);
    }
    .dot {
        opacity: 0.35;
        user-select: none;
    }

    @media (prefers-reduced-motion: reduce) {
        .brand,
        .hero h1,
        .sub,
        .cta-row,
        .utility {
            transition: none;
            opacity: 1;
            transform: none;
        }
        .cta:hover,
        .cta:active {
            transform: none;
        }
        .arrow,
        .cta.ghost:hover .arrow {
            transition: none;
            transform: none;
        }
    }
</style>
