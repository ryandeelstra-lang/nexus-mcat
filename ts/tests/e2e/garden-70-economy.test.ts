// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up W1a: doc 26 G2 gate — the three economy invariants, LIVE on the real engine:
//   1. a WRONG answer refills water (the rep was real) but never blooms the plant (I3/I4);
//   2. spending currency moves money, never mastery — the engine's revlog/memory-state
//      stay untouched by a pour (I4);
//   3. a broke player is never hard-stalled: watering closes with an honest reason, the
//      Keeper still serves, and one graded answer restarts the economy from zero.
// The 365-day never-starves arithmetic is pinned by state/economy-sim.test.ts (vitest).
import {
    emitBus,
    expect,
    gardenState,
    gradeOnce,
    hudWater,
    masteryTopic,
    resetGarden,
    shot,
    test,
} from "./garden-helpers";

test("invariant 1: a wrong answer refills water but never blooms the plant", async ({ garden: page }) => {
    await resetGarden(page, { pending: [] });
    const waterBefore = await hudWater(page);

    // Spy on the bus BEFORE grading: a bloom event here would be an I3 violation.
    await page.evaluate(() => {
        const w = globalThis as unknown as Record<string, any>;
        w.__e2eBloomCount = 0;
        w.__gardenBus.on("plant:bloomed", () => {
            w.__e2eBloomCount += 1;
        });
    });

    await emitBus(page, "keeper:interact", {});
    await expect(page.locator(".keeper-context")).toContainText("Tending:");
    const context = await page.locator(".keeper-context").innerText();
    const nodeId: string | null = await page.evaluate((ctx) => {
        const topics = (globalThis as unknown as Record<string, any>).__gardenGame
            .registry.get("masterySnapshot").topics;
        return topics.find((t: { label: string }) => ctx.includes(t.label))?.nodeId ?? null;
    }, context);
    expect(nodeId).not.toBeNull();
    const before = await masteryTopic(page, nodeId!);

    await gradeOnce(page, "again"); // WRONG
    // The retrieval attempt was real work: water refills the same as a right answer…
    await expect.poll(async () => await hudWater(page), { timeout: 15_000 })
        .toBe(waterBefore + 1);
    await page.locator(".keeper-panel .keeper-close").click();

    // …but nothing bloomed, anywhere.
    const harvest = page.locator(".harvest-panel");
    await expect(harvest).toBeVisible();
    await expect(harvest).toContainText("New blooms: 0");
    await harvest.getByRole("button", { name: "Done for today" }).click();

    expect(await page.evaluate(() => (globalThis as unknown as Record<string, any>).__e2eBloomCount))
        .toBe(0);
    // Engine truth: the rep landed (revlog +1) yet the topic is NOT bloom-eligible — the
    // paraphrase gate (I3) has not passed, so its plant can never show "bloomed".
    await expect.poll(
        async () => (await masteryTopic(page, nodeId!))?.gradedReviews,
        { timeout: 20_000 },
    ).toBe((before?.gradedReviews ?? 0) + 1);
    await emitBus(page, "plant:interact", { nodeId });
    const stageText = await page.locator(".plant-card-popover p", { hasText: "Stage:" })
        .innerText();
    expect(stageText).not.toContain("bloomed");
    await page.locator(".plant-card-popover").getByLabel("Close").click();
});

test("invariant 2: spending currency moves money, never mastery", async ({ garden: page }) => {
    await resetGarden(page, { pending: [] });

    const pick: { nodeId: string } | null = await page.evaluate(() => {
        const topics = (globalThis as unknown as Record<string, any>).__gardenGame
            .registry.get("masterySnapshot").topics;
        const t = topics.find((x: any) => x.cardsWithState === 0 && x.gradedReviews === 0);
        return t ? { nodeId: t.nodeId } : null;
    });
    expect(pick, "an untouched (bare-soil) topic must exist").not.toBeNull();

    await emitBus(page, "plant:interact", { nodeId: pick!.nodeId });
    const card = page.locator(".plant-card-popover");
    await expect(card.locator("p", { hasText: "Stage:" })).toContainText("bare-soil");
    const waterBefore = await hudWater(page);
    await card.getByRole("button", { name: /Water/ }).click();
    await expect.poll(async () => await hudWater(page)).toBe(waterBefore - 1);
    await card.getByLabel("Close").click();

    // Force a fresh engine read: the money moved, the mastery did not.
    await resetGarden(page);
    await emitBus(page, "plant:interact", { nodeId: pick!.nodeId });
    await expect(page.locator(".plant-card-popover p", { hasText: "Stage:" }))
        .toContainText("bare-soil");
    await page.locator(".plant-card-popover").getByLabel("Close").click();
    const after = await masteryTopic(page, pick!.nodeId);
    expect(after?.gradedReviews).toBe(0);
    expect(after?.cardsWithState).toBe(0);
    await gardenState(page, { op: "set", key: "pending", doc: [] }); // no debris
});

test("invariant 3: a broke player is never stalled — the Keeper serves, grading refills from zero", async ({ garden: page }) => {
    await resetGarden(page, {
        economy: { water: 0, xp: 0 },
        pending: [],
    });
    expect(await hudWater(page)).toBe(0);

    // Watering is closed with an honest reason…
    const pick: { nodeId: string } = await page.evaluate(() => {
        const t = (globalThis as unknown as Record<string, any>).__gardenGame
            .registry.get("masterySnapshot").topics[0];
        return { nodeId: t.nodeId };
    });
    await emitBus(page, "plant:interact", { nodeId: pick.nodeId });
    const card = page.locator(".plant-card-popover");
    await expect(card.getByRole("button", { name: /Water/ })).toBeDisabled();
    await expect(card.locator(".plant-card-reason").first())
        .toContainText("answer questions at the Keeper");
    await shot(page, "w1a-broke-player");
    await card.getByLabel("Close").click();

    // …but the Keeper still serves work, and ONE graded answer restarts the economy.
    await emitBus(page, "keeper:interact", {});
    await expect(page.locator(".keeper-panel-shell")).not.toContainText("Nothing is queued");
    await gradeOnce(page, "good");
    await expect.poll(async () => await hudWater(page), { timeout: 15_000 }).toBe(1);
    await page.locator(".keeper-panel .keeper-close").click();
    const harvest = page.locator(".harvest-panel");
    if (await harvest.isVisible()) {
        await harvest.getByRole("button", { name: "Done for today" }).click();
    }

    // Restore the default balances for any later suite runs.
    await gardenState(page, { op: "set", key: "economy", doc: { water: 80, xp: 0 } });
});
