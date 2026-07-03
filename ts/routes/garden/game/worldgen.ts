// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: deterministic overworld layout from graph-sidecar (doc 23 §6, §9.3).
// Pure logic — no Phaser. One continuous 2×2 quilt around a Keeper clearing. Each region is
// either an AUTHORED sector (docs/sectors/* → game/sectors/*) or, until authored, the legacy
// serpentine fallback below.
import type { GrowthStage } from "../state/stage";
import { dedupeTiles as dedupe, rasterizePath } from "./sectors/helpers";
import { sectorFor } from "./sectors/index";
import type { FieldFill, SectorDecor, SectorInteraction } from "./sectors/types";

import sidecarJson from "../../../lib/graph-sidecar.json" with { type: "json" };

export const TILE_SIZE = 32;
// A compact "Champions Island" overworld — a 2×2 region quilt you can cross in a
// handful of screens (Decision: smaller map, 2026-07-02) rather than the old sprawling
// 120×90 field. Trails wind (serpentine) so each region still holds all its plants.
export const WORLD_WIDTH_TILES = 56;
export const WORLD_HEIGHT_TILES = 40;

export type GardenSection = "P-S" | "B-B" | "C-P" | "CARS";

export interface TileCoord {
    tileX: number;
    tileY: number;
}

export interface RegionRect {
    section: GardenSection;
    x: number;
    y: number;
    w: number;
    h: number;
}

export interface PlantSpot {
    nodeId: string;
    tileX: number;
    tileY: number;
}

export interface PropSpot {
    key: string;
    tileX: number;
    tileY: number;
    /** Optional explicit display height in tiles (authored sectors); else the key default. */
    hTiles?: number;
}

export interface GateSpot {
    id: string;
    src: string;
    dst: string;
    tileX: number;
    tileY: number;
    orientation: "h" | "v";
}

export interface RegionPlan {
    section: GardenSection;
    rect: RegionRect;
    trailTiles: TileCoord[];
    waterTiles: TileCoord[];
    /** Walkable tiles inside water bounds (bridge decks, stepping stones). */
    landGaps: TileCoord[];
    plants: PlantSpot[];
    props: PropSpot[];
    /** Non-colliding authored decoration (bridges, hero trees, decals). */
    decor: SectorDecor[];
    /** Rectangular field fills (tulip ribbons, parterre beds). */
    fields: FieldFill[];
    /** Solid + rendered hedge tiles (authored parterre walls). */
    hedges: TileCoord[];
    /** Asset key rendered at each hedge tile. */
    hedgeKey: string;
    /** Walk-up flavor interactions. */
    interactions: SectorInteraction[];
    waystone: TileCoord;
    /** True when this region came from an authored sector layout (skip serpentine tweaks). */
    authored: boolean;
}

export interface WorldPlan {
    widthTiles: number;
    heightTiles: number;
    tileSize: number;
    regions: RegionPlan[];
    center: {
        keeperTile: TileCoord;
        plazaTiles: TileCoord[];
    };
    gates: GateSpot[];
    /** All walk-up interactions across the world (flattened for the world scene). */
    interactions: Array<SectorInteraction & { section: GardenSection }>;
}

interface SidecarNode {
    id: string;
    label: string;
    kind: string;
    parent: string | null;
    section: string;
    path?: string | null;
}

interface SidecarEdge {
    src: string;
    dst: string;
    kind: string;
}

const sidecar = sidecarJson as { nodes: SidecarNode[]; edges: SidecarEdge[] };

const LEAVES = sidecar.nodes.filter((n) => n.path);
const LEAF_IDS = new Set(LEAVES.map((n) => n.id));
const LEAVES_BY_SECTION = new Map<GardenSection, SidecarNode[]>();

for (const leaf of LEAVES) {
    const sec = leaf.section as GardenSection;
    const list = LEAVES_BY_SECTION.get(sec) ?? [];
    list.push(leaf);
    LEAVES_BY_SECTION.set(sec, list);
}
for (const [, list] of LEAVES_BY_SECTION) {
    list.sort((a, b) => a.id.localeCompare(b.id));
}

const LEAF_PREREQ = sidecar.edges.filter(
    (e) => e.kind === "prerequisite" && LEAF_IDS.has(e.src) && LEAF_IDS.has(e.dst),
);

