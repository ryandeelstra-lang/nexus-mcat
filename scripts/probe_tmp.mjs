import { chromium } from "@playwright/test";
const BASE = process.env.GARDEN_URL || "http://127.0.0.1:41800";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1024, height: 640 } });
page.on("console", (m) => console.log("CONSOLE", m.type(), m.text().slice(0, 300)));
page.on("pageerror", (e) => console.log("PAGEERROR", String(e).slice(0, 500)));
page.on("requestfailed", (r) => console.log("REQFAIL", r.url().slice(0, 200), r.failure()?.errorText));
await page.addInitScript(() => localStorage.setItem("garden.introSeen.v2", "1"));
await page.goto(BASE + "/garden");
await page.waitForFunction(() => Boolean(globalThis.__gardenGame), null, { timeout: 120000 });
console.log("game exists");
for (let i = 0; i < 24; i++) {
    const st = await page.evaluate(() => {
        const game = globalThis.__gardenGame;
        const mgr = game.scene;
        return {
            active: mgr.getScenes(true).map((s) => s.scene.key),
            bootStatus: mgr.keys.boot ? mgr.keys.boot.scene.settings.status : null,
            worldStatus: mgr.keys.world ? mgr.keys.world.scene.settings.status : null,
            avatar: Boolean(mgr.keys.world && mgr.keys.world.avatar),
        };
    });
    console.log(i * 5 + "s", JSON.stringify(st));
    if (st.avatar) { break; }
    await page.waitForTimeout(5000);
}
await browser.close();
