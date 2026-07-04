// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: map click-to-teleport (doc 23 §6.4 map-first "pick a spot and drop in").
// Proves the full chain on the live app:
//   (1) bus contract: "map:teleport" onto grass moves the avatar; onto water it is a no-op;
//   (2) a REAL mouse click on the map overlay canvas lands the avatar on the clicked tile
//       and closes the map; clicking water keeps the map open and the avatar put.
import { avatarTile, emitBus, expect, resetGarden, shot, test } from "./garden-helpers";

/** Mirrors MAP_SCALE in game/scenes/map-scene.ts (world px → mini-map px). */
const MAP_SCALE = 0.35;
const TILE = 32;

interface Tile {
    tileX: number;
    tileY: number;
}

/** Every currently droppable tile plus a water tile, straight from the live world. */
async function probeWorld(page: import("@playwright/test").Page): Promise<{
    grass: Tile[];
    water: Tile;
    waystones: Tile[];
}> {
    return await page.evaluate(() => {
        const w = (globalThis as unknown as Record<string, any>).__gardenGame
            .scene.getScene("world");
        const grass: Array<{ tileX: number; tileY: number }> = [];
        for (let ty = 0; ty < w.plan.heightTiles; ty++) {
            for (let tx = 0; tx < w.plan.widthTiles; tx++) {
                if (w.canDropAt(tx, ty)) {
                    grass.push({ tileX: tx, tileY: ty });
                }
            }
        }
        const sakura = w.plan.regions.find((r: any) => r.section === "P-S");
        return {
            grass,
            water: sakura.waterTiles[0],
            waystones: w.plan.regions.map((r: any) => r.waystone),
        };
    });
}

/** Page coords of a tile's center on the OPEN map overlay (through its zoomed camera). */
async function mapClickPoint(
    page: import("@playwright/test").Page,
    tile: Tile,
): Promise<{ x: number; y: number }> {
    const cam = await page.evaluate(() => {
        const m = (globalThis as unknown as Record<string, any>).__gardenGame
            .scene.getScene("map");
        const view = m.cameras.main.worldView;
        return { x: view.x, y: view.y, zoom: m.cameras.main.zoom };
    });
    const canvas = await page.locator(".garden-canvas canvas").boundingBox();
    if (!canvas) {
        throw new Error("garden canvas not found");
    }
    const mapX = (tile.tileX + 0.5) * TILE * MAP_SCALE;
    const mapY = (tile.tileY + 0.5) * TILE * MAP_SCALE;
    return {
        x: canvas.x + (mapX - cam.x) * cam.zoom,
        y: canvas.y + (mapY - cam.y) * cam.zoom,
    };
}

async function mapIsVisible(page: import("@playwright/test").Page): Promise<boolean> {
    return await page.evaluate(() =>
        (globalThis as unknown as Record<string, any>).__gardenGame.scene.isVisible("map")
    );
}

test("map:teleport drops onto grass, refuses water, and a real map click travels", async ({ garden: page }) => {
    await resetGarden(page);

    const { grass, water, waystones } = await probeWorld(page);
    expect(grass.length, "the world must offer droppable grass").toBeGreaterThan(50);

    // --- 1. The bus contract -------------------------------------------------------
    const start = await avatarTile(page);
    const far = grass.reduce((best, t) => {
        const d = (t: Tile) => Math.hypot(t.tileX - start.tileX, t.tileY - start.tileY);
        return d(t) > d(best) ? t : best;
    });
    await emitBus(page, "map:teleport", { tileX: far.tileX, tileY: far.tileY });
    await expect.poll(async () => JSON.stringify(await avatarTile(page)))
        .toBe(JSON.stringify(far));

    // Water refuses the drop: the avatar stays put.
    await emitBus(page, "map:teleport", { tileX: water.tileX, tileY: water.tileY });
    await page.waitForTimeout(500);
    expect(await avatarTile(page)).toEqual(far);

    // --- 2. A REAL click on the map overlay ----------------------------------------
    await page.getByRole("button", { name: "Map", exact: true }).click();
    await expect.poll(() => mapIsVisible(page)).toBe(true);
    await shot(page, "w1a-teleport-map-open");

    // Pick a droppable tile away from the avatar (so the move is observable) and clear of
    // the waystone dots (so the click-zone, not a dot, receives the click).
    const clickTarget = grass.find((t) =>
        Math.hypot(t.tileX - far.tileX, t.tileY - far.tileY) > 6
        && waystones.every((ws) => Math.hypot(t.tileX - ws.tileX, t.tileY - ws.tileY) > 2)
    ) ?? grass[0];
    const pt = await mapClickPoint(page, clickTarget);
    await page.mouse.click(pt.x, pt.y);

    await expect.poll(async () => JSON.stringify(await avatarTile(page)), { timeout: 5_000 })
        .toBe(JSON.stringify(clickTarget));
    await expect.poll(() => mapIsVisible(page)).toBe(false);
    await shot(page, "w1a-teleport-landed");

    // --- 3. Clicking water keeps the map open and the avatar put --------------------
    await page.getByRole("button", { name: "Map", exact: true }).click();
    await expect.poll(() => mapIsVisible(page)).toBe(true);
    const wetPt = await mapClickPoint(page, water);
    await page.mouse.click(wetPt.x, wetPt.y);
    await page.waitForTimeout(500);
    expect(await avatarTile(page)).toEqual(clickTarget);
    expect(await mapIsVisible(page)).toBe(true);
    await shot(page, "w1a-teleport-denied");
    await page.keyboard.press("Escape");
    await expect.poll(() => mapIsVisible(page)).toBe(false);
});
