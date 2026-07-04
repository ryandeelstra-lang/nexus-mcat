// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: the 2026-07-03 progression rework — sector locks are GONE. Every quadrant
// is open from the first step: no mist veil, no trial gate, free fast travel. Each
// quadrant instead carries one standing stone at its heart; interacting with it (the
// real proximity + E path) blesses the garden with a brief screen-space rain shower
// (game/weather.ts). This proves, live: open borders, free travel, the centered stone,
// and the rain answering the interact.
import { avatarTile, emitBus, expect, keyHold, resetGarden, shot, teleportTo, test } from "./garden-helpers";

test("quadrants are open; the center stone answers interact with a rain shower (P-S / Sakura)", async ({ garden: page }) => {
    // Even with NO unlocks seeded, every garden must stand open.
    await resetGarden(page, { unlocks: { waystones: [], sectors: [] } });

    const world = await page.evaluate(() => {
        const w = (globalThis as unknown as Record<string, any>).__gardenGame
            .scene.getScene("world");
        const ts = 32;
        const sakura = w.plan.regions.find((r: any) => r.section === "P-S");
        const trail = sakura.trailTiles[0];
        const stone = w.trialStones.get("P-S");
        return {
            veilsGone: w.sectorVeils === undefined,
            stones: [...w.trialStones.keys()].sort(),
            rect: sakura.rect,
            trailBlocked: w.footBlocked(trail.tileX * ts + ts / 2, (trail.tileY + 1) * ts - 4),
            stoneTile: {
                tileX: Math.round(stone.x / ts - 0.5),
                tileY: Math.round(stone.y / ts - 1),
            },
        };
    });
    // 1. The lock machinery is gone; all four stones stand.
    expect(world.veilsGone).toBe(true);
    expect(world.stones).toEqual(["B-B", "C-P", "CARS", "P-S"]);
    // 2. OPEN: the garden's trail is walkable with zero unlocks.
    expect(world.trailBlocked).toBe(false);

    // 3. The stone sits at the heart of the quadrant (center tile, nudged off water only).
    const centerX = world.rect.x + Math.floor(world.rect.w / 2);
    const centerY = world.rect.y + Math.floor(world.rect.h / 2);
    expect(Math.abs(world.stoneTile.tileX - centerX)).toBeLessThanOrEqual(6);
    expect(Math.abs(world.stoneTile.tileY - centerY)).toBeLessThanOrEqual(6);

    // 4. Physically walk in across the old seam: stand east of Sakura, push west, ENTER.
    await teleportTo(page, 20, 6);
    await keyHold(page, "ArrowLeft", 1_200);
    expect((await avatarTile(page)).tileX, "the border must admit the player")
        .toBeLessThan(world.rect.x + world.rect.w);
    await shot(page, "w1a-sector-open");

    // 5. Fast travel needs no unlock anymore.
    const waystone = await page.evaluate(() => {
        const w = (globalThis as unknown as Record<string, any>).__gardenGame
            .scene.getScene("world");
        return w.plan.regions.find((r: any) => r.section === "P-S").waystone;
    });
    await emitBus(page, "map:travel", { waystoneId: "P-S" });
    await expect.poll(async () => JSON.stringify(await avatarTile(page)), { timeout: 5_000 })
        .toBe(JSON.stringify({ tileX: waystone.tileX, tileY: waystone.tileY }));

    // 6. Walk up to the stone and interact (proximity + E): no panel — just rain.
    await teleportTo(page, world.stoneTile.tileX, world.stoneTile.tileY + 2);
    await page.keyboard.press("e");
    await expect(page.locator(".keeper-panel-shell")).not.toBeVisible();
    await expect.poll(() =>
        page.evaluate(() => {
            const w = (globalThis as unknown as Record<string, any>).__gardenGame
                .scene.getScene("world");
            return w.weather.rainDrops.some((d: any) => d.visible);
        }), { timeout: 5_000 }).toBe(true);
    await shot(page, "w1a-stone-rain");

    // 7. The burst was actually scheduled (a finite shower, not a permanent state flip).
    const burst = await page.evaluate(() => {
        const w = (globalThis as unknown as Record<string, any>).__gardenGame
            .scene.getScene("world");
        return { until: w.weather.burstUntil, now: w.time.now };
    });
    expect(burst.until).toBeGreaterThan(burst.now - 10_000);
    expect(burst.until).toBeLessThan(burst.now + 10_000);
});
