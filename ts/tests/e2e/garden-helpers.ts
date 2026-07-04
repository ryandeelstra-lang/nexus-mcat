// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up W1a: shared helpers for the garden e2e suite. Ground rules:
//   - the app under test is a LIVE Anki (ts/tests/e2e/launch-garden-app.py: isolated
//     /tmp/e2e-w1a-profile, mediasrv on :40001 with API access, QtWebEngine CDP on :9333,
//     4,395-card starter deck auto-imported on first run). Playwright's Chromium drives
//     the SAME /garden page that app serves. (Direct chromium.connectOverCDP into
//     QtWebEngine is impossible — Qt's CDP lacks browser-context management — so the
//     QtWebEngine-specific spot-checks use scripts/ui_shot.js + scripts/cdp_eval.mjs.)
//   - drive gameplay through DOM + keyboard wherever possible; window.__gardenGame /
//     window.__gardenBus (create-game.ts) are the introspection seams into the Phaser
//     world (registry, scenes, plan) — reads + the same bus events the game itself emits;
//   - dev teleports (avatar.setPosition) are flagged in the specs that need placement.
import { expect, type Page, test as base } from "@playwright/test";
import { mkdirSync } from "node:fs";

export const SHOT_DIR = "out/e2e-artifacts/garden";

/** localStorage key the clock shim reads at document start (see installClockShim). */
const FIXED_TIME_KEY = "garden.e2e.fixedTimeMs";

/**
 * A conditional Date shim installed as an init script: when the fixed-time key is set in
 * localStorage, every NEW document boots with `new Date()` / `Date.now()` frozen there.
 * Timers/rAF stay real, so Phaser's loop keeps running — only the wall clock is mocked
 * (this is how daynight.ts, Hud.tsx and map-scene.ts read time). No-op when the key is
 * absent, so it is safe to install unconditionally.
 */
async function installClockShim(page: Page): Promise<void> {
    await page.addInitScript(() => {
        const w = globalThis as unknown as Record<string, unknown>;
        if (w.__gardenClockShimInstalled) {
            return;
        }
        w.__gardenClockShimInstalled = true;
        let fixed: number | null = null;
        try {
            const raw = localStorage.getItem("garden.e2e.fixedTimeMs");
            if (raw) {
                fixed = Number(raw);
            }
        } catch {
            // storage unavailable — leave the real clock alone
        }
        if (!fixed || Number.isNaN(fixed)) {
            return;
        }
        const RealDate = Date;
        const frozen = fixed;
        function FakeDate(this: unknown, ...args: unknown[]): unknown {
            if (!(this instanceof FakeDate)) {
                return new RealDate(frozen).toString();
            }
            if (args.length === 0) {
                return new RealDate(frozen);
            }
            return new (RealDate as unknown as new(...a: unknown[]) => Date)(...args);
        }
        FakeDate.now = () => frozen;
        FakeDate.parse = RealDate.parse;
        FakeDate.UTC = RealDate.UTC;
        FakeDate.prototype = RealDate.prototype;
        (globalThis as unknown as { Date: unknown }).Date = FakeDate;
    });
}

/** Freeze (or unfreeze with null) the page's wall clock for the NEXT document load. */
export async function setFixedTime(page: Page, date: Date | null): Promise<void> {
    await page.evaluate(([key, ms]) => {
        try {
            if (ms === null) {
                localStorage.removeItem(key as string);
            } else {
                localStorage.setItem(key as string, String(ms));
            }
        } catch {
            // storage unavailable — the shim is a no-op then anyway
        }
    }, [FIXED_TIME_KEY, date ? date.getTime() : null] as [string, number | null]);
}

/** Wait until the React shell + the Phaser world are both live. */
export async function waitForBoot(page: Page): Promise<void> {
    await expect(page.locator(".garden-hud")).toBeVisible({ timeout: 90_000 });
    await page.waitForFunction(
        () => {
            const game = (globalThis as unknown as Record<string, any>).__gardenGame;
            return Boolean(game?.scene?.isActive?.("world"));
        },
        undefined,
        { timeout: 90_000 },
    );
}

