// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: adversarial softlock/edge-case QA for the movement/collision/teleport systems
// (2026-07-03). Pure logic only — no Phaser: everything is re-derived from buildWorldPlan()
// plus the collision helpers, mirroring the world scene's constants (feet at bottom-center,
// tile 32, world rim margins, base-box width caps).
//
// Scenarios pinned here (numbering from the QA brief):
//   1. spawn safety            5. plot frontage vs water
//   2. entrance sanity         6. moveWithSlide micro-edges (corner + overlap escape)
//   3. waystone arrival        7. water corner-sampling completeness
//   4. ford continuity
import { describe, expect, it } from "vitest";

import {
    baseBoxFor,
    boxesOverlap,
    firstOpenSpot,
    FOOT_H,
    FOOT_W,
    footBoxAt,
    moveWithSlide,
    type SolidBox,
} from "./collision";
import { sectorFor } from "./sectors/index";
import {
    buildWorldPlan,
    KEEPER_TILE,
    REGION_RECTS,
    type RegionPlan,
    TILE_SIZE,
    waterIsSolid,
    waystoneArrivalTiles,
    WORLD_HEIGHT_TILES,
    WORLD_WIDTH_TILES,
    type WorldPlan,
} from "./worldgen";

const TS = TILE_SIZE;
const plan: WorldPlan = buildWorldPlan();

function key(x: number, y: number): string {
    return `${x},${y}`;
}

function trailSet(r: RegionPlan): Set<string> {
    return new Set(r.trailTiles.map((t) => key(t.tileX, t.tileY)));
}

function inRect(r: RegionPlan, tx: number, ty: number): boolean {
    const { x, y, w, h } = r.rect;
    return tx >= x && tx < x + w && ty >= y && ty < y + h;
}

function inAnyRect(tx: number, ty: number): boolean {
    return REGION_RECTS.some((r) => tx >= r.x && tx < r.x + r.w && ty >= r.y && ty < r.y + r.h);
}

function blockedBy(boxes: SolidBox[]): (x: number, y: number) => boolean {
    return (x, y) => boxes.some((b) => boxesOverlap(footBoxAt(x, y), b));
}

// ---------------------------------------------------------------------------
// 1. SPAWN SAFETY — the avatar spawns beside the Keeper on the plaza seam.
// ---------------------------------------------------------------------------
describe("scenario 1 — spawn safety", () => {
    const spawnTile = { tileX: KEEPER_TILE.tileX + 2, tileY: KEEPER_TILE.tileY };
    const spawnX = spawnTile.tileX * TS + TS / 2;

    it("spawn tile is not water and not inside any region rect", () => {
        expect(waterIsSolid(plan, spawnTile.tileX, spawnTile.tileY)).toBe(false);
        expect(inAnyRect(spawnTile.tileX, spawnTile.tileY)).toBe(false);
    });

    it("spawn is clear of the Keeper's base box even at the 72px width cap", () => {
        // The Keeper's runtime display width is unknowable here, but baseBoxFor caps
        // every box at maxWidthPx (72 default ⇒ halfwidth ≤ 36). The scene passes
        // widthFactor 0.55 with the default cap, so 36 is the worst case.
        const keeperX = KEEPER_TILE.tileX * TS + TS / 2;
        const worstKeeperHalf = 36;
        const footHalf = FOOT_W / 2;
        expect(Math.abs(spawnX - keeperX)).toBeGreaterThanOrEqual(worstKeeperHalf + footHalf);
    });

    it("spawn is clear of the gazebo box (anchored 1.6 tiles above the Keeper line)", () => {
        // Gazebo: bottom at keeperY − 1.6·TS, heightPx 18, cap 120 (halfwidth ≤ 60).
        const kx = KEEPER_TILE.tileX * TS + TS / 2;
        const ky = KEEPER_TILE.tileY * TS + TS;
        const worstGazebo = baseBoxFor(kx, ky - 1.6 * TS, 10_000, {
            widthFactor: 0.7,
            heightPx: 18,
            maxWidthPx: 120,
        });
        const spawnFeet = footBoxAt(spawnX, KEEPER_TILE.tileY * TS + TS);
        expect(boxesOverlap(spawnFeet, worstGazebo)).toBe(false);
    });

    it("spawn tile is inside the world rim margins", () => {
        const sx = spawnX;
        const sy = KEEPER_TILE.tileY * TS + TS;
        expect(sx).toBeGreaterThan(10);
        expect(sx).toBeLessThan(WORLD_WIDTH_TILES * TS - 10);
        expect(sy).toBeGreaterThan(TS * 0.9);
        expect(sy).toBeLessThan(WORLD_HEIGHT_TILES * TS - 2);
    });
});

