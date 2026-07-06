// Temporary live-verification harness (not for commit).
// Fresh-boot plaza shot, mid-walk frame, then unlock all sectors and shoot each region.
// Usage: PLAYWRIGHT_BROWSERS_PATH=out/playwright-browsers GARDEN_URL=http://127.0.0.1:41800 node scripts/proof_shots_tmp.mjs /tmp/sector-shots
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const OUT = process.argv[2] || "/tmp/sector-shots";
fs.mkdirSync(OUT, { recursive: true });
const BASE = process.env.GARDEN_URL || "http://127.0.0.1:41800";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1024, height: 640 } });
await page.addInitScript(() => localStorage.setItem("garden.introSeen.v2", "1"));
await page.goto(BASE + "/garden");
await page.waitForFunction(() => Boolean(globalThis.__gardenGame), null, { timeout: 120000 });
// The boot scene preloads sliced art over HTTP (~30s) before starting the world.
await page.waitForFunction(
    () => Boolean(globalThis.__gardenGame?.scene?.keys?.world?.avatar),
    null,
    { timeout: 180000 },
);
await page.waitForTimeout(3000); // terrain paint + camera settle

async function shot(name) {
    await page.screenshot({ path: path.join(OUT, name) });
    console.log("SHOT", path.join(OUT, name));
}

// 4. Fresh boot: plaza with locked sectors.
await shot("00-plaza-locked.png");

// 6. Mid-walk frame: hold ArrowRight ~1s, screenshot while still held.
await page.keyboard.down("ArrowRight");
await page.waitForTimeout(700);
await shot("05-mid-walk.png");
await page.waitForTimeout(300);
await page.keyboard.up("ArrowRight");

// 5. Unlock all sectors, then travel to each and screenshot.
await page.evaluate(() => {
    for (const s of ["P-S", "B-B", "C-P", "CARS"]) {
        globalThis.__gardenBus.emit("sector:unlocked", { section: s });
    }
});
await page.waitForTimeout(1400);

const sections = [
    ["P-S", "01-sakura"],
    ["B-B", "02-keukenhof"],
    ["C-P", "03-versailles"],
    ["CARS", "04-gardens"],
];
for (const [section, name] of sections) {
    await page.evaluate(
        (s) => globalThis.__gardenBus.emit("map:travel", { waystoneId: s }),
        section,
    );
    await page.waitForTimeout(1800);
    await shot(name + ".png");
}

await browser.close();
console.log("DONE");
