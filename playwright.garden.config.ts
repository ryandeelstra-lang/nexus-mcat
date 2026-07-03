// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up W1a: the garden live-verification harness. Unlike the default
// playwright.config.ts (which owns a throwaway offscreen Anki via webServer), this config
// attaches to an already-running app instance — the SAME live engine + profile the
// QtWebEngine spot-checks (scripts/ui_shot.js, scripts/cdp_eval.mjs) inspect — so specs
// can assert game-visible effects AND engine-side truth on one instance.
//
// Run:
//   out/pyenv/bin/python ts/tests/e2e/launch-garden-app.py    # once, keeps running
//   PLAYWRIGHT_BROWSERS_PATH=out/playwright-browsers \
//     ./yarn playwright test --config playwright.garden.config.ts [file]
//
// Specs SKIP (never fail) when the instance is down, so running them by accident under
// a harness without the live app stays green.
import { defineConfig } from "@playwright/test";

const GARDEN_API_PORT = process.env.GARDEN_API_PORT ?? "40001";

export default defineConfig({
    testDir: "./ts/tests/e2e",
    testMatch: /garden-\d+.*\.test\.ts/,
    outputDir: "./out/e2e-garden-report/",
    fullyParallel: false,
    workers: 1,
    timeout: 180_000,
    forbidOnly: !!process.env.CI,
    retries: 0,
    reporter: "list",
    // The live app pays real costs (deck scoping RPCs, Phaser boots) — default expect
    // timeouts sized for a mocked page are too tight here.
    expect: { timeout: 20_000 },
    use: {
        baseURL: `http://127.0.0.1:${GARDEN_API_PORT}`,
        trace: "retain-on-failure",
        screenshot: "only-on-failure",
    },
});
