// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: the ground-flora system (watering redesign, 2026-07-03). Every grass tile
// carries a PRESET flower chosen by an authored per-region banding scheme, so a fully
// watered stretch reads as designed color lines, never confetti:
//   Sakura (NW)     — bands parallel to the stream (distance-to-water): lines of one color
//                     tracing the shore.
//   Keukenhof (NE)  — horizontal tulip-field ribbons (two-row bands of one species).
//   Versailles (SW) — formal rings around the Fountain Court, mirrored by construction.
//   Gardens (SE)    — glowing orchid drifts clustered by seeded noise.
//
// Watering is bone-meal-like: each tile tracks how many pours it has received; a tile
// blooms after its own watersNeeded (3–7, deterministic per tile). One pour splashes a
// 3×3: the AIMED tile (where the can points) gets +2, the ring +1 — so the spot you tend
// blooms first and its surroundings wake as sprouts/buds.
//
// PURE logic — no Phaser. Rendering/animation live in flora-layer.ts. Cosmetic only:
// flora never touches engine truth, plots, or the economy ledger (I1/I4/I5 — the pour
// spend stays owned by the panel layer).

import { plazaField, sampleDT, type TerrainModel } from "./terrain";
import { type GardenSection, KEEPER_TILE, type RegionPlan, TILE_SIZE, type WorldPlan } from "./worldgen";

/** Deterministic tile hash (same recipe as terrain.ts, kept local so flora stands alone). */
export function floraHash(x: number, y: number, seed: number): number {
    let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed, 1440662683);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// ---------------------------------------------------------------------------
// Config — every knob in one place (tuning never touches logic).
// ---------------------------------------------------------------------------

export const FLORA_CONFIG = {
    /** Pours a tile needs to bloom: min + hash-spread up to max (inclusive). */
    minWaters: 3,
    maxWaters: 7,
    /** Progress granted to the aimed tile per pour. */
    aimBoost: 2,
    /** Progress granted to the surrounding splash ring per pour. */
    splashBoost: 1,
    /** Chebyshev splash radius in tiles (1 → the 3×3 around the aim). */
    splashRadius: 1,
    /** Fraction of watersNeeded at/above which a flower shows its bud. */
    budFraction: 0.5,
    /** Clearance (tiles) kept around plots / props / structures. */
    clearance: 1.0,
    /** Distance-to-water below which a tile is shore/water, not grass. */
    waterClearTiles: 1.25,
    /** Distance-to-trail below which a tile is path. Deliberately snug (0.7): flowers
     * hug the promenade edges — the cottage-garden look — without sitting on the walkway. */
    trailClearTiles: 0.7,
    /** Plaza-field value below which a tile belongs to the Keeper plaza. */
    plazaClear: 1.15,
} as const;

export type FloraStage = "none" | "sprout" | "bud" | "bloom";

export interface FlowerSpecies {
    id: string;
    /** Bloom sprite — real sliced art (existence is test-guarded). */
    assetKey: string;
    /** Petal/bud tint for the generated bud texture + burst fx. */
    tint: number;
    /** Bloom display height in tiles (aspect preserved). */
    hTiles: number;
}

export interface FlowerSpot {
    tileX: number;
    tileY: number;
    section: GardenSection;
    species: FlowerSpecies;
    /** Pours needed to bloom (3–7, deterministic per tile). */
    watersNeeded: number;
    /** Cohesion band this spot belongs to (`section:index`). */
    bandId: string;
}

export interface FloraLayout {
    spots: Map<string, FlowerSpot>;
    /** bandId -> spot keys, for completion checks + celebrations. */
    bands: Map<string, string[]>;
}

/** Watered-count record persisted in the additive garden store ("x,y" -> pours). */
export type FloraCounts = Record<string, number>;

export function floraKey(tileX: number, tileY: number): string {
    return `${tileX},${tileY}`;
}

// ---------------------------------------------------------------------------
// Species tables — real art per region, colors chosen for readable lines.
// ---------------------------------------------------------------------------

const SAKURA_BANDS: FlowerSpecies[] = [
    // Nearest the stream outward: pink blossom → rose pair → white sprinkle → pink-tip →
    // fern meadow, so the shoreline reads as parallel same-color lines.
    { id: "sakura-blossom", assetKey: "prop-sakura-flowers-02", tint: 0xf2a9c4, hTiles: 0.55 },
    { id: "sakura-rose-pair", assetKey: "prop-sakura-flowers-01", tint: 0xe87ea1, hTiles: 0.5 },
    { id: "sakura-white", assetKey: "prop-sakura-flowers-04", tint: 0xf2eee4, hTiles: 0.45 },
    { id: "sakura-pinktip", assetKey: "prop-sakura-flowers-00", tint: 0xe87ea1, hTiles: 0.55 },
    { id: "sakura-fern", assetKey: "prop-sakura-flowers-03", tint: 0xc4dba4, hTiles: 0.45 },
];