// ---------------------------------------------------------------------------
// 2. ENTRANCE SANITY — each authored sector's entrance must be a real doorway:
// on the trail, dry, and hugging the rect edge so the plaza connector reaches it.
// (The as-built world has no locked-region veils — renderSectorStones is explicit:
// "No lock, no veil" — so lock-reachability reduces to entrance sanity.)
// ---------------------------------------------------------------------------
describe("scenario 2 — sector entrances", () => {
    for (const r of plan.regions) {
        const layout = sectorFor(r.section)!;
        it(`${r.section}: entrance is on the trail, dry, and ≤2 tiles from the rect edge`, () => {
            const e = layout.entrance;
            expect(inRect(r, e.tileX, e.tileY)).toBe(true);
            expect(trailSet(r).has(key(e.tileX, e.tileY))).toBe(true);
            expect(waterIsSolid(plan, e.tileX, e.tileY)).toBe(false);
            const { x, y, w, h } = r.rect;
            const edgeDist = Math.min(
                e.tileX - x,
                x + w - 1 - e.tileX,
                e.tileY - y,
                y + h - 1 - e.tileY,
            );
            expect(edgeDist).toBeLessThanOrEqual(2);
        });
    }
});

// ---------------------------------------------------------------------------
// 3. WAYSTONE ARRIVAL — the fast-travel candidate list must always contain a
// tile that is inside the world, inside the region, dry, and not sitting on the
// waystone/plot/prop anchor itself. (BUG FOUND + FIXED: Versailles' waystone is
// at y=30 on a 32-tile world, so the old always-south probe had NO legal landing
// and teleported past the world rim anyway — a hard softlock. The candidate list
// now falls back NORTH, and the scene refuses to land when every probe fails.)
// ---------------------------------------------------------------------------
describe("scenario 3 — waystone arrival candidates", () => {
    for (const r of plan.regions) {
        it(`${r.section}: at least one candidate is in-world, in-rect, dry, and unoccupied`, () => {
            const anchors = new Set<string>([
                key(r.waystone.tileX, r.waystone.tileY),
                ...r.plants.map((p) => key(p.tileX, p.tileY)),
                ...r.props.map((p) => key(p.tileX, p.tileY)),
                ...r.hedges.map((h) => key(h.tileX, h.tileY)),
            ]);
            const good = waystoneArrivalTiles(r.waystone).filter((t) =>
                t.tileY >= 0
                && t.tileY < WORLD_HEIGHT_TILES
                && inRect(r, t.tileX, t.tileY)
                && !waterIsSolid(plan, t.tileX, t.tileY)
                && !anchors.has(key(t.tileX, t.tileY))
            );
            expect(good.length).toBeGreaterThanOrEqual(1);
        });
    }

    it("Versailles regression: every SOUTH candidate is past the world rim (north saves it)", () => {
        const versailles = plan.regions.find((r) => r.section === "C-P")!;
        const south = waystoneArrivalTiles(versailles.waystone).filter(
            (t) => t.tileY > versailles.waystone.tileY,
        );
        // This is WHY the always-south teleport softlocked: nothing south is in-world.
        for (const t of south) {
            expect(t.tileY).toBeGreaterThanOrEqual(WORLD_HEIGHT_TILES);
        }
    });

    it("firstOpenSpot returns null (stay put) when every candidate is blocked", () => {
        expect(firstOpenSpot([{ x: 1, y: 1 }, { x: 2, y: 2 }], () => true)).toBeNull();
        expect(firstOpenSpot([{ x: 1, y: 1 }], () => false)).toEqual({ x: 1, y: 1 });
    });
});

