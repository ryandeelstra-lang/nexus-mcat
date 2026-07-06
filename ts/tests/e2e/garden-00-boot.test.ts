// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up W1a: harness smoke — the seeded garden boots on the REAL engine.
// Re-run safe: asserts self-consistency (HUD ⇔ persisted economy), never absolute balances.
import { emitBus, expect, gardenState, hudWater, shot, test, waitForBoot } from "./garden-helpers";

test("the garden boots into a seeded world (34 topics, 34 plants, 27 gate edges, live HUD)", async ({ garden: page }) => {
    await waitForBoot(page);

    // The Phaser canvas and the DOM HUD are both live.
    await expect(page.locator(".garden-canvas canvas")).toBeVisible();
    await expect(page.locator(".garden-hud")).toBeVisible();

    // HUD chip matches the persisted economy doc exactly (self-consistent ⇒ re-run safe).
    const state = await gardenState(page, { op: "get" });
    expect(await hudWater(page)).toBe(state.economy?.water ?? 20);
    // Seeds are gone (2026-07-03): water is the only currency chip.
    expect(await page.locator(".garden-hud .hud-top-left .hud-chip").count()).toBe(1);

    // The starter deck reached the engine AND the world: every leaf topic exists.
    const world = await page.evaluate(() => {
        const game = (globalThis as unknown as Record<string, any>).__gardenGame;
        const scene = game.scene.getScene("world");
        return {
            plants: scene.plants.size,
            gates: scene.plan.gates.length,
            regions: scene.plan.regions.map((r: { section: string }) => r.section).sort(),
            topics: game.registry.get("masterySnapshot").topics.length,
        };
    });
    expect(world.plants).toBe(34);
    expect(world.gates).toBe(27); // prereq edges are data-only since 2026-07-03
    expect(world.topics).toBe(34); // 0 here means the seeded collection did NOT load
    expect(world.regions).toEqual(["B-B", "C-P", "CARS", "P-S"]);

    await shot(page, "w1a-boot");
});

test("the Keeper fresh-assigns instead of 'come back later' (SPOV1 guard)", async ({ garden: page }) => {
    await waitForBoot(page);

    await emitBus(page, "keeper:interact", {});
    const panel = page.locator(".keeper-panel-shell");
    await expect(panel).toBeVisible();
    // Seeded collection ⇒ an assignment must be served — never "come back later".
    await expect(panel).not.toContainText("Nothing is queued");
    await expect(page.locator(".keeper-panel .keeper-card-frame")).toBeVisible({
        timeout: 45_000, // deck scoping + queue fetch are real engine round-trips
    });
    await expect(page.locator(".keeper-context")).toContainText("Tending:");
    await shot(page, "w1a-keeper-serves");
    await page.locator(".keeper-panel .keeper-close").click();
    await expect(panel).not.toBeVisible();
});