const KEUKENHOF_BANDS: FlowerSpecies[] = [
    // Two-row ribbons cycling the classic Dutch field colors.
    { id: "hyacinth-red", assetKey: "prop-keukenhof-28", tint: 0xd8484a, hTiles: 0.6 },
    { id: "hyacinth-white", assetKey: "prop-keukenhof-22", tint: 0xf2f2e4, hTiles: 0.6 },
    { id: "hyacinth-purple", assetKey: "prop-keukenhof-21", tint: 0xb76bd1, hTiles: 0.6 },
    { id: "hyacinth-blue", assetKey: "prop-keukenhof-23", tint: 0x5a7bd8, hTiles: 0.6 },
];

const VERSAILLES_BANDS: FlowerSpecies[] = [
    // Formal rose rings around the Fountain Court — cream, blush, crimson.
    { id: "rose-cream", assetKey: "foliage-versailles-26", tint: 0xf2e6c4, hTiles: 0.65 },
    { id: "rose-blush", assetKey: "foliage-versailles-27", tint: 0xe7a0b4, hTiles: 0.65 },
    { id: "rose-crimson", assetKey: "foliage-versailles-29", tint: 0xd06276, hTiles: 0.65 },
];

const GARDENS_BANDS: FlowerSpecies[] = [
    // Night-garden orchid drifts (noise-clustered patches, not lines).
    { id: "orchid-violet", assetKey: "prop-gardens-by-the-bay-18", tint: 0x8a5cf6, hTiles: 0.6 },
    { id: "orchid-pink", assetKey: "prop-gardens-by-the-bay-14", tint: 0xd873c9, hTiles: 0.6 },
    { id: "orchid-ember", assetKey: "prop-gardens-by-the-bay-11", tint: 0x3e9c8b, hTiles: 0.55 },
];

const SPECIES_BY_SECTION: Record<GardenSection, FlowerSpecies[]> = {
    "P-S": SAKURA_BANDS,
    "B-B": KEUKENHOF_BANDS,
    "C-P": VERSAILLES_BANDS,
    "CARS": GARDENS_BANDS,
};

/** All species (asset-key guard tests iterate this). */
export function allFloraSpecies(): FlowerSpecies[] {
    return [...SAKURA_BANDS, ...KEUKENHOF_BANDS, ...VERSAILLES_BANDS, ...GARDENS_BANDS];
}

// ---------------------------------------------------------------------------
// Banding — the cohesion scheme per region.
// ---------------------------------------------------------------------------

/** Width (in tiles) of one Sakura shoreline band. */
const SAKURA_BAND_TILES = 1.6;

/** Versailles rings center on the fountain landmark (derived, not hardcoded, so the
 * sector can be re-authored without touching flora). */
function ringCenterFor(region: RegionPlan): { tileX: number; tileY: number } {
    const fountain = region.props.find((p) => p.key.includes("fountain"));
    if (fountain) {
        return { tileX: fountain.tileX, tileY: fountain.tileY };
    }
    return {
        tileX: region.rect.x + Math.floor(region.rect.w / 2),
        tileY: region.rect.y + Math.floor(region.rect.h / 2),
    };
}

function bandIndexFor(
    region: RegionPlan,
    tileX: number,
    tileY: number,
    model: TerrainModel,
): number {
    const px = (tileX + 0.5) * TILE_SIZE;
    const py = (tileY + 0.5) * TILE_SIZE;
    switch (region.section) {
        case "P-S": {
            // Lines parallel to the stream: bucket the distance-to-water field.
            const wd = sampleDT(model.waterDT, model.gw, model.gh, px, py);
            return Math.floor(wd / (SAKURA_BAND_TILES * TILE_SIZE));
        }
        case "B-B":
            // Horizontal tulip ribbons, two rows tall.
            return Math.floor(tileY / 2);
        case "C-P": {
            // Concentric formal rings around the fountain (Chebyshev = square rings,
            // mirrored across both axes by construction).
            const center = ringCenterFor(region);
            const ring = Math.max(
                Math.abs(tileX - center.tileX),
                Math.abs(tileY - center.tileY),
            );
            return Math.floor(ring / 2);
        }
        case "CARS":
            // Seeded-noise drifts → organic single-species patches.
            return Math.floor(floraHash(tileX >> 2, tileY >> 2, 907) * GARDENS_BANDS.length);
        default: {
            const _exhaustive: never = region.section;
            return _exhaustive;
        }
    }
}

// ---------------------------------------------------------------------------
// Layout — every eligible grass tile gets a preset flower.
// ---------------------------------------------------------------------------

interface BlockPoint {
    x: number;
    y: number;
    r: number;
}