// ---------------------------------------------------------------------------
// 4. FORD CONTINUITY — every landGap crossing must lie ON the trail and connect
// two walkable trail tiles (banks or fellow gap tiles), so a crossing never
// dead-ends mid-water.
// ---------------------------------------------------------------------------
describe("scenario 4 — ford continuity", () => {
    for (const r of plan.regions) {
        if (r.landGaps.length === 0) {
            continue;
        }
        it(`${r.section}: each ford tile is on the trail with ≥2 walkable trail neighbors`, () => {
            const trail = trailSet(r);
            for (const g of r.landGaps) {
                expect(trail.has(key(g.tileX, g.tileY))).toBe(true);
                const neighbors = [
                    { tileX: g.tileX - 1, tileY: g.tileY },
                    { tileX: g.tileX + 1, tileY: g.tileY },
                    { tileX: g.tileX, tileY: g.tileY - 1 },
                    { tileX: g.tileX, tileY: g.tileY + 1 },
                ];
                const walkable = neighbors.filter(
                    (n) => trail.has(key(n.tileX, n.tileY)) && !waterIsSolid(plan, n.tileX, n.tileY),
                );
                expect(walkable.length).toBeGreaterThanOrEqual(2);
            }
        });
    }
});

// ---------------------------------------------------------------------------
// 5. PLOT FRONTAGE — every plot must have a dry trail tile beside it, or the
// player could never stand at watering range on the path.
// ---------------------------------------------------------------------------
describe("scenario 5 — plot frontage vs water", () => {
    for (const r of plan.regions) {
        it(`${r.section}: every plot is dry and has a dry orthogonal trail tile`, () => {
            const trail = trailSet(r);
            for (const p of r.plants) {
                expect(waterIsSolid(plan, p.tileX, p.tileY)).toBe(false);
                const frontages = [
                    { tileX: p.tileX - 1, tileY: p.tileY },
                    { tileX: p.tileX + 1, tileY: p.tileY },
                    { tileX: p.tileX, tileY: p.tileY - 1 },
                    { tileX: p.tileX, tileY: p.tileY + 1 },
                ].filter(
                    (n) => trail.has(key(n.tileX, n.tileY)) && !waterIsSolid(plan, n.tileX, n.tileY),
                );
                expect(frontages.length).toBeGreaterThanOrEqual(1);
            }
        });
    }
});

