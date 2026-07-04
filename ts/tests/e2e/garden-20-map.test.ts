// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up W1a: doc 26 G2 gate — map-first navigation over the real world plan:
// HUD Map button toggles the overlay, markers render, and waystone travel lands the
// avatar in each of the four gardens (quadrants are always open as of 2026-07-03;
// the center-stone rain interaction is garden-40-sectorlocks' subject).
import { avatarTile, emitBus, expect, resetGarden, shot, test } from "./garden-helpers";

const ALL_SECTORS = ["P-S", "B-B", "C-P", "CARS"];

test("open the map, see you-are-here, travel to all four gardens", async ({ garden: page }) => {
    await resetGarden(page, {
        unlocks: { waystones: [], sectors: ALL_SECTORS },
    });

    // 1. The HUD Map button toggles the map scene on; Escape hides it.
    await page.getByRole("button", { name: "Map", exact: true }).click();
    await expect.poll(() =>
        page.evaluate(() => (globalThis as unknown as Record<string, any>).__gardenGame.scene.isVisible("map"))
    ).toBe(true);

    const markers = await page.evaluate(() => {
        const scene = (globalThis as unknown as Record<string, any>).__gardenGame
            .scene.getScene("map");
        const all = scene.miniRoot.getAll();
        return {
            dynamicCount: all.filter((o: any) => o.getData("dynamic")).length,
            labels: all.filter((o: any) => o.type === "Text").map((o: any) => o.text),
        };
    });
    // you-are-here dot + the sky tint always; TEND NEXT star/tag only when something is due.
    expect(markers.dynamicCount).toBeGreaterThanOrEqual(2);
    expect(markers.labels).toEqual(
        expect.arrayContaining(["Sakura", "Keukenhof", "Versailles", "Gardens by the Bay"]),
    );
    await shot(page, "w1a-map-open");

    await page.keyboard.press("Escape");
    await expect.poll(() =>
        page.evaluate(() => (globalThis as unknown as Record<string, any>).__gardenGame.scene.isVisible("map"))
    ).toBe(false);

    // 2. Travel to every garden's waystone — the same bus event the map's waystone dots
    //    emit on pointerdown (map-scene.ts renderMiniMap).
    const regions: Array<{ section: string; waystone: { tileX: number; tileY: number } }> = await page
        .evaluate(() => {
            const plan = (globalThis as unknown as Record<string, any>).__gardenGame
                .scene.getScene("world").plan;
            return plan.regions.map((r: any) => ({ section: r.section, waystone: r.waystone }));
        });
    expect(regions.map((r) => r.section).sort()).toEqual(["B-B", "C-P", "CARS", "P-S"]);

    for (const r of regions) {
        await emitBus(page, "map:travel", { waystoneId: r.section });
        // The avatar arrives one tile SOUTH of the stone (never inside its base box),
        // sliding up to a few more tiles south when something occupies the spot
        // (world-scene teleportToWaystone).
        await expect.poll(async () => {
            const t = await avatarTile(page);
            const dy = t.tileY - r.waystone.tileY;
            return t.tileX === r.waystone.tileX && dy >= 1 && dy <= 5;
        }, { timeout: 5_000 }).toBe(true);
        await shot(page, `w1a-map-travel-${r.section}`);
    }
});