/** §9.3 region quilt: Sakura NW · Keukenhof NE · Versailles SW · GBTB SE. */
export const REGION_RECTS: readonly RegionRect[] = [
    { section: "P-S", x: 0, y: 0, w: 26, h: 18 },
    { section: "B-B", x: 30, y: 0, w: 26, h: 18 },
    { section: "C-P", x: 0, y: 22, w: 26, h: 18 },
    { section: "CARS", x: 30, y: 22, w: 26, h: 18 },
];

/** The seam tiles (gap centres) between the four regions — the Keeper plaza sits here.
 * Shared by the terrain painter so region borders/decor/plaza stay in sync with layout. */
export const SPLIT_X = 28;
export const SPLIT_Y = 20;

export const CENTER_PLAZA = { x: 21, y: 15, w: 14, h: 10 };
export const KEEPER_TILE: TileCoord = { tileX: SPLIT_X, tileY: SPLIT_Y };

function tileKey(x: number, y: number): string {
    return `${x},${y}`;
}

function hashString(s: string): number {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

const REGION_MARGIN = 3;

/** Boustrophedon (snake) path winding through a compact region: a long walkable trail
 * in a small footprint — the Champions-Island look, and enough length that every region
 * still fits all its plants ≥4 tiles apart. */
function serpentineTrail(r: RegionRect, rowStep: number): TileCoord[] {
    const trail: TileCoord[] = [];
    const x0 = r.x + REGION_MARGIN;
    const x1 = r.x + r.w - 1 - REGION_MARGIN;
    const yTop = r.y + REGION_MARGIN;
    const yBot = r.y + r.h - 1 - REGION_MARGIN;
    let dir = 1;
    for (let y = yTop; y <= yBot; y += rowStep) {
        if (dir === 1) {
            for (let x = x0; x <= x1; x++) {
                trail.push({ tileX: x, tileY: y });
            }
        } else {
            for (let x = x1; x >= x0; x--) {
                trail.push({ tileX: x, tileY: y });
            }
        }
        // Vertical connector to the next row keeps the path continuous.
        const endX = dir === 1 ? x1 : x0;
        for (let yy = y + 1; yy <= Math.min(y + rowStep, yBot); yy++) {
            trail.push({ tileX: endX, tileY: yy });
        }
        dir = -dir;
    }
    return trail;
}

/** Compact per-theme water feature (rendered with shorelines by the terrain painter). */
function regionWater(section: GardenSection, r: RegionRect): TileCoord[] {
    const water: TileCoord[] = [];
    const disc = (cx: number, cy: number, rr: number): void => {
        const c = Math.ceil(rr);
        for (let dy = -c; dy <= c; dy++) {
            for (let dx = -c; dx <= c; dx++) {
                if (dx * dx + dy * dy <= rr * rr) {
                    water.push({ tileX: cx + dx, tileY: cy + dy });
                }
            }
        }
    };
    switch (section) {
        case "P-S":
            // Koi pond tucked in a corner.
            disc(r.x + r.w - 6, r.y + r.h - 6, 2.4);
            break;
        case "B-B": {
            // A short canal down the near edge.
            const canalX = r.x + 4;
            for (let y = r.y + 3; y <= r.y + r.h - 4; y++) {
                water.push({ tileX: canalX, tileY: y });
            }
            break;
        }
        case "C-P":
            // Grand-canal strip near the foot of the parterre.
            for (let x = r.x + 4; x <= r.x + r.w - 5; x++) {
                water.push({ tileX: x, tileY: r.y + r.h - 4 });
            }
            break;
        case "CARS":
            // Two mist lagoons.
            disc(r.x + 6, r.y + 5, 2.0);
            disc(r.x + r.w - 7, r.y + r.h - 6, 2.4);
            break;
        default: {
            const _exhaustive: never = section;
            return _exhaustive;
        }
    }
    return water;
}

function trailForSection(section: GardenSection, rect: RegionRect): {
    trail: TileCoord[];
    water: TileCoord[];
} {
    const rowStep = section === "P-S" ? 4 : section === "CARS" ? 6 : 5;
    const water = regionWater(section, rect);
    const wset = new Set(water.map((w) => tileKey(w.tileX, w.tileY)));
    // Keep the trail off water so paths never run through a pond.
    const trail = serpentineTrail(rect, rowStep).filter(
        (t) => !wset.has(tileKey(t.tileX, t.tileY)),
    );
    return { trail, water };
}

function dedupeTiles(tiles: TileCoord[]): TileCoord[] {
    const seen = new Set<string>();
    const out: TileCoord[] = [];
    for (const t of tiles) {
        const k = tileKey(t.tileX, t.tileY);
        if (!seen.has(k)) {
            seen.add(k);
            out.push(t);
        }
    }
    return out;
}

function propsForRegion(section: GardenSection, rect: RegionRect): PropSpot[] {
    const props: PropSpot[] = [];
    const cx = rect.x + Math.floor(rect.w / 2);
    const cy = rect.y + Math.floor(rect.h / 2);

    switch (section) {
        case "P-S":
            props.push(
                { key: "prop-sakura-cherry-tree", tileX: rect.x + 5, tileY: rect.y + 5 },
                { key: "prop-sakura-lantern-a", tileX: cx - 5, tileY: cy - 3 },
                { key: "prop-sakura-lantern-b", tileX: cx + 5, tileY: cy - 3 },
                { key: "struct-bridge-sakura", tileX: cx, tileY: rect.y + rect.h - 5 },
            );
            break;
        case "B-B":
            props.push(
                { key: "prop-keukenhof-10", tileX: rect.x + 7, tileY: rect.y + 5 },
                { key: "prop-keukenhof-36", tileX: rect.x + 8, tileY: rect.y + rect.h - 5 },
                {
                    key: "struct-landmark-keukenhof-windmill",
                    tileX: rect.x + rect.w - 6,
                    tileY: rect.y + 5,
                },
            );
            break;
        case "C-P":
            props.push(
                { key: "struct-landmark-versailles-fountain", tileX: cx, tileY: rect.y + 4 },
                { key: "prop-versailles-r0-03", tileX: rect.x + 5, tileY: cy - 4 },
                { key: "prop-versailles-sig-01", tileX: rect.x + rect.w - 6, tileY: cy + 4 },
            );
            break;
        case "CARS":
            props.push(
                { key: "struct-landmark-gardens-supertrees", tileX: cx - 5, tileY: cy - 5 },
                { key: "prop-gardens-by-the-bay-09", tileX: cx + 6, tileY: cy + 5 },
            );
            break;
        default: {
            const _exhaustive: never = section;
            return _exhaustive;
        }
    }
    return props;
}

function placePlantsAlongTrail(
    leaves: SidecarNode[],
    trail: TileCoord[],
): PlantSpot[] {
    if (leaves.length === 0 || trail.length === 0) {
        return [];
    }
    const minSpacing = 4;
    const plants: PlantSpot[] = [];
    const start = hashString(leaves.map((l) => l.id).join("|")) % Math.max(1, minSpacing);

    for (let li = 0; li < leaves.length; li++) {
        const leaf = leaves[li];
        let placed = false;
        for (let i = start + li * minSpacing; i < trail.length; i++) {
            const t = trail[i];
            const ok = plants.every(
                (p) => Math.hypot(p.tileX - t.tileX, p.tileY - t.tileY) >= minSpacing,
            );
            if (ok) {
                plants.push({ nodeId: leaf.id, tileX: t.tileX, tileY: t.tileY });
                placed = true;
                break;
            }
        }
        if (!placed) {
            for (let i = 0; i < trail.length; i++) {
                const t = trail[i];
                const ok = plants.every(
                    (p) => Math.hypot(p.tileX - t.tileX, p.tileY - t.tileY) >= minSpacing,
                );
                if (ok) {
                    plants.push({ nodeId: leaf.id, tileX: t.tileX, tileY: t.tileY });
                    break;
                }
            }
        }
    }
    return plants;
}

function borderCrossing(a: GardenSection, b: GardenSection): TileCoord {
    // Cross-region gates sit on the plaza rim between quadrants (§6.3), derived from the
    // shared seam so they track the compact layout.
    const pair = [a, b].sort().join("|");
    // Vertically-adjacent columns share the horizontal seam; horizontally-adjacent
    // rows share the vertical seam; diagonals meet near the Keeper plaza.
    if (pair === "B-B|P-S") {
        return { tileX: SPLIT_X, tileY: 6 }; // top edge, between the two top regions
    }
    if (pair === "C-P|CARS") {
        return { tileX: SPLIT_X, tileY: WORLD_HEIGHT_TILES - 6 };
    }
    if (pair === "C-P|P-S") {
        return { tileX: 6, tileY: SPLIT_Y };
    }
    if (pair === "B-B|CARS") {
        return { tileX: WORLD_WIDTH_TILES - 6, tileY: SPLIT_Y };
    }
    if (pair === "B-B|C-P") {
        return { tileX: SPLIT_X - 2, tileY: SPLIT_Y - 2 };
    }
    if (pair === "CARS|P-S") {
        return { tileX: SPLIT_X + 2, tileY: SPLIT_Y - 2 };
    }
    return { tileX: SPLIT_X, tileY: SPLIT_Y };
}

function nodeSection(nodeId: string): GardenSection {
    const n = sidecar.nodes.find((x) => x.id === nodeId);
    return (n?.section ?? "P-S") as GardenSection;
}

function gateBetweenPlants(
    edge: { src: string; dst: string },
    plantsById: Map<string, PlantSpot>,
): GateSpot {
    const srcPlant = plantsById.get(edge.src);
    const dstPlant = plantsById.get(edge.dst);
    const srcSec = nodeSection(edge.src);
    const dstSec = nodeSection(edge.dst);

    let tile: TileCoord;
    let orientation: "h" | "v" = "h";

    if (srcSec !== dstSec) {
        tile = borderCrossing(srcSec, dstSec);
    } else if (srcPlant && dstPlant) {
        tile = {
            tileX: Math.round((srcPlant.tileX + dstPlant.tileX) / 2),
            tileY: Math.round((srcPlant.tileY + dstPlant.tileY) / 2),
        };
        orientation = Math.abs(srcPlant.tileX - dstPlant.tileX)
                > Math.abs(srcPlant.tileY - dstPlant.tileY)
            ? "v"
            : "h";
    } else {
        tile = { tileX: KEEPER_TILE.tileX, tileY: KEEPER_TILE.tileY };
    }

    return {
        id: `gate-${edge.src}-${edge.dst}`,
        src: edge.src,
        dst: edge.dst,
        tileX: tile.tileX,
        tileY: tile.tileY,
        orientation,
    };
}

function plazaTiles(): TileCoord[] {
    const tiles: TileCoord[] = [];
    for (let y = CENTER_PLAZA.y; y < CENTER_PLAZA.y + CENTER_PLAZA.h; y++) {
        for (let x = CENTER_PLAZA.x; x < CENTER_PLAZA.x + CENTER_PLAZA.w; x++) {
            tiles.push({ tileX: x, tileY: y });
        }
    }
    return tiles;
}

function serpentineRegion(rect: RegionRect, plantsById: Map<string, PlantSpot>): RegionPlan {
    const { trail, water } = trailForSection(rect.section, rect);
    const trailTiles = dedupeTiles(trail);
    const waterTiles = dedupeTiles(water);
    const leaves = LEAVES_BY_SECTION.get(rect.section) ?? [];
    const plants = placePlantsAlongTrail(leaves, trailTiles);
    for (const p of plants) {
        plantsById.set(p.nodeId, p);
    }
    return {
        section: rect.section,
        rect,
        trailTiles,
        waterTiles,
        landGaps: [],
        plants,
        props: propsForRegion(rect.section, rect),
        decor: [],
        fields: [],
        hedges: [],
        hedgeKey: "foliage-versailles-20",
        interactions: [],
        waystone: { tileX: rect.x + Math.floor(rect.w / 2), tileY: rect.y + rect.h - 3 },
        authored: false,
    };
}

/** Build an authored region from its hand-composed sector layout (docs/sectors/*). */
function authoredRegion(rect: RegionRect, plantsById: Map<string, PlantSpot>): RegionPlan {
    const layout = sectorFor(rect.section)!;
    // Trail = rasterized path polylines + the land-gap crossings (always walkable).
    const trailTiles = dedupe([
        ...layout.pathWaypoints.flatMap((wp) => rasterizePath(wp)),
        ...layout.landGaps,
    ]);
    // Water = authored water tiles (land-gaps stay water for PAINTING; collision skips them).
    const waterTiles = dedupe(layout.waterTiles);
    const plants: PlantSpot[] = layout.plots.map((p) => ({
        nodeId: p.nodeId,
        tileX: p.tileX,
        tileY: p.tileY,
    }));
    for (const p of plants) {
        plantsById.set(p.nodeId, p);
    }
    return {
        section: rect.section,
        rect,
        trailTiles,
        waterTiles,
        landGaps: dedupe(layout.landGaps),
        plants,
        props: layout.props.map((p) => ({
            key: p.key,
            tileX: p.tileX,
            tileY: p.tileY,
            hTiles: p.hTiles,
        })),
        decor: layout.decor,
        fields: layout.fields,
        hedges: dedupe(layout.hedges ?? []),
        hedgeKey: layout.hedgeKey ?? "foliage-versailles-20",
        interactions: layout.interactions,
        waystone: layout.waystone,
        authored: true,
    };
}

/** Build the full overworld plan deterministically from the sidecar + authored sectors. */
export function buildWorldPlan(): WorldPlan {
    const plantsById = new Map<string, PlantSpot>();
    const regions: RegionPlan[] = [];

    for (const rect of REGION_RECTS) {
        regions.push(
            sectorFor(rect.section)
                ? authoredRegion(rect, plantsById)
                : serpentineRegion(rect, plantsById),
        );
    }

    // Authored in-region gate positions override the derived midpoint; every leaf prereq edge
    // still gets exactly one gate (cross-region + un-authored edges use gateBetweenPlants).
    const authoredGates = new Map<string, GateSpot>();
    for (const rect of REGION_RECTS) {
        const layout = sectorFor(rect.section);
        if (!layout) {
            continue;
        }
        for (const g of layout.gates) {
            authoredGates.set(`${g.src}->${g.dst}`, {
                id: `gate-${g.src}-${g.dst}`,
                src: g.src,
                dst: g.dst,
                tileX: g.tileX,
                tileY: g.tileY,
                orientation: g.orientation,
            });
        }
    }
    const gates = LEAF_PREREQ.map(
        (e) => authoredGates.get(`${e.src}->${e.dst}`) ?? gateBetweenPlants(e, plantsById),
    );

    const interactions = regions.flatMap((r) => r.interactions.map((i) => ({ ...i, section: r.section })));

    return {
        widthTiles: WORLD_WIDTH_TILES,
        heightTiles: WORLD_HEIGHT_TILES,
        tileSize: TILE_SIZE,
        regions,
        center: {
            keeperTile: KEEPER_TILE,
            plazaTiles: plazaTiles(),
        },
        gates,
        interactions,
    };
}

/** §6.3 — gate opens when prerequisite topic has bloomed. */
export function gateIsOpen(
    edge: { src: string; dst: string },
    stageByNode: Map<string, GrowthStage>,
): boolean {
    return stageByNode.get(edge.src) === "bloomed";
}

export function plantSpotByNode(plan: WorldPlan, nodeId: string): PlantSpot | undefined {
    for (const r of plan.regions) {
        const p = r.plants.find((x) => x.nodeId === nodeId);
        if (p) {
            return p;
        }
    }
    return undefined;
}

export function hedgeTilesForRegion(rect: RegionRect): TileCoord[] {
    if (rect.section !== "C-P") {
        return [];
    }
    const hedges: TileCoord[] = [];
    for (let x = rect.x + 2; x < rect.x + rect.w - 2; x++) {
        hedges.push({ tileX: x, tileY: rect.y + 2 });
        hedges.push({ tileX: x, tileY: rect.y + rect.h - 3 });
    }
    return hedges;
}

/** Collision: water/hedge/prop solid; trail+grass+land-gaps walkable; closed gates solid. */
export function tileIsSolid(
    plan: WorldPlan,
    tileX: number,
    tileY: number,
    stageByNode: Map<string, GrowthStage>,
): boolean {
    // A closed gate is solid; an open one is walkable — checked first so a gate on a bridge
    // (a land-gap over water) reads correctly.
    for (const g of plan.gates) {
        if (g.tileX === tileX && g.tileY === tileY) {
            return !gateIsOpen(g, stageByNode);
        }
    }

    for (const r of plan.regions) {
        // Land-gaps (bridge decks / stepping stones) are walkable even though painted as water.
        const isGap = r.landGaps.some((g) => g.tileX === tileX && g.tileY === tileY);
        if (isGap) {
            continue;
        }
        for (const w of r.waterTiles) {
            if (w.tileX === tileX && w.tileY === tileY) {
                return true;
            }
        }
        for (const p of r.props) {
            if (p.tileX === tileX && p.tileY === tileY) {
                return true;
            }
        }
        // Authored regions carry their own hedge tiles; the fallback derives them from the rect.
        const hedges = r.authored ? r.hedges : hedgeTilesForRegion(r.rect);
        for (const h of hedges) {
            if (h.tileX === tileX && h.tileY === tileY) {
                return true;
            }
        }
    }

    return false;
}

export function allLeafIds(): string[] {
    return LEAVES.map((n) => n.id).sort();
}

export { LEAF_PREREQ, LEAVES };
