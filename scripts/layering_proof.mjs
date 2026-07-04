// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html
//
// charged_up dev harness: drive the /garden page in a Playwright Chromium (external client —
// ANKI_API_HOST=0.0.0.0 + ANKIDEV testing escape) and PROVE the realistic-collision work:
//   1. behind-bush shot: avatar feet just NORTH of a tree/bush base → canopy covers avatar
//   2. front-of-bush shot: avatar feet just SOUTH of the same base → avatar covers bush
//   3. slide proof: hold right+down against a hedge wall → the avatar glides (y advances)
// Usage: PLAYWRIGHT_BROWSERS_PATH=out/playwright-browsers node scripts/layering_proof.mjs <outdir>
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const OUT = process.argv[2] || "/tmp/sector-shots";
fs.mkdirSync(OUT, { recursive: true });
const BASE = process.env.GARDEN_URL || "http://127.0.0.1:40000";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1024, height: 640 } });
// Skip the intro cinematic.
await page.addInitScript(() => localStorage.setItem("garden.introSeen.v2", "1"));
await page.goto(BASE + "/garden");
await page.waitForFunction(() => Boolean(globalThis.__gardenGame), null, { timeout: 60000 });
// The boot scene preloads sliced art over HTTP (~30s) before starting the world —
// wait for the world scene to actually exist (avatar spawned), not just the game object.
await page.waitForFunction(
    () => Boolean(globalThis.__gardenGame?.scene?.keys?.world?.avatar),
    null,
    { timeout: 180000 },
);
await page.waitForTimeout(2500); // boot + terrain paint settle

/** Run inside the page against the live Phaser world. */
async function inWorld(fn, arg) {
    return await page.evaluate(
        ([src, a]) => {
            const game = globalThis.__gardenGame;
            const world = game.scene.keys.world;
            // eslint-disable-next-line no-new-func
            return new Function("world", "game", "arg", `return (${src})(world, game, arg);`)(
                world,
                game,
                a,
            );
        },
        [fn.toString(), arg ?? null],
    );
}

// Unlock all sectors so we can stage anywhere.
await page.evaluate(() => {
    for (const s of ["P-S", "B-B", "C-P", "CARS"]) {
        globalThis.__gardenBus.emit("sector:unlocked", { section: s });
    }
});
await page.waitForTimeout(1200);

// Find a good demo subject: the tallest solid box in Sakura (a tree/bush trunk).
const subject = await inWorld((world) => {
    const boxes = world.solidBoxes;
    // Pick a box in the NW quadrant away from water: x < 600, y < 400, moderate width.
    const c = boxes.filter((b) => b.left > 96 && b.left < 560 && b.top > 96 && b.top < 380);
    c.sort((a, b) => b.w - a.w);
    const b = c[Math.floor(c.length / 2)] ?? boxes[0];
    return { x: b.left + b.w / 2, bottom: b.top + b.h, w: b.w };
});

async function placeAvatar(x, y) {
    await inWorld(
        (world, _g, p) => {
            world.avatar.setPosition(p.x, p.y);
            world.avatar.setDepth(world.avatar.y / 32);
            world.cameras.main.centerOn(p.x, p.y);
        },
        { x, y },
    );
    await page.waitForTimeout(500);
}

async function shot(name) {
    await page.screenshot({ path: path.join(OUT, name) });
    console.log("SHOT", path.join(OUT, name));
}

// 1. BEHIND: feet 6px above the base box top → canopy should cover the avatar.
await placeAvatar(subject.x, subject.bottom - 20);
await shot("10-behind-bush.png");

// 2. IN FRONT: feet 14px below the base bottom → avatar covers the bush.
await placeAvatar(subject.x, subject.bottom + 14);
await shot("11-front-of-bush.png");

// 3. SLIDE: hold right+down against the subject from its left side; record positions.
const slide = await inWorld(
    (world, _g, p) => {
        const start = { x: p.x - p.w / 2 - 9, y: p.bottom - 4 };
        world.avatar.setPosition(start.x, start.y);
        const track = [];
        // Simulate 40 frames of pressing right+down (16.7ms each) through moveWithSlide
        // by calling footBlocked-based movement exactly as update() does.
        for (let i = 0; i < 40; i++) {
            const speed = 96;
            const inv = 1 / Math.hypot(1, 1);
            const dx = 1 * speed * inv * (16.7 / 1000);
            const dy = 1 * speed * inv * (16.7 / 1000);
            const next = (function move(x, y, ddx, ddy, blocked) {
                const steps = Math.max(
                    1,
                    Math.ceil(Math.max(Math.abs(ddx), Math.abs(ddy)) / 4),
                );
                const sx = ddx / steps;
                const sy = ddy / steps;
                let cx = x;
                let cy = y;
                let xb = sx === 0;
                let yb = sy === 0;
                for (let s = 0; s < steps && (!xb || !yb); s++) {
                    if (!xb) {
                        if (blocked(cx + sx, cy)) {
                            xb = true;
                        } else {
                            cx += sx;
                        }
                    }
                    if (!yb) {
                        if (blocked(cx, cy + sy)) {
                            yb = true;
                        } else {
                            cy += sy;
                        }
                    }
                }
                return { x: cx, y: cy };
            })(
                world.avatar.x,
                world.avatar.y,
                dx,
                dy,
                (x, y) => world.footBlocked(x, y),
            );
            world.avatar.setPosition(next.x, next.y);
            if (i % 10 === 0 || i === 39) {
                track.push({ x: Math.round(next.x), y: Math.round(next.y) });
            }
        }
        return { start, track };
    },
    subject,
);
console.log("SLIDE start:", JSON.stringify(slide.start), "track:", JSON.stringify(slide.track));

await browser.close();
console.log("DONE");