/** Mark the v2 cinematic seen-key and click Skip if the intro overlay is up. */
export async function dismissIntro(page: Page): Promise<void> {
    await page.evaluate(() => {
        try {
            localStorage.setItem("garden.introSeen.v2", "1");
        } catch {
            // storage unavailable — IntroVideo never replays in that case anyway
        }
    });
    const skip = page.locator(".garden-intro-skip");
    if ((await skip.count()) > 0 && (await skip.isVisible())) {
        await skip.click();
        await expect(page.locator(".garden-intro")).not.toBeVisible();
    }
}

/** Navigate to the live garden page and wait until the world is playable. */
export async function connectGarden(page: Page): Promise<void> {
    await installClockShim(page);
    await page.addInitScript(() => {
        // Skip the first-run cinematic before it ever mounts (v2 seen-key).
        try {
            localStorage.setItem("garden.introSeen.v2", "1");
        } catch {
            // storage unavailable — IntroVideo never replays in that case anyway
        }
    });
    await page.goto("/garden", { waitUntil: "domcontentloaded" });
    await waitForBoot(page);
    await dismissIntro(page);
    await dismissTour(page);
}

/**
 * Keep the Garden Tour (the Keeper's first-entry concept walkthrough, sidecar-persisted —
 * NOT localStorage like the intro) from blocking a spec: mark it done in the sidecar, and
 * skip the overlay if this already-booted page auto-opened it. The e2e profile persists,
 * so after the first-ever dismissal this is a single cheap GET per test. NOT called by
 * resetGarden — the tour spec seeds `{ step, done: false }` there to test the real flow.
 */
export async function dismissTour(page: Page): Promise<void> {
    const state = await gardenState(page, { op: "get" });
    if (state?.tour?.done) {
        return;
    }
    await gardenState(page, { op: "set", key: "tour", doc: { step: 0, done: true } });
    const skip = page.locator(".garden-tour-skip");
    try {
        await skip.waitFor({ state: "visible", timeout: 4_000 });
        await skip.click();
        await expect(page.locator(".garden-tour")).not.toBeVisible();
    } catch {
        // the overlay never mounted on this page — the sidecar seed already covers reloads
    }
}

export async function shot(page: Page, name: string): Promise<void> {
    mkdirSync(SHOT_DIR, { recursive: true });
    await page.screenshot({ path: `${SHOT_DIR}/${name}.png` });
}

/** POST /_anki/gardenState — the additive sidecar bridge (state/store.ts httpTransport). */
export async function gardenState(
    page: Page,
    body: { op: "get" } | { op: "set"; key: string; doc: unknown },
): Promise<any> {
    return await page.evaluate(async (payload) => {
        const resp = await fetch("/_anki/gardenState", {
            method: "POST",
            headers: { "Content-Type": "application/binary" },
            body: JSON.stringify(payload),
        });
        if (!resp.ok) {
            throw new Error(`gardenState ${payload.op} failed: ${resp.status}`);
        }
        return await resp.json();
    }, body);
}

/**
 * Seed sidecar keys, optionally freeze the clock, then reboot the garden page so the
 * world re-creates from that state. Always clears any leftover fixed clock unless one
 * is explicitly requested, so a failed daynight case can never leak into later cases.
 */
export async function resetGarden(
    page: Page,
    seed: Record<string, unknown> = {},
    fixedTime: Date | null = null,
): Promise<void> {
    for (const [key, doc] of Object.entries(seed)) {
        await gardenState(page, { op: "set", key, doc });
    }
    await setFixedTime(page, fixedTime);
    await page.reload({ waitUntil: "domcontentloaded" });
    await waitForBoot(page);
    await dismissIntro(page);
}

/** Emit a typed bus event exactly as the world/panels do (state/bus.ts GardenEvents). */
export async function emitBus(page: Page, event: string, payload: unknown): Promise<void> {
    await page.evaluate(([ev, pl]) => {
        (globalThis as unknown as Record<string, any>).__gardenBus.emit(ev, pl);
    }, [event, payload] as [string, unknown]);
}

