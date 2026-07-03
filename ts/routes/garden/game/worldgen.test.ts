// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: worldgen determinism + gate/plant invariants (doc 23 §6.3, §8).
import { describe, expect, it } from "vitest";

import type { GrowthStage } from "../state/stage";

import { allLeafIds, buildWorldPlan, gateIsOpen, LEAF_PREREQ, tileIsSolid } from "./worldgen";

describe("buildWorldPlan", () => {
    it("is deterministic (same input → same plan)", () => {
        const a = buildWorldPlan();
        const b = buildWorldPlan();
        expect(a).toEqual(b);
    });

    it("every one of the 34 leaves gets exactly one plant spot", () => {
        const plan = buildWorldPlan();
        const leafIds = allLeafIds();
        expect(leafIds).toHaveLength(34);
        const placed = plan.regions.flatMap((r) => r.plants.map((p) => p.nodeId));
        expect(placed.sort()).toEqual(leafIds.sort());
        expect(new Set(placed).size).toBe(34);
    });

    it("plants are ≥3 tiles apart within each region", () => {
        // Authored sectors compose plots as tight as 3.0 tiles (docs/sectors/*); the legacy
        // serpentine fallback keeps ≥4. Three tiles (96px) still clears the ~1.4-tile sprites.
        const plan = buildWorldPlan();
        for (const region of plan.regions) {
            const plants = region.plants;
            for (let i = 0; i < plants.length; i++) {
                for (let j = i + 1; j < plants.length; j++) {
                    const dx = plants[i].tileX - plants[j].tileX;
                    const dy = plants[i].tileY - plants[j].tileY;
                    const d = Math.hypot(dx, dy);
                    expect(d).toBeGreaterThanOrEqual(3);
                }
            }
        }
    });

    it("every gate src/dst are real leaves", () => {
        const leafSet = new Set(allLeafIds());
        const plan = buildWorldPlan();
        for (const g of plan.gates) {
            expect(leafSet.has(g.src)).toBe(true);
            expect(leafSet.has(g.dst)).toBe(true);
        }
        expect(plan.gates.length).toBe(LEAF_PREREQ.length);
    });
});

describe("gateIsOpen", () => {
    const edge = { src: "BB.1A", dst: "BB.2A" };

    it("closed when src is not bloomed", () => {
        const stages = new Map<string, GrowthStage>([["BB.1A", "budding"]]);
        expect(gateIsOpen(edge, stages)).toBe(false);
    });

    it("open when src is bloomed", () => {
        const stages = new Map<string, GrowthStage>([["BB.1A", "bloomed"]]);
        expect(gateIsOpen(edge, stages)).toBe(true);
    });

    it("closed gate tile is solid; open gate tile is walkable", () => {
        const plan = buildWorldPlan();
        const gate = plan.gates[0];
        const closed = new Map<string, GrowthStage>();
        expect(tileIsSolid(plan, gate.tileX, gate.tileY, closed)).toBe(true);
        const open = new Map<string, GrowthStage>([[gate.src, "bloomed"]]);
        expect(tileIsSolid(plan, gate.tileX, gate.tileY, open)).toBe(false);
    });
});