function blockPointsFor(region: RegionPlan): BlockPoint[] {
    const c = FLORA_CONFIG.clearance;
    const pts: BlockPoint[] = [];
    for (const p of region.plants) {
        pts.push({ x: p.tileX + 0.5, y: p.tileY + 0.5, r: c + 0.3 });
    }
    for (const p of region.props) {
        pts.push({ x: p.tileX + 0.5, y: p.tileY + 0.5, r: c });
    }
    for (const d of region.decor) {
        if (!d.flat) {
            pts.push({ x: d.tileX + 0.5, y: d.tileY + 0.5, r: c });
        }
    }
    for (const h of region.hedges) {
        pts.push({ x: h.tileX + 0.5, y: h.tileY + 0.5, r: 0.9 });
    }
    pts.push({ x: region.waystone.tileX + 0.5, y: region.waystone.tileY + 0.5, r: c + 0.4 });
    return pts;
}

/** Rect(s) of authored field fills (tulip ribbons etc.) — flowers skip them. */
function inField(region: RegionPlan, tileX: number, tileY: number): boolean {
    for (const f of region.fields) {
        const x0 = Math.min(f.x0, f.x1);
        const x1 = Math.max(f.x0, f.x1);
        const y0 = Math.min(f.y0, f.y1);
        const y1 = Math.max(f.y0, f.y1);
        if (tileX >= x0 - 1 && tileX <= x1 + 1 && tileY >= y0 - 1 && tileY <= y1 + 1) {
            return true;
        }
    }
    return false;
}

/**
 * Build the full deterministic flower layout: one preset flower per eligible grass tile
 * (grass = not water/shore, not trail, not plaza, clear of plots/props/structures).
 */
export function planFlora(plan: WorldPlan, model: TerrainModel): FloraLayout {
    const spots = new Map<string, FlowerSpot>();
    const bands = new Map<string, string[]>();

    const gateBlocks: BlockPoint[] = plan.gates.map((g) => ({
        x: g.tileX + 0.5,
        y: g.tileY + 0.5,
        r: FLORA_CONFIG.clearance,
    }));

    for (const region of plan.regions) {
        const speciesTable = SPECIES_BY_SECTION[region.section];
        const blocks = [...blockPointsFor(region), ...gateBlocks];
        const { rect } = region;

        for (let ty = rect.y + 1; ty < rect.y + rect.h - 1; ty++) {
            for (let tx = rect.x + 1; tx < rect.x + rect.w - 1; tx++) {
                const px = (tx + 0.5) * TILE_SIZE;
                const py = (ty + 0.5) * TILE_SIZE;

                // Grass only: off water+shore, off the trail, off the plaza.
                const waterClear = TILE_SIZE * FLORA_CONFIG.waterClearTiles;
                if (sampleDT(model.waterDT, model.gw, model.gh, px, py) < waterClear) {
                    continue;
                }
                const trailClear = TILE_SIZE * FLORA_CONFIG.trailClearTiles;
                if (sampleDT(model.trailDT, model.gw, model.gh, px, py) < trailClear) {
                    continue;
                }
                if (plazaField(px, py) < FLORA_CONFIG.plazaClear) {
                    continue;
                }
                if (inField(region, tx, ty)) {
                    continue;
                }
                let blocked = false;
                for (const b of blocks) {
                    const dx = tx + 0.5 - b.x;
                    const dy = ty + 0.5 - b.y;
                    if (dx * dx + dy * dy < b.r * b.r) {
                        blocked = true;
                        break;
                    }
                }
                if (blocked) {
                    continue;
                }
                // Keeper clearing (the plaza field covers most of it; belt-and-braces).
                const kdx = tx - KEEPER_TILE.tileX;
                const kdy = ty - KEEPER_TILE.tileY;
                if (kdx * kdx + kdy * kdy < 3.5 * 3.5) {
                    continue;
                }

                const band = bandIndexFor(region, tx, ty, model);
                const species = speciesTable[band % speciesTable.length];
                const bandId = `${region.section}:${band}`;
                const key = floraKey(tx, ty);
                const spread = FLORA_CONFIG.maxWaters - FLORA_CONFIG.minWaters + 1;
                spots.set(key, {
                    tileX: tx,
                    tileY: ty,
                    section: region.section,
                    species,
                    watersNeeded: FLORA_CONFIG.minWaters
                        + Math.floor(floraHash(tx, ty, 777) * spread),
                    bandId,
                });
                const members = bands.get(bandId) ?? [];
                members.push(key);
                bands.set(bandId, members);
            }
        }
    }

    return { spots, bands };
}

// ---------------------------------------------------------------------------
// Watering — pour application + stage mapping.
// ---------------------------------------------------------------------------

