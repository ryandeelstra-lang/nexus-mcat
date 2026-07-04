// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: ambient-weather live-verify (game/weather.ts) — rain streaks, snow flecks,
// and the snow frost vignette. The ambient spells sit minutes into the scene clock
// (rain at 70–120 s, snow at 190–240 s of a 240 s cycle), so waiting for them live would
// make the suite crawl; instead each case pins the layer's own intensity() seam to full
// strength (dev override, same spirit as the flagged dev teleports) and asserts what a
// player would see. The clear case proves everything melts away again.
import type { Page } from "@playwright/test";

import { expect, shot, test } from "./garden-helpers";

type Forced = "rain" | "snow" | "clear";

/** DEV OVERRIDE (verification-only): pin the ambient weather to one kind at full strength. */
async function forceWeather(page: Page, forced: Forced): Promise<void> {
    await page.evaluate((kind) => {
        const w = (globalThis as unknown as Record<string, any>).__gardenGame
            .scene.getScene("world");
        w.weather.intensity = (_t: number, wanted: string) => (wanted === kind ? 1 : 0);
    }, forced);
    await page.waitForTimeout(700); // a few ticks so visibility + drift settle
}

interface WeatherView {
    rainVisible: number;
    snowVisible: number;
    frostExists: boolean;
    frostVisible: boolean;
    frostAlpha: number;
    /** Frost display rect vs the camera's scrollFactor-0 visible window (zoom-corrected). */
    frostCoversViewport: boolean;
}

async function readWeather(page: Page): Promise<WeatherView> {
    return await page.evaluate(() => {
        const world = (globalThis as unknown as Record<string, any>).__gardenGame
            .scene.getScene("world");
        const w = world.weather;
        const frost = w.frost;
        let covers = false;
        if (frost) {
            // Camera zoom scales screen-space objects around the viewport center, so the
            // visible window for scrollFactor-0 content is a centered (w/zoom, h/zoom)
            // rect — the frost must be pinned exactly there or its edges render off-screen.
            const zoom = world.cameras.main.zoom || 1;
            const sw = world.scale.width;
            const sh = world.scale.height;
            const close = (a: number, b: number) => Math.abs(a - b) < 2;
            covers = close(frost.displayWidth, sw / zoom)
                && close(frost.displayHeight, sh / zoom)
                && close(frost.x, (sw - sw / zoom) / 2)
                && close(frost.y, (sh - sh / zoom) / 2);
        }
        return {
            rainVisible: w.rainDrops.filter((d: { visible: boolean }) => d.visible).length,
            snowVisible: w.snowFlecks.filter((f: { visible: boolean }) => f.visible).length,
            frostExists: Boolean(frost),
            frostVisible: frost?.visible ?? false,
            frostAlpha: frost?.alpha ?? 0,
            frostCoversViewport: covers,
        };
    });
}

test("rain: streaks fall, no frost on the glass", async ({ garden: page }) => {
    await forceWeather(page, "rain");
    const view = await readWeather(page);
    expect(view.rainVisible, "full-intensity rain shows the whole streak pool").toBeGreaterThan(50);
    expect(view.snowVisible).toBe(0);
    expect(view.frostVisible, "frost belongs to snow, not rain").toBe(false);
    await shot(page, "w1a-weather-rain");
});

test("snow: flecks drift and frost creeps in from the screen edges", async ({ garden: page }) => {
    await forceWeather(page, "snow");
    const view = await readWeather(page);
    expect(view.snowVisible, "full-intensity snow shows the whole fleck pool").toBeGreaterThan(40);
    expect(view.rainVisible).toBe(0);
    expect(view.frostExists, "the frost vignette was built (not reduced-motion)").toBe(true);
    expect(view.frostVisible).toBe(true);
    expect(view.frostAlpha, "frost alpha tracks snow intensity (0.9 at full)").toBeCloseTo(0.9, 1);
    expect(view.frostCoversViewport, "frost rect pinned to the zoom-visible window").toBe(true);
    await shot(page, "w1a-weather-snow-frost");
});

test("clear: weather and frost melt away entirely", async ({ garden: page }) => {
    await forceWeather(page, "clear");
    const view = await readWeather(page);
    expect(view.rainVisible).toBe(0);
    expect(view.snowVisible).toBe(0);
    expect(view.frostVisible).toBe(false);
    await shot(page, "w1a-weather-clear");
});
