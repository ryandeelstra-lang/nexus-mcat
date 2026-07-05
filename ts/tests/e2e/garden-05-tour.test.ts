// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: the Garden Tour e2e (spec: docs/superpowers/specs/
// 2026-07-03-garden-tour-design.md). The Keeper's first-entry concept walkthrough must
// auto-play for a fresh gardener, land its science notes, pause-and-resume across a
// reboot, skip forever, and replay from the Help panel without un-finishing itself.
// Known coverage gap: the intro-cinematic -> tour handoff (introActive gate) is not
// drivable here — connectGarden's addInitScript pre-seeds the intro seen-key on EVERY
// navigation, so no fixture page can boot with the cinematic pending. That ordering is
// verified visually (live headed run) instead.
import type { Page } from "@playwright/test";

import { expect, gardenState, resetGarden, shot, test } from "./garden-helpers";

const TOUR = ".garden-tour";
const CHIP = `${TOUR} .tour-step-chip`;
const SCIENCE = `${TOUR} .tour-science`;

/**
 * Wait for the beat to fully land (science note appears when the crawl completes).
 * Deliberately no body-click here: clicking races the crawl's natural end — a late
 * click advances the beat instead of snapping it, which flakes the assertions.
 */
async function waitBeatLanded(page: Page): Promise<void> {
    await expect(page.locator(SCIENCE)).toBeVisible();
}

test("the tour auto-plays first entry, teaches the science, resumes, and skips forever", async ({ garden: page }) => {
    // A fresh gardener: tour unplayed. resetGarden reboots but never dismisses the tour.
    await resetGarden(page, { tour: { step: 0, done: false } });

    await expect(page.locator(TOUR)).toBeVisible();
    await expect(page.locator(CHIP)).toHaveText("This garden");
    await shot(page, "tour-0-first-beat");

    // Beat 0 lands its science note once the crawl completes.
    await waitBeatLanded(page);
    await expect(page.locator(SCIENCE)).toContainText(/graded practice/i);
    await shot(page, "tour-1-science-note");

    // Continue -> beat 1 names retrieval practice (the testing effect). Advance by
    // keyboard (the arrow coin's beckon animation never passes Playwright's stability
    // check — real clicks don't care, actionability checks do).
    await page.keyboard.press("Enter");
    await expect(page.locator(CHIP)).toHaveText("Answering");
    await waitBeatLanded(page);
    await expect(page.locator(SCIENCE)).toContainText(/testing effect/i);

    // Esc pauses; the cursor persisted (beat 1), done stays false...
    await page.keyboard.press("Escape");
    await expect(page.locator(TOUR)).not.toBeVisible();
    let doc = await gardenState(page, { op: "get" });
    expect(doc.tour).toEqual({ step: 1, done: false });

    // ...so a reboot resumes exactly where the Keeper left off.
    await resetGarden(page);
    await expect(page.locator(TOUR)).toBeVisible();
    await expect(page.locator(CHIP)).toHaveText("Answering");
    await shot(page, "tour-2-resumed");

    // Skip is forever: the sidecar records done, and the next boot stays tour-free.
    await page.locator(`${TOUR} .garden-tour-skip`).click();
    await expect(page.locator(TOUR)).not.toBeVisible();
    doc = await gardenState(page, { op: "get" });
    expect(doc.tour.done).toBe(true);

    await resetGarden(page);
    await expect(page.locator(".garden-hud")).toBeVisible();
    await expect(page.locator(TOUR)).toHaveCount(0);
});

test("the Help panel replays a finished tour without un-finishing it", async ({ garden: page }) => {
    await resetGarden(page, { tour: { step: 99, done: true } });
    await expect(page.locator(TOUR)).toHaveCount(0);

    // Help ("?") -> replay the tour from the top.
    await page.locator(".hud-top-right").getByRole("button", { name: "Help" }).click();
    await page.getByRole("button", { name: /Replay the garden tour/ }).click();
    await expect(page.locator(TOUR)).toBeVisible();
    await expect(page.locator(CHIP)).toHaveText("This garden");
    await shot(page, "tour-3-replay");

    // Advance a beat DURING the replay — this is the write path that could regress the
    // sidecar (GardenTour's persist guard) — then walk away. Nothing may change on disk.
    await waitBeatLanded(page);
    await page.keyboard.press("Enter");
    await expect(page.locator(CHIP)).toHaveText("Answering");
    await page.keyboard.press("Escape");
    await expect(page.locator(TOUR)).not.toBeVisible();
    const doc = await gardenState(page, { op: "get" });
    expect(doc.tour).toEqual({ step: 99, done: true });
});

test("finishing the last beat closes the tour and hands off to the garden for good", async ({ garden: page }) => {
    // Open the book on the final beat (a resumed cursor — also proves re-entrancy live).
    await resetGarden(page, { tour: { step: 10, done: false } });
    await expect(page.locator(TOUR)).toBeVisible();
    await expect(page.locator(CHIP)).toHaveText("The harvest");
    await waitBeatLanded(page);
    await shot(page, "tour-4-final-beat");

    // "Begin tending" completes the tour: overlay gone, terminal cursor persisted...
    await page.locator(`${TOUR} .tour-begin`).click();
    await expect(page.locator(TOUR)).not.toBeVisible();
    const doc = await gardenState(page, { op: "get" });
    expect(doc.tour.done).toBe(true);

    // ...and the next boot never shows it again.
    await resetGarden(page);
    await expect(page.locator(".garden-hud")).toBeVisible();
    await expect(page.locator(TOUR)).toHaveCount(0);
});
