// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up W1a: doc 26 G2 gate — the session-end harvest shows REAL values, and the
// full loop is proven live with ENGINE-side truth: one graded answer at the Keeper must
// (a) tick the HUD water refill, (b) increment the topic's revlog-derived gradedReviews
// (masteryQuery RPC, re-fetched on review:closed), and (c) surface honestly in Harvest.
import { emitBus, expect, gradeOnce, hudWater, masteryTopic, resetGarden, shot, test } from "./garden-helpers";

test("one graded answer: water refill + revlog truth + an honest harvest summary", async ({ garden: page }) => {
    await resetGarden(page, { pending: [] });
    const waterBefore = await hudWater(page);

    await emitBus(page, "keeper:interact", {});
    await expect(page.locator(".keeper-panel-shell")).toBeVisible();
    await expect(page.locator(".keeper-context")).toContainText("Tending:");
    const context = await page.locator(".keeper-context").innerText();

    // Resolve which topic the Keeper is tending (engine-truth baseline BEFORE grading).
    const nodeId: string | null = await page.evaluate((ctx) => {
        const topics = (globalThis as unknown as Record<string, any>).__gardenGame
            .registry.get("masterySnapshot").topics;
        return topics.find((t: { label: string }) => ctx.includes(t.label))?.nodeId ?? null;
    }, context);
    expect(nodeId, `context "${context}" must resolve to a topic`).not.toBeNull();
    const before = await masteryTopic(page, nodeId!);

    // Grade exactly one REAL card: reveal, then Good.
    await gradeOnce(page, "good");
    // The graded answer landed when the water refill ticks the HUD (+1 per answer).
    await expect.poll(async () => await hudWater(page), { timeout: 15_000 })
        .toBe(waterBefore + 1);

    await page.locator(".keeper-panel .keeper-close").click();

    const harvest = page.locator(".harvest-panel");
    await expect(harvest).toBeVisible();
    await expect(harvest).toContainText("Answers: 1"); // exactly what this session graded
    await expect(harvest).toContainText("Plots watered: 1"); // one topic tended
    await expect(harvest).toContainText("New blooms: 0"); // no paraphrase pass happened
    // Growth line: absent (the dashboard abstains honestly) or a real sentence — never NaN.
    const growth = page.locator(".harvest-growth");
    if ((await growth.count()) > 0) {
        await expect(growth).not.toContainText(/NaN|undefined|null/);
    }
    await shot(page, "w1a-harvest");

    // ENGINE truth: review:closed re-fetched masteryQuery — the revlog row landed.
    await expect.poll(
        async () => (await masteryTopic(page, nodeId!))?.gradedReviews,
        { timeout: 20_000 },
    ).toBe((before?.gradedReviews ?? 0) + 1);

    await harvest.getByRole("button", { name: "Keep tending" }).click();
    await expect(harvest).not.toBeVisible();
});
