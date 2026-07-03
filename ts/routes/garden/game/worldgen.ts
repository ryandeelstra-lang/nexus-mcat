// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: deterministic overworld layout from graph-sidecar (doc 23 §6, §9.3).
// Pure logic — no Phaser. One continuous 2×2 quilt around a Keeper clearing.
import type { GrowthStage } from "../state/stage";

import sidecarJson from "../../../lib/graph-sidecar.json" with { type: "json" };

export const TILE_SIZE = 32;
export const WORLD_WIDTH_TILES = 120;
export const WORLD_HEIGHT_TILES = 90;

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
    plants: PlantSpot[];
    props: PropSpot[];
    waystone: TileCoord;
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
    { section: "P-S", x: 0, y: 0, w: 58, h: 42 },
    { section: "B-B", x: 62, y: 0, w: 58, h: 42 },
    { section: "C-P", x: 0, y: 48, w: 58, h: 42 },
    { section: "CARS", x: 62, y: 48, w: 58, h: 42 },
];

export const CENTER_PLAZA = { x: 45, y: 32, w: 30, h: 26 };
export const KEEPER_TILE: TileCoord = { tileX: 60, tileY: 45 };

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

function inRect(x: number, y: number, r: RegionRect): boolean {
    return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
}

function dist(a: TileCoord, b: TileCoord): number {
    return Math.hypot(a.tileX - b.tileX, a.tileY - b.tileY);
}

/** Sakura: stream spine + winding path (§6.2, §9.3). */
function trailSakura(r: RegionRect): { trail: TileCoord[]; water: TileCoord[] } {
    const trail: TileCoord[] = [];
    const water: TileCoord[] = [];
    const streamY = r.y + Math.floor(r.h * 0.55);
    for (let x = r.x + 2; x < r.x + r.w - 2; x++) {
        const wobble = Math.round(Math.sin((x - r.x) * 0.35) * 2);
        water.push({ tileX: x, tileY: streamY + wobble });
        water.push({ tileX: x, tileY: streamY + wobble + 1 });
        trail.push({ tileX: x, tileY: streamY + wobble - 3 });
    }
    // Bridge crossing at mid-region
    const bx = r.x + Math.floor(r.w / 2);
    for (let dy = -2; dy <= 2; dy++) {
        trail.push({ tileX: bx, tileY: streamY + dy - 3 });
    }
    return { trail, water };
}

/** Keukenhof: canal-side winding path (§9.3). */
function trailKeukenhof(r: RegionRect): { trail: TileCoord[]; water: TileCoord[] } {
    const trail: TileCoord[] = [];
    const water: TileCoord[] = [];
    const canalX = r.x + Math.floor(r.w * 0.35);
    for (let y = r.y + 2; y < r.y + r.h - 2; y++) {
        water.push({ tileX: canalX, tileY: y });
        water.push({ tileX: canalX + 1, tileY: y });
        const offset = Math.round(Math.sin(y * 0.4) * 2);
        trail.push({ tileX: canalX + 4 + offset, tileY: y });
    }
    return { trail, water };
}

/** Versailles: formal symmetric allée grid (§9.3). */
function trailVersailles(r: RegionRect): { trail: TileCoord[]; water: TileCoord[] } {
    const trail: TileCoord[] = [];
    const water: TileCoord[] = [];
    const cx = r.x + Math.floor(r.w / 2);
    const cy = r.y + Math.floor(r.h / 2);
    for (let x = r.x + 2; x < r.x + r.w - 2; x++) {
        trail.push({ tileX: x, tileY: cy });
    }
    for (let y = r.y + 2; y < r.y + r.h - 2; y++) {
        trail.push({ tileX: cx, tileY: y });
    }
    // Grand canal strip
    for (let x = r.x + 4; x < r.x + r.w - 4; x++) {
        water.push({ tileX: x, tileY: r.y + r.h - 4 });
    }
    return { trail, water };
}

/** Gardens by the Bay: elevated boardwalk / skyway (§9.3). */
function trailGbtb(r: RegionRect): { trail: TileCoord[]; water: TileCoord[] } {
    const trail: TileCoord[] = [];
    const water: TileCoord[] = [];
    const walkY = r.y + Math.floor(r.h * 0.45);
    for (let x = r.x + 2; x < r.x + r.w - 2; x++) {
        trail.push({ tileX: x, tileY: walkY });
    }
    // Mist pools beneath the skyway
    for (let x = r.x + 6; x < r.x + r.w - 6; x += 3) {
        water.push({ tileX: x, tileY: walkY + 3 });
    }
    return { trail, water };
}