export async function avatarTile(page: Page): Promise<{ tileX: number; tileY: number }> {
    return await page.evaluate(() =>
        (globalThis as unknown as Record<string, any>).__gardenGame
            .scene.getScene("world").getAvatarTile()
    );
}

/** DEV TELEPORT (verification-only placement): put the avatar on a tile, let update() settle. */
export async function teleportTo(page: Page, tileX: number, tileY: number): Promise<void> {
    await page.evaluate(([tx, ty]) => {
        const w = (globalThis as unknown as Record<string, any>).__gardenGame
            .scene.getScene("world");
        const ts = 32;
        w.avatar.setPosition(tx * ts + ts / 2, ty * ts + ts);
    }, [tileX, tileY]);
    await page.waitForTimeout(400); // let update() recompute avatarTile + proximity
}

/** Hold a movement key for a duration (the real input scheme: arrows/WASD). */
export async function keyHold(page: Page, key: string, ms: number): Promise<void> {
    await page.keyboard.down(key);
    await page.waitForTimeout(ms);
    await page.keyboard.up(key);
}

async function hudChip(page: Page, index: number): Promise<number> {
    const text = await page.locator(".garden-hud .hud-top-left .hud-chip").nth(index).innerText();
    return Number.parseInt(text.replace(/\D+/g, ""), 10);
}

/** 💧 is the only HUD currency chip (panels/Hud.tsx; seeds removed 2026-07-03). */
export async function hudWater(page: Page): Promise<number> {
    return hudChip(page, 0);
}

/** Engine truth for one topic from the registry snapshot (masteryQuery + deckTree RPCs). */
export async function masteryTopic(
    page: Page,
    nodeId: string,
): Promise<
    {
        nodeId: string;
        label: string;
        gradedReviews: number;
        cardsWithState: number;
        averageRecall: number;
        dueCount: number;
        newCount: number;
    } | null
> {
    return await page.evaluate((id) => {
        const snap = (globalThis as unknown as Record<string, any>).__gardenGame
            .registry.get("masterySnapshot");
        const t = snap.topics.find((x: { nodeId: string }) => x.nodeId === id);
        if (!t) {
            return null;
        }
        return {
            nodeId: t.nodeId,
            label: t.label,
            gradedReviews: t.gradedReviews,
            cardsWithState: t.cardsWithState,
            averageRecall: t.averageRecall,
            dueCount: t.dueCount,
            newCount: t.newCount,
        };
    }, nodeId);
}

/** Reveal + grade the current Keeper card through the real DOM controls. */
export async function gradeOnce(
    page: Page,
    grade: "again" | "hard" | "good" | "easy",
): Promise<void> {
    await expect(page.locator(".keeper-panel .keeper-card-frame")).toBeVisible({
        timeout: 30_000,
    });
    await page.locator(".keeper-panel .keeper-reveal").click();
    await page.locator(`.keeper-panel .grade-${grade}`).click();
}

/** Close the Keeper panel; dismiss the harvest overlay if it follows. */
export async function closeKeeper(page: Page): Promise<void> {
    await page.locator(".keeper-panel .keeper-close").click();
    const harvest = page.locator(".harvest-panel");
    try {
        await harvest.waitFor({ state: "visible", timeout: 3_000 });
        await harvest.getByRole("button", { name: "Keep tending" }).click();
        await expect(harvest).not.toBeVisible();
    } catch {
        // no harvest (nothing answered) — the panel simply closed
    }
}

/**
 * The suite's test object: a `garden` fixture = a booted, intro-dismissed garden page.
 * Skips (never fails) when the app under test is unreachable, so a harness without the
 * live instance reports "skipped", not red.
 */
export const test = base.extend<{ garden: Page }>({
    garden: async ({ page, baseURL }, use, testInfo) => {
        let up = false;
        try {
            const resp = await fetch(`${baseURL}/favicon.ico`);
            up = resp.ok;
        } catch {
            up = false;
        }
        if (!up) {
            testInfo.skip(
                true,
                `garden app at ${baseURL} is down — start it with `
                    + `out/pyenv/bin/python ts/tests/e2e/launch-garden-app.py`,
            );
        }
        await connectGarden(page);
        await use(page);
    },
});

export { expect };