// ---------------------------------------------------------------------------
// 6. moveWithSlide MICRO-EDGES — convex corners and the overlap-escape rule.
// ---------------------------------------------------------------------------
describe("scenario 6 — moveWithSlide micro-edges", () => {
    const box: SolidBox = { left: 96, top: 96, w: 32, h: 32 };

    it("(a) pushing diagonally into a convex corner never penetrates, over many frames", () => {
        // Approach the NW corner from up-left, pressing down-right for 60 frames.
        let x = 80;
        let y = 92;
        const blocked = blockedBy([box]);
        for (let frame = 0; frame < 60; frame++) {
            const next = moveWithSlide(x, y, 4, 4, blocked);
            x = next.x;
            y = next.y;
            expect(boxesOverlap(footBoxAt(x, y), box)).toBe(false);
        }
    });

    it("(a) exact-corner diagonal (both axes blocked) stops without jitter", () => {
        // Feet kissing the corner on both axes: neither sub-step may commit.
        const blocked = blockedBy([box]);
        // x = 96 − FOOT_W/2 = 89 (right edge of feet at the box's left edge);
        // y = 96 (foot bottom at the box's top edge, box spans y−8..y).
        const start = { x: 96 - FOOT_W / 2, y: 96 };
        const out = moveWithSlide(start.x, start.y, 4, 4, blocked);
        expect(boxesOverlap(footBoxAt(out.x, out.y), box)).toBe(false);
        // No sneaking past the corner: still on the outside of both faces.
        expect(out.x).toBeLessThanOrEqual(96 + FOOT_W / 2);
        expect(out.y).toBeLessThanOrEqual(96 + FOOT_H);
    });

    it("(b) feet that START overlapped can walk out (escape rule), then blocking resumes", () => {
        // Regression state: something teleported/spawned the feet inside a solid.
        const blocked = blockedBy([box]);
        let x = 112; // dead center of the box
        let y = 116;
        expect(blocked(x, y)).toBe(true);
        // Walk right; the escape rule lets embedded feet move.
        for (let frame = 0; frame < 20 && blocked(x, y); frame++) {
            const next = moveWithSlide(x, y, 8, 0, blocked);
            expect(next.x).toBeGreaterThan(x); // never trapped
            x = next.x;
            y = next.y;
        }
        expect(blocked(x, y)).toBe(false); // fully escaped
        // Once free, walking back INTO the box is blocked again.
        const back = moveWithSlide(x, y, -8, 0, blocked);
        expect(boxesOverlap(footBoxAt(back.x, back.y), box)).toBe(false);
    });

    it("(b) escape works on the Y axis too", () => {
        const blocked = blockedBy([box]);
        let y = 116;
        for (let frame = 0; frame < 20 && blocked(112, y); frame++) {
            const next = moveWithSlide(112, y, 0, 8, blocked);
            expect(next.y).toBeGreaterThan(y);
            y = next.y;
        }
        expect(blocked(112, y)).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// 7. WATER CORNER SAMPLING — the scene probes only the foot box's 4 corners
// against the 32px water grid. That is COMPLETE because the box (14×8) is
// smaller than a tile on both axes: a 14px-wide box spans at most 2 tile
// columns and its left/right corners land in both; an 8px-tall box spans at
// most 2 tile rows and its top/bottom corners land in both. So every tile the
// box overlaps contains at least one corner — no water tile can hide between
// samples. The sweep below proves it exhaustively at 1px resolution: exact
// rect-vs-tile overlap never fires where corner sampling stays silent.
// ---------------------------------------------------------------------------
describe("scenario 7 — corner sampling has no false negatives vs a water tile", () => {
    it("sweeping the feet around a lone water tile, corner-detect ⊇ exact-overlap", () => {
        expect(FOOT_W).toBeLessThan(TS);
        expect(FOOT_H).toBeLessThan(TS);
        const waterTile = { tx: 4, ty: 4 }; // tile spans 128..160 on both axes
        const waterRect: SolidBox = { left: waterTile.tx * TS, top: waterTile.ty * TS, w: TS, h: TS };

        const cornerDetects = (x: number, y: number): boolean => {
            const f = footBoxAt(x, y);
            const corners = [
                { px: f.left, py: f.top },
                { px: f.left + f.w, py: f.top },
                { px: f.left, py: f.top + f.h },
                { px: f.left + f.w, py: f.top + f.h },
            ];
            return corners.some(
                (c) => Math.floor(c.px / TS) === waterTile.tx && Math.floor(c.py / TS) === waterTile.ty,
            );
        };

        for (let y = 100; y <= 200; y++) {
            for (let x = 100; x <= 200; x++) {
                if (boxesOverlap(footBoxAt(x, y), waterRect)) {
                    expect(cornerDetects(x, y)).toBe(true);
                }
            }
        }
    });
});