export function floraStage(count: number, watersNeeded: number): FloraStage {
    if (count <= 0) {
        return "none";
    }
    if (count >= watersNeeded) {
        return "bloom";
    }
    return count / watersNeeded >= FLORA_CONFIG.budFraction ? "bud" : "sprout";
}

export interface FloraChange {
    spot: FlowerSpot;
    count: number;
    stage: FloraStage;
    prevStage: FloraStage;
}

export interface PourResult {
    counts: FloraCounts;
    /** Spots whose count changed this pour (stage may or may not have advanced). */
    changed: FloraChange[];
    /** Bands whose LAST flower bloomed on this pour (celebration hooks). */
    bandsCompleted: string[];
}

/** The 3×3 splash around the aimed tile (aim first, then the ring). */
export function splashTiles(aimX: number, aimY: number): Array<{ tileX: number; tileY: number }> {
    const out = [{ tileX: aimX, tileY: aimY }];
    const r = FLORA_CONFIG.splashRadius;
    for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
            if (dx === 0 && dy === 0) {
                continue;
            }
            out.push({ tileX: aimX + dx, tileY: aimY + dy });
        }
    }
    return out;
}

/**
 * Apply one pour aimed at a tile: +aimBoost there, +splashBoost on the ring, clamped at
 * each spot's watersNeeded. Pure — returns the next counts record and what changed.
 * `allow` lets the caller exclude spots (e.g. tiles inside a still-locked garden).
 */
export function applyPour(
    layout: FloraLayout,
    counts: FloraCounts,
    aimX: number,
    aimY: number,
    allow: (spot: FlowerSpot) => boolean = () => true,
): PourResult {
    const next: FloraCounts = { ...counts };
    const changed: FloraChange[] = [];

    for (const t of splashTiles(aimX, aimY)) {
        const key = floraKey(t.tileX, t.tileY);
        const spot = layout.spots.get(key);
        if (!spot || !allow(spot)) {
            continue;
        }
        const isAim = t.tileX === aimX && t.tileY === aimY;
        const boost = isAim ? FLORA_CONFIG.aimBoost : FLORA_CONFIG.splashBoost;
        const prev = next[key] ?? 0;
        const count = Math.min(spot.watersNeeded, prev + boost);
        if (count === prev) {
            continue;
        }
        next[key] = count;
        changed.push({
            spot,
            count,
            stage: floraStage(count, spot.watersNeeded),
            prevStage: floraStage(prev, spot.watersNeeded),
        });
    }

    // A band celebrates exactly once: when one of this pour's blooms was its last.
    const bandsCompleted: string[] = [];
    const candidates = new Set(
        changed
            .filter((c) => c.stage === "bloom" && c.prevStage !== "bloom")
            .map((c) => c.spot.bandId),
    );
    for (const bandId of candidates) {
        const members = layout.bands.get(bandId) ?? [];
        const done = members.every((k) => {
            const spot = layout.spots.get(k)!;
            return (next[k] ?? 0) >= spot.watersNeeded;
        });
        if (done) {
            bandsCompleted.push(bandId);
        }
    }

    return { counts: next, changed, bandsCompleted };
}

// ---------------------------------------------------------------------------
// Texture naming + display sizes (consumed by assets.ts / flora-layer.ts).
// ---------------------------------------------------------------------------

/** Texture key for a species at a stage: real art at bloom, generated shoot/bud below. */
export function floraTextureKey(species: FlowerSpecies, stage: FloraStage): string {
    switch (stage) {
        case "sprout":
            return "flora-sprout";
        case "bud":
            return `flora-bud-${species.tint.toString(16).padStart(6, "0")}`;
        case "bloom":
            return species.assetKey;
        case "none":
            return "flora-sprout"; // never rendered; callers guard on stage !== "none"
        default: {
            const _exhaustive: never = stage;
            return _exhaustive;
        }
    }
}

/** Display height (tiles) for a species at a stage. */
export function floraHeightTiles(species: FlowerSpecies, stage: FloraStage): number {
    switch (stage) {
        case "sprout":
            return 0.3;
        case "bud":
            return 0.42;
        case "bloom":
            return species.hTiles;
        case "none":
            return 0.3;
        default: {
            const _exhaustive: never = stage;
            return _exhaustive;
        }
    }
}

/** Progress toward bloom for HUD pips: [count, watersNeeded] for the aimed tile. */
export function pourProgress(
    layout: FloraLayout,
    counts: FloraCounts,
    tileX: number,
    tileY: number,
): { count: number; needed: number } | null {
    const spot = layout.spots.get(floraKey(tileX, tileY));
    if (!spot) {
        return null;
    }
    return {
        count: Math.min(spot.watersNeeded, counts[floraKey(tileX, tileY)] ?? 0),
        needed: spot.watersNeeded,
    };
}
