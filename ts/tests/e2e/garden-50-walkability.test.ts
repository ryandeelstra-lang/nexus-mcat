// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up W1a: doc 26 G2 gate — the four gardens are walkable, with collision.
// Three layers of proof over the LIVE collision function (solidFn — includes water,
// props, hedges, and sector locks):
//   (1) BFS: every region is traversable border-to-border on both axes;
//   (2) BFS from each region's waystone reaches EVERY plant plot (the gameplay claim);
//   (3) a real keyboard walk crosses from Sakura through the Keeper plaza into
//       Keukenhof while sampling frame times (the perf spot-check artifact).
import { writeFileSync } from "node:fs";

import { avatarTile, emitBus, expect, keyHold, resetGarden, shot, SHOT_DIR, test } from "./garden-helpers";

const ALL_SECTORS = ["P-S", "B-B", "C-P", "CARS"];

test("BFS over live collision: every garden is border-to-border traversable and every plot reachable", async ({ garden: page }) => {
    await resetGarden(page, { unlocks: { waystones: [], sectors: ALL_SECTORS } });

    const results = await page.evaluate(() => {
        const w = (globalThis as unknown as Record<string, any>).__gardenGame
            .scene.getScene("world");
        const solid = (x: number, y: number) => w.solidFn(x, y);

        function flood(r: any, starts: Array<[number, number]>): Set<string> {
            const { x, y, w: ww, h } = r.rect;
            const seen = new Set(starts.map(([a, b]) => `${a},${b}`));
            const queue = [...starts];
            while (queue.length > 0) {
                const [cx, cy] = queue.shift() as [number, number];
                for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                    const nx = cx + dx;
                    const ny = cy + dy;
                    const key = `${nx},${ny}`;
                    if (nx < x || ny < y || nx >= x + ww || ny >= y + h) { continue; }
                    if (seen.has(key) || solid(nx, ny)) { continue; }
                    seen.add(key);
                    queue.push([nx, ny]);
                }
            }
            return seen;
        }
        function edge(r: any, side: "W" | "E" | "N" | "S"): Array<[number, number]> {
            const { x, y, w: ww, h } = r.rect;
            const out: Array<[number, number]> = [];
            for (let ty = y; ty < y + h; ty++) {
                for (let tx = x; tx < x + ww; tx++) {
                    if (solid(tx, ty)) { continue; }
                    if (
                        (side === "W" && tx === x) || (side === "E" && tx === x + ww - 1)
                        || (side === "N" && ty === y) || (side === "S" && ty === y + h - 1)
                    ) {
                        out.push([tx, ty]);
                    }
                }
            }
            return out;
        }
        return w.plan.regions.map((r: any) => {
            const fromWest = flood(r, edge(r, "W"));
            const fromNorth = flood(r, edge(r, "N"));
            const fromWaystone = flood(r, [[r.waystone.tileX, r.waystone.tileY]]);
            const unreachedPlants = r.plants
                .filter((p: any) => {
                    // A plot counts as reachable when it or a neighbor tile is walkable-to.
                    for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
                        if (fromWaystone.has(`${p.tileX + dx},${p.tileY + dy}`)) {
                            return false;
                        }
                    }
                    return true;
                })
                .map((p: any) => p.nodeId);
            return {
                section: r.section,
                westToEast: edge(r, "E").some(([a, b]) => fromWest.has(`${a},${b}`)),
                northToSouth: edge(r, "S").some(([a, b]) => fromNorth.has(`${a},${b}`)),
                waystoneSolid: solid(r.waystone.tileX, r.waystone.tileY),
                unreachedPlants,
            };
        });
    });

    for (const r of results) {
        expect(r, `${r.section} must be walkable border-to-border with every plot reachable`)
            .toEqual({
                section: r.section,
                westToEast: true,
                northToSouth: true,
                waystoneSolid: false,
                unreachedPlants: [],
            });
    }
});

test("a real keyboard walk crosses Sakura → plaza → Keukenhof with steady frame times", async ({ garden: page }) => {
    test.setTimeout(240_000);
    await resetGarden(page, { unlocks: { waystones: [], sectors: ALL_SECTORS } });

    // Start at the Sakura waystone via the map's own travel event.
    const start = await page.evaluate(() => {
        const w = (globalThis as unknown as Record<string, any>).__gardenGame
            .scene.getScene("world");
        return w.plan.regions.find((r: any) => r.section === "P-S").waystone;
    });
    await emitBus(page, "map:travel", { waystoneId: "P-S" });
    await expect.poll(async () => (await avatarTile(page)).tileX).toBe(start.tileX);

    // Keukenhof's rect starts at x=25 (worldgen REGION_RECTS) — read it live regardless.
    const goalX = await page.evaluate(() => {
        const w = (globalThis as unknown as Record<string, any>).__gardenGame
            .scene.getScene("world");
        return w.plan.regions.find((r: any) => r.section === "B-B").rect.x;
    });

    const samples: number[] = [];
    let tile = await avatarTile(page);
    let stalls = 0;
    await page.keyboard.down("ArrowRight");
    const t0 = Date.now();
    while (Date.now() - t0 < 120_000) {
        await page.waitForTimeout(400);
        samples.push(
            await page.evaluate(() => (globalThis as unknown as Record<string, any>).__gardenGame.loop.actualFps),
        );
        const next = await avatarTile(page);
        if (next.tileX === tile.tileX && next.tileY === tile.tileY) {
            // Obstacle: side-step one tile (alternating north/south), keep pushing east.
            stalls += 1;
            const dodge = stalls % 2 === 1 ? "ArrowUp" : "ArrowDown";
            await page.keyboard.down(dodge);
            await page.waitForTimeout(350);
            await page.keyboard.up(dodge);
        }
        tile = next;
        if (tile.tileX >= goalX + 1) { break; // physically inside Keukenhof
         }
    }
    await page.keyboard.up("ArrowRight");

    expect(tile.tileX, "the walk must physically cross into Keukenhof")
        .toBeGreaterThanOrEqual(goalX);
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    // Offscreen QtWebEngine idles ~35fps on this machine; a headed run holds 60. The
    // gate here is "no collapse while walking/crossing" — the raw samples are archived
    // for the exit-gate evidence row.
    expect(mean, "mean fps while walking the border").toBeGreaterThan(24);
    writeFileSync(
        `${SHOT_DIR}/w1a-walk-frametimes.json`,
        JSON.stringify({ samples, mean, stalls, platform: "qtwebengine-offscreen" }, null, 2),
    );
    await shot(page, "w1a-border-crossing");
});
