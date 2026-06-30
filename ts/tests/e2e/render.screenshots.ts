// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up VISUAL ITERATION HARNESS (test-only — not a CI gate).
// Renders the knowledge-graph VIEW and the three-scores dashboard against a Vite dev server, with the
// engine's /_anki POST calls mocked at the network layer (no Rust/Qt, no open collection). Captures a
// PNG per visual state into out/screenshots/ so the UI can be judged + iterated on a real render.
//
// Run from the fork root (codebase/anki):
//   yarn playwright test -c playwright.screenshots.config.ts
// Do NOT export PLAYWRIGHT_BROWSERS_PATH — the default Chromium cache is already present.
//
// Named *.screenshots.ts (not *.spec/*.test) so the heavy default playwright.config.ts never runs it.

import { expect, type Page, type Route, test } from "@playwright/test";

import { dashLocked, dashSynthetic } from "./mocks/dashboard";
import { masteryPartial, masteryRich } from "./mocks/mastery";

const OUT = "out/screenshots";

interface Mocks {
    mastery?: Buffer | null; // null/undefined => masteryQuery fails => graph renders un-lit structure
    dashboard?: unknown | null; // null/undefined => scoresDashboard 503 => dashboard shows the notice
}

async function mockEngine(page: Page, mocks: Mocks): Promise<void> {
    await page.route("**/_anki/**", async (route: Route) => {
        const url = route.request().url();
        if (url.includes("/masteryQuery")) {
            if (!mocks.mastery) {
                return route.fulfill({ status: 500, body: "" });
            }
            return route.fulfill({
                status: 200,
                contentType: "application/binary",
                body: mocks.mastery,
            });
        }
        if (url.includes("/scoresDashboard")) {
            if (!mocks.dashboard) {
                return route.fulfill({ status: 503, body: "" });
            }
            return route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify(mocks.dashboard),
            });
        }
        // Any other engine call the shell makes on boot: answer empty so nothing errors on the proxy.
        return route.fulfill({ status: 200, contentType: "application/octet-stream", body: "" });
    });
}

test.describe("knowledge-graph VIEW", () => {
    test.use({ viewport: { width: 1240, height: 860 } });

    test("structure (un-lit)", async ({ page }) => {
        await mockEngine(page, { mastery: null });
        await page.goto("/knowledge-graph");
        await page.waitForSelector("svg.kg-svg circle");
        await page.waitForSelector(".kg-hint");
        await page.waitForTimeout(600);
        await page.screenshot({ path: `${OUT}/graph-structure.png` });
    });

    test("partially lit", async ({ page }) => {
        await mockEngine(page, { mastery: masteryPartial() });
        await page.goto("/knowledge-graph");
        await page.waitForSelector("svg.kg-svg circle");
        await page.waitForTimeout(800);
        await page.screenshot({ path: `${OUT}/graph-partial.png` });
    });

    test("richly lit + best-next", async ({ page }) => {
        await mockEngine(page, { mastery: masteryRich() });
        await page.goto("/knowledge-graph");
        await page.waitForSelector("svg.kg-svg circle");
        await page.waitForSelector(".kg-best-next");
        await page.waitForTimeout(800);
        await page.screenshot({ path: `${OUT}/graph-rich.png` });
    });
});

test.describe("three-scores dashboard", () => {
    test.use({ viewport: { width: 1240, height: 980 } });

    test("unavailable", async ({ page }) => {
        await mockEngine(page, { dashboard: null });
        await page.goto("/scores-dashboard");
        await page.waitForSelector(".notice");
        await page.waitForTimeout(400);
        await page.screenshot({ path: `${OUT}/dash-unavailable.png` });
    });

    test("memory + readiness locked", async ({ page }) => {
        await mockEngine(page, { dashboard: dashLocked });
        await page.goto("/scores-dashboard");
        await page.waitForSelector(".card");
        await page.waitForTimeout(500);
        await page.screenshot({ path: `${OUT}/dash-locked.png` });
    });

    test("synthetic caveat", async ({ page }) => {
        await mockEngine(page, { dashboard: dashSynthetic });
        await page.goto("/scores-dashboard");
        await page.waitForSelector(".caveat");
        await page.waitForTimeout(500);
        await page.screenshot({ path: `${OUT}/dash-synthetic.png` });
    });
});

// A trivial assertion keeps the file a valid test even if a screenshot step is skipped.
test("harness sanity", async ({ page }) => {
    await mockEngine(page, { mastery: masteryRich(), dashboard: dashLocked });
    const resp = await page.goto("/knowledge-graph");
    expect(resp?.status()).toBeLessThan(400);
});
