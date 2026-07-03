// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

<script lang="ts">
    // charged_up: the Knowledge Garden surface (Decisions 40-42). This page is a THIN serving
    // shell only — the entire app inside is React + Phaser (see ./mount.tsx). SvelteKit is the
    // vehicle (route discovery, mediasrv serving, the generated RPC client); the garden itself
    // is framework-React per Decision 41.
    import { onMount } from "svelte";

    let host: HTMLDivElement;

    onMount(() => {
        let dispose: (() => void) | undefined;
        let cancelled = false;
        // Client-only dynamic import: Phaser/React must never run during any prerender pass,
        // and the chunk stays off every other page's critical path (G0.5 bundle discipline).
        void import("./mount").then((m) => {
            if (cancelled) {
                return;
            }
            dispose = m.mountGarden(host);
        });
        return () => {
            cancelled = true;
            dispose?.();
        };
    });
</script>

<div bind:this={host} class="garden-host"></div>

<style>
    .garden-host {
        position: fixed;
        inset: 0;
        overflow: hidden;
        background: #1a2b1e; /* deep garden green while the world boots */
    }
</style>
