<!--
Copyright: Ankitects Pty Ltd and contributors
License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html
-->
<!--
charged_up: Nexus — the app's front door (in-app landing/home). A calm near-white surface with the
living knowledge-graph as an ambient hero, the guarantee headline, and one clear way into the app.
Carries NO score / no fabricated readiness number (tier-1 honesty). Navigation is via pycmd -> the
`home_web` bridge in qt/aqt/main.py (_on_home_cmd).
-->
<script lang="ts">
    import Home from "./Home.svelte";
</script>

<Home />

<style>
    :global(html),
    :global(body) {
        margin: 0;
        height: 100%;
        background: var(--canvas, #fbfbfd);
    }
</style>
