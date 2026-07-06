// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up W1a: doc 26 G2 gate — the §9.5 six-state sky, live at mocked clock times.
// The wall clock is frozen via a Date shim (garden-helpers installClockShim) and the page
// rebooted, so setupSky() computes the phase exactly as a player's machine would at that
// time. Expected tint/alpha come from the SAME pure module the world uses (daynight.ts),
// asserted against the LIVE skyOverlay + lanterns + HUD dial. Vitest already pins the
// phase mapping (game/daynight.test.ts); this proves the world applies it.
import { skyStateFor } from "../../routes/garden/game/daynight";

import { expect, resetGarden, setFixedTime, shot, test, waitForBoot } from "./garden-helpers";

const CASES = [
    { name: "night", time: "2026-07-02T04:30:00", phase: "night", dial: "moon", screenshot: true },
    { name: "sunrise", time: "2026-07-02T08:10:00", phase: "sunrise", dial: "sun", screenshot: false },
    { name: "morning", time: "2026-07-02T13:00:00", phase: "morning", dial: "sun", screenshot: false },
    { name: "peak", time: "2026-07-02T18:00:00", phase: "peak", dial: "sun", screenshot: true },
    { name: "evening", time: "2026-07-02T23:00:00", phase: "evening", dial: "sun", screenshot: false },
    { name: "dusk", time: "2026-07-02T03:30:00", phase: "dusk", dial: "sun", screenshot: true },
] as const;

for (const c of CASES) {
    test(`the sky is "${c.phase}" at ${c.time.slice(11, 16)} (mocked clock)`, async ({ garden: page }) => {
        const when = new Date(c.time);
        const expected = skyStateFor(when);
        expect(expected.phase, "test-data sanity against the pure module").toBe(c.phase);

        await resetGarden(page, {}, when);

        // The LIVE world computed and applied the §9.5 sky at boot.
        const sky = await page.evaluate(() => {
            const w = (globalThis as unknown as Record<string, any>).__gardenGame
                .scene.getScene("world");
            return {
                tint: w.skyOverlay.fillColor,
                alpha: w.skyOverlay.fillAlpha,
                isNight: w.isNight,
                lanternCount: w.lanternGlows.length,
                lanternsOn: w.lanternGlows.every((g: { visible: boolean }) => g.visible),
                keeperLantern: w.keeperLantern.visible,
            };
        });
        expect(sky.tint).toBe(expected.tint);
        expect(sky.alpha).toBeCloseTo(expected.ambientAlpha, 3);

        // Night behaviors: lanterns light up when dark (setupSky's isNight branch).
        const dark = c.phase === "night" || c.phase === "dusk";
        expect(sky.isNight).toBe(dark);
        expect(sky.lanternCount).toBeGreaterThan(0);
        expect(sky.lanternsOn).toBe(dark);
        expect(sky.keeperLantern).toBe(dark || c.phase === "evening");

        // The DOM HUD dial agrees (moon only inside the 4–8 AM night window).
        await expect(page.locator(c.dial === "moon" ? ".hud-dial-moon" : ".hud-dial-sun"))
            .toBeAttached();

        if (c.screenshot) {
            await page.waitForTimeout(800); // let the tint settle for the visual record
            await shot(page, `w1a-daynight-${c.name}`);
        }
    });
}

test("restore the real clock", async ({ garden: page }) => {
    await setFixedTime(page, null);
    await page.reload({ waitUntil: "domcontentloaded" });
    await waitForBoot(page);
    const now = await page.evaluate(() => Date.now());
    expect(Math.abs(now - Date.now())).toBeLessThan(60_000);
});
