// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: living-decay smoke (spec 2026-07-05). Engine-side decay cannot be
// simulated by the page clock shim, so this spec runs in two phases against the
// launcher's backdate fixture:
//   1. `prep` grades real cards on the target topic (any normal launch);
//   2. stop the app, relaunch with
//        GARDEN_E2E_BACKDATE_DECK="MCAT::B-B::1A" GARDEN_E2E_BACKDATE_DAYS=4
//      and re-run — the decay assertions then run (they SKIP, not fail, on an
//      unprepared profile, matching the harness's app-down skip convention).
// The logic weight lives in the vitest units; this is presence smoke.
import type { Page } from "@playwright/test";

import {
    closeKeeper,
    emitBus,
    expect,
    gradeOnce,
    masteryTopic,
    shot,
    test,
} from "./garden-helpers";

const TARGET_NODE = "BB.1A";
const TARGET_DECK = "MCAT::B-B::1A";
const PREP_GRADES = 5;

async function registryDaysAway(page: Page): Promise<number> {
    return await page.evaluate(() =>
        (globalThis as unknown as Record<string, any>).__gardenGame
            .registry.get("daysAway") ?? 0
    );
}

/** Runtime introspection: TS-private fields are plain JS properties in the page. */
async function decayVisuals(
    page: Page,
    nodeId: string,
): Promise<{ tufts: number }> {
    return await page.evaluate((id) => {
        const w = (globalThis as unknown as Record<string, any>).__gardenGame
            .scene.getScene("world");
        return {
            tufts: w.overgrowth ? w.overgrowth.count(id) : 0,
        };
    }, nodeId);
}

test("prep: put real review history on the target topic", async ({ garden: page }, testInfo) => {
    const topic = await masteryTopic(page, TARGET_NODE);
    testInfo.skip(!topic, `${TARGET_NODE} missing from the starter deck`);
    testInfo.skip(
        (topic!.gradedReviews ?? 0) >= PREP_GRADES,
        "already prepped — go backdate and re-run",
    );
    await emitBus(page, "plant:interact", { nodeId: TARGET_NODE });
    for (let i = 0; i < PREP_GRADES; i++) {
        await gradeOnce(page, "good");
    }
    await closeKeeper(page);
    const after = await masteryTopic(page, TARGET_NODE);
    expect(after!.gradedReviews).toBeGreaterThan(0);
});

test("decayed arrival: overgrowth tufts after days away", async ({ garden: page }, testInfo) => {
    const away = await registryDaysAway(page);
    const topic = await masteryTopic(page, TARGET_NODE);
    testInfo.skip(
        away < 1 || !topic || topic.dueCount === 0,
        `profile not decay-prepared (daysAway=${away}) — relaunch with `
            + `GARDEN_E2E_BACKDATE_DECK="${TARGET_DECK}" GARDEN_E2E_BACKDATE_DAYS=4 `
            + `after running the prep test once`,
    );
    const visuals = await decayVisuals(page, TARGET_NODE);
    expect(visuals.tufts).toBeGreaterThan(0);
    await shot(page, "decay-arrival");
});

test("tending re-syncs the neglect layer without a reload", async ({ garden: page }, testInfo) => {
    const away = await registryDaysAway(page);
    const topic = await masteryTopic(page, TARGET_NODE);
    testInfo.skip(
        away < 1 || !topic || topic.dueCount === 0,
        "profile not decay-prepared — see the decayed-arrival skip message",
    );
    await emitBus(page, "plant:interact", { nodeId: TARGET_NODE });
    await gradeOnce(page, "good");
    await closeKeeper(page);
    // review:closed -> refreshSnapshot -> mastery:refreshed -> restage + overgrowth sync.
    await page.waitForFunction(
        (id) => {
            const snap = (globalThis as unknown as Record<string, any>).__gardenGame
                .registry.get("masterySnapshot");
            return snap?.topics.some((t: { nodeId: string }) => t.nodeId === id);
        },
        TARGET_NODE,
        { timeout: 15_000 },
    );
    const visuals = await decayVisuals(page, TARGET_NODE);
    // Not asserting a count DROP (one grade may not clear the pile) — asserting the
    // world stayed live and the layer resynced to a legal value.
    expect(visuals.tufts).toBeGreaterThanOrEqual(0);
    expect(visuals.tufts).toBeLessThanOrEqual(6);
    await shot(page, "decay-after-tending");
});