function trailForSection(section: GardenSection, rect: RegionRect): {
    trail: TileCoord[];
    water: TileCoord[];
} {
    switch (section) {
        case "P-S":
            return trailSakura(rect);
        case "B-B":
            return trailKeukenhof(rect);
        case "C-P":
            return trailVersailles(rect);
        case "CARS":
            return trailGbtb(rect);
        default: {
            const _exhaustive: never = section;
            return _exhaustive;
        }
    }
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

function regionThemeKey(section: GardenSection): string {
    switch (section) {
        case "P-S":
            return "sakura";
        case "B-B":
            return "keukenhof";
        case "C-P":
            return "versailles";
        case "CARS":
            return "gardens-by-the-bay";
        default: {
            const _exhaustive: never = section;
            return _exhaustive;
        }
    }
}

function propsForRegion(section: GardenSection, rect: RegionRect): PropSpot[] {
    const theme = regionThemeKey(section);
    const props: PropSpot[] = [];
    const cx = rect.x + Math.floor(rect.w / 2);
    const cy = rect.y + Math.floor(rect.h / 2);

    switch (section) {
        case "P-S":
            props.push(
                { key: "prop-sakura-cherry-tree", tileX: rect.x + 8, tileY: rect.y + 6 },
                { key: "prop-sakura-lantern-a", tileX: cx - 6, tileY: cy - 4 },
                { key: "prop-sakura-lantern-b", tileX: cx + 6, tileY: cy - 4 },
                { key: "prop-sakura-bridge", tileX: cx, tileY: cy + 2 },
            );
            break;
        case "B-B":
            props.push(
                { key: `prop-${theme}-tulip-00`, tileX: rect.x + 10, tileY: rect.y + 8 },
                { key: `prop-${theme}-tulip-01`, tileX: rect.x + 14, tileY: rect.y + 10 },
                { key: `prop-${theme}-windmill`, tileX: rect.x + rect.w - 10, tileY: rect.y + 6 },
            );
            break;
        case "C-P":
            props.push(
                { key: `prop-${theme}-fountain`, tileX: cx, tileY: rect.y + 4 },
                { key: `prop-${theme}-statue`, tileX: rect.x + 8, tileY: cy },
                { key: `prop-${theme}-hedge`, tileX: rect.x + 4, tileY: cy - 6 },
            );
            break;
        case "CARS":
            props.push(
                { key: `prop-${theme}-supertree`, tileX: cx - 8, tileY: cy - 2 },
                { key: `prop-${theme}-supertree`, tileX: cx + 8, tileY: cy - 2 },
                { key: `prop-${theme}-glow`, tileX: cx, tileY: cy },
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
    // Cross-region gates sit on plaza rim between quadrants (§6.3).
    const pair = [a, b].sort().join("|");
    if (pair === "B-B|C-P") {
        return { tileX: 58, tileY: 44 };
    }
    if (pair === "B-B|P-S" || pair === "C-P|P-S") {
        return { tileX: 58, tileY: 38 };
    }
    if (pair === "B-B|CARS" || pair === "C-P|CARS") {
        return { tileX: 58, tileY: 52 };
    }
    if (pair === "CARS|P-S") {
        return { tileX: 60, tileY: 40 };
    }
    return { tileX: 60, tileY: 45 };
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

/** Build the full overworld plan deterministically from the sidecar. */
export function buildWorldPlan(): WorldPlan {
    const plantsById = new Map<string, PlantSpot>();
    const regions: RegionPlan[] = [];

    for (const rect of REGION_RECTS) {
        const { trail, water } = trailForSection(rect.section, rect);
        const trailTiles = dedupeTiles(trail);
        const waterTiles = dedupeTiles(water);
        const leaves = LEAVES_BY_SECTION.get(rect.section) ?? [];
        const plants = placePlantsAlongTrail(leaves, trailTiles);
        for (const p of plants) {
            plantsById.set(p.nodeId, p);
        }
        const waystone = {
            tileX: rect.x + Math.floor(rect.w / 2),
            tileY: rect.y + rect.h - 3,
        };
        regions.push({
            section: rect.section,
            rect,
            trailTiles,
            waterTiles,
            plants,
            props: propsForRegion(rect.section, rect),
            waystone,
        });
    }

    const gates = LEAF_PREREQ.map((e) => gateBetweenPlants(e, plantsById));

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

function hedgeTilesForRegion(rect: RegionRect): TileCoord[] {
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

/** Collision: water/hedge/prop solid; trail+grass walkable; closed gates solid. */
export function tileIsSolid(
    plan: WorldPlan,
    tileX: number,
    tileY: number,
    stageByNode: Map<string, GrowthStage>,
): boolean {
    for (const r of plan.regions) {
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
        for (const h of hedgeTilesForRegion(r.rect)) {
            if (h.tileX === tileX && h.tileY === tileY) {
                return true;
            }
        }
    }

    for (const g of plan.gates) {
        if (g.tileX === tileX && g.tileY === tileY) {
            return !gateIsOpen(g, stageByNode);
        }
    }
    return false;
}

export function allLeafIds(): string[] {
    return LEAVES.map((n) => n.id).sort();
}

export { LEAF_PREREQ, LEAVES };
