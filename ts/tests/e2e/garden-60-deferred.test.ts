// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up W1a (live slice of doc 23 §7.1): plots sown through the REAL plant-card UI
// this visit are what the Keeper serves on the NEXT visit (reload = next boot on the same
// profile), oldest first, flagged "queued". The full 15-plot arithmetic is pinned by
// ts/routes/garden/state/deferred-queue.test.ts (vitest); this proves the same loop
// end-to-end against the running engine + sidecar.
import { emitBus, expect, gardenState, hudWater, resetGarden, shot, test, waitForBoot } from "./garden-helpers";

test("sow two plots this visit; the Keeper serves the first-queued on the next visit", async ({ garden: page }) => {
    await resetGarden(page, { pending: [] }); // clean slate

    const picks: Array<{ nodeId: string; label: string }> = await page.evaluate(() => {
        const topics = (globalThis as unknown as Record<string, any>).__gardenGame
            .registry.get("masterySnapshot").topics;
        return topics.slice(0, 2).map((t: any) => ({ nodeId: t.nodeId, label: t.label }));
    });

    for (const p of picks) {
        const waterBefore = await hudWater(page);
        await emitBus(page, "plant:interact", { nodeId: p.nodeId });
        const card = page.locator(".plant-card-popover");
        await expect(card).toBeVisible();
        await card.getByRole("button", { name: /Water/ }).click(); // spend → queue
        // The pour was PAID for (I4: spending moves money, the queue holds the topic).
        await expect.poll(async () => await hudWater(page)).toBe(waterBefore - 1);
        await card.getByLabel("Close").click();
        await expect(card).not.toBeVisible();
    }

    // Both persisted to the sidecar as pending, in sow order.
    await expect.poll(async () => {
        const s = await gardenState(page, { op: "get" });
        return (s.pending ?? []).map((e: { nodeId: string }) => e.nodeId);
    }).toEqual(picks.map((p) => p.nodeId));

    // NEXT VISIT: a fresh boot on the same persisted profile.
    await page.reload({ waitUntil: "domcontentloaded" });
    await waitForBoot(page);
    await emitBus(page, "keeper:interact", {});
    // FIFO: the first sown plot is served first, flagged "queued" (not a fresh assignment).
    await expect(page.locator(".keeper-context")).toContainText(`Tending: ${picks[0].label}`, {
        timeout: 30_000,
    });
    await expect(page.locator(".keeper-context")).toContainText("queued");
    await shot(page, "w1a-next-visit-served");
    await page.locator(".keeper-panel .keeper-close").click();

    await gardenState(page, { op: "set", key: "pending", doc: [] }); // leave no debris
});
