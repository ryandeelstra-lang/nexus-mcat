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
import {
    type GardenSection,
    type RegionPlan,
    SPLIT_X,
    SPLIT_Y,
    TILE_SIZE,
    type TileCoord,
    type WorldPlan,
} from "./worldgen";

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
    /** Fraction of tiles that grow a tall HERO clump above the merged bed carpet
     * (the rest render as pure carpet, so drifts read continuous, never gridded). */
    heroDensity: number;
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
    // HANAMI BANKS (concept A, 2026-07-03): a waterline GRADIENT — palest white-pink at the
    // stream edge deepening to rich rose outward, then the fern meadow beyond. Band index 0
    // hugs the water, so this order IS the gradient.
    { id: "sakura-white", assetKey: "prop-sakura-flowers-04", tint: 0xf2eee4, hTiles: 0.45, heroDensity: 0.16 },
    { id: "sakura-blossom", assetKey: "prop-sakura-flowers-02", tint: 0xf2a9c4, hTiles: 0.55, heroDensity: 0.2 },
    { id: "sakura-rose-pair", assetKey: "prop-sakura-flowers-01", tint: 0xe87ea1, hTiles: 0.5, heroDensity: 0.18 },
    { id: "sakura-pinktip", assetKey: "prop-sakura-flowers-00", tint: 0xd96a90, hTiles: 0.55, heroDensity: 0.18 },
    { id: "sakura-fern", assetKey: "prop-sakura-flowers-03", tint: 0xc4dba4, hTiles: 0.45, heroDensity: 0.14 },
];

const KEUKENHOF_BANDS: FlowerSpecies[] = [
    // Two-row ribbons cycling the classic Dutch field colors.
    { id: "hyacinth-red", assetKey: "prop-keukenhof-28", tint: 0xd8484a, hTiles: 0.6, heroDensity: 0.22 },
    { id: "hyacinth-white", assetKey: "prop-keukenhof-22", tint: 0xf2f2e4, hTiles: 0.6, heroDensity: 0.22 },
    { id: "hyacinth-purple", assetKey: "prop-keukenhof-21", tint: 0xb76bd1, hTiles: 0.6, heroDensity: 0.22 },
    { id: "hyacinth-blue", assetKey: "prop-keukenhof-23", tint: 0x5a7bd8, hTiles: 0.6, heroDensity: 0.22 },
];

const VERSAILLES_BANDS: FlowerSpecies[] = [
    // Formal rose rings around the Fountain Court — cream, blush, crimson.
    { id: "rose-cream", assetKey: "foliage-versailles-26", tint: 0xf2e6c4, hTiles: 0.65, heroDensity: 0.24 },
    { id: "rose-blush", assetKey: "foliage-versailles-27", tint: 0xe7a0b4, hTiles: 0.65, heroDensity: 0.24 },
    { id: "rose-crimson", assetKey: "foliage-versailles-29", tint: 0xd06276, hTiles: 0.65, heroDensity: 0.24 },
];

const GARDENS_BANDS: FlowerSpecies[] = [
    // Night-garden orchid drifts (noise-clustered patches, not lines).
    { id: "orchid-violet", assetKey: "prop-gardens-by-the-bay-18", tint: 0x8a5cf6, hTiles: 0.6, heroDensity: 0.2 },
    { id: "orchid-pink", assetKey: "prop-gardens-by-the-bay-14", tint: 0xd873c9, hTiles: 0.6, heroDensity: 0.2 },
    { id: "orchid-ember", assetKey: "prop-gardens-by-the-bay-11", tint: 0x3e9c8b, hTiles: 0.55, heroDensity: 0.2 },
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
// Layout — EVERY grass tile in the world gets a preset flower ("all the grass
// blocks can be watered, every single one" — 2026-07-03).
// ---------------------------------------------------------------------------

/** Which garden a tile belongs to (hard quadrant split — mirrors the terrain painter's
 * regionAtTile). Seam-corridor grass between the region rects gets its NEAREST garden's
 * species, so the color bands flow across the whole island, not just inside the rects. */
export function sectionAtTile(tileX: number, tileY: number): GardenSection {
    if (tileX > SPLIT_X) {
        return tileY > SPLIT_Y ? "CARS" : "B-B";
    }
    return tileY > SPLIT_Y ? "C-P" : "P-S";
}

/** The exact tiles physically occupied by something standing on the ground (a plot plant,
 * a prop, a hedge wall, a waystone, an authored decoration, a field planter row). Only
 * these single tiles are skipped — the grass beside them is waterable. */
export function occupiedTiles(plan: WorldPlan): Set<string> {
    const occupied = new Set<string>();
    for (const region of plan.regions) {
        for (const p of region.plants) {
            occupied.add(floraKey(p.tileX, p.tileY));
        }
        for (const p of region.props) {
            occupied.add(floraKey(p.tileX, p.tileY));
        }
        for (const d of region.decor) {
            if (!d.flat) {
                occupied.add(floraKey(Math.round(d.tileX), Math.round(d.tileY)));
            }
        }
        for (const h of region.hedges) {
            occupied.add(floraKey(h.tileX, h.tileY));
        }
        for (const f of region.fields) {
            for (let ty = Math.min(f.y0, f.y1); ty <= Math.max(f.y0, f.y1); ty++) {
                for (let tx = Math.min(f.x0, f.x1); tx <= Math.max(f.x0, f.x1); tx++) {
                    occupied.add(floraKey(tx, ty));
                }
            }
        }
        occupied.add(floraKey(region.waystone.tileX, region.waystone.tileY));
    }
    return occupied;
}

/** True when a tile is grass: on the map, off water+shore, off the trail, off the plaza.
 * (Water, shore sand, paths, and the plaza are the only non-grass ground the painter makes.) */
export function isGrassTile(
    plan: WorldPlan,
    model: TerrainModel,
    tileX: number,
    tileY: number,
): boolean {
    if (tileX < 0 || tileY < 0 || tileX >= plan.widthTiles || tileY >= plan.heightTiles) {
        return false;
    }
    const px = (tileX + 0.5) * TILE_SIZE;
    const py = (tileY + 0.5) * TILE_SIZE;
    if (sampleDT(model.waterDT, model.gw, model.gh, px, py) < TILE_SIZE * FLORA_CONFIG.waterClearTiles) {
        return false;
    }
    if (sampleDT(model.trailDT, model.gw, model.gh, px, py) < TILE_SIZE * FLORA_CONFIG.trailClearTiles) {
        return false;
    }
    return plazaField(px, py) >= FLORA_CONFIG.plazaClear;
}

/**
 * Build the full deterministic flower layout: one preset flower on EVERY grass tile of the
 * whole world grid — region interiors, region borders, and the seam corridors between
 * gardens — skipping only tiles something is physically standing on.
 */
export function planFlora(plan: WorldPlan, model: TerrainModel): FloraLayout {
    const spots = new Map<string, FlowerSpot>();
    const bands = new Map<string, string[]>();
    const occupied = occupiedTiles(plan);
    const regionBySection = new Map(plan.regions.map((r) => [r.section, r]));
    const spread = FLORA_CONFIG.maxWaters - FLORA_CONFIG.minWaters + 1;

    for (let ty = 0; ty < plan.heightTiles; ty++) {
        for (let tx = 0; tx < plan.widthTiles; tx++) {
            if (!isGrassTile(plan, model, tx, ty)) {
                continue;
            }
            const key = floraKey(tx, ty);
            if (occupied.has(key)) {
                continue;
            }

            const section = sectionAtTile(tx, ty);
            const region = regionBySection.get(section);
            if (!region) {
                continue;
            }
            const speciesTable = SPECIES_BY_SECTION[section];
            const band = bandIndexFor(region, tx, ty, model);
            const species = speciesTable[band % speciesTable.length];
            const bandId = `${section}:${band}`;
            spots.set(key, {
                tileX: tx,
                tileY: ty,
                section,
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

/** Whether a bloomed tile grows a tall hero clump above the merged bed carpet
 * (deterministic; the rest stay pure carpet so drifts read continuous). */
export function isHeroTile(spot: FlowerSpot): boolean {
    return floraHash(spot.tileX, spot.tileY, 1520) < spot.species.heroDensity;
}

/** Same-species bloomed-or-budding neighbor test — the carpet merges across these edges. */
export function bedEdges(
    layout: FloraLayout,
    counts: FloraCounts,
    spot: FlowerSpot,
): { n: boolean; e: boolean; s: boolean; w: boolean } {
    const grown = (dx: number, dy: number): boolean => {
        const n = layout.spots.get(floraKey(spot.tileX + dx, spot.tileY + dy));
        if (!n || n.species.id !== spot.species.id) {
            return false;
        }
        const stage = floraStage(counts[floraKey(n.tileX, n.tileY)] ?? 0, n.watersNeeded);
        return stage === "bud" || stage === "bloom";
    };
    return { n: grown(0, -1), e: grown(1, 0), s: grown(0, 1), w: grown(-1, 0) };
}

/**
 * A band's tiles ordered ALONG the line (greedy nearest-neighbour chain from the
 * westernmost end), so waves — wind gusts, domino bloom celebrations — travel down the
 * row instead of firing in map order. Works for straight ribbons, shoreline curves, and
 * rings alike (a ring chains into a loop walk).
 */
export function bandWaveOrder(layout: FloraLayout, bandId: string): TileCoord[] {
    const members = (layout.bands.get(bandId) ?? []).map((k) => layout.spots.get(k)!);
    if (members.length === 0) {
        return [];
    }
    let start = 0;
    for (let i = 1; i < members.length; i++) {
        const a = members[i];
        const s = members[start];
        if (a.tileX + a.tileY * 0.25 < s.tileX + s.tileY * 0.25) {
            start = i;
        }
    }
    const remaining = new Set(members.map((_, i) => i));
    remaining.delete(start);
    const chain = [members[start]];
    let current = members[start];
    while (remaining.size > 0) {
        let bestIdx = -1;
        let bestD = Infinity;
        for (const i of remaining) {
            const m = members[i];
            const d = (m.tileX - current.tileX) ** 2 + (m.tileY - current.tileY) ** 2;
            if (d < bestD) {
                bestD = d;
                bestIdx = i;
            }
        }
        remaining.delete(bestIdx);
        current = members[bestIdx];
        chain.push(current);
    }
    return chain.map((s) => ({ tileX: s.tileX, tileY: s.tileY }));
}

/** Fraction of a band's flowers at full bloom (0..1) — ambience triggers key off this. */
export function bandBloomFraction(
    layout: FloraLayout,
    counts: FloraCounts,
    bandId: string,
): number {
    const members = layout.bands.get(bandId) ?? [];
    if (members.length === 0) {
        return 0;
    }
    let bloomed = 0;
    for (const k of members) {
        const spot = layout.spots.get(k)!;
        if ((counts[k] ?? 0) >= spot.watersNeeded) {
            bloomed++;
        }
    }
    return bloomed / members.length;
}

/** Fraction of a whole section's flowers at full bloom (0..1) — the grand-crown trigger
 * (Versailles fountain rainbow, Supertree answer). */
export function sectionBloomFraction(
    layout: FloraLayout,
    counts: FloraCounts,
    section: GardenSection,
): number {
    let total = 0;
    let bloomed = 0;
    for (const [k, spot] of layout.spots) {
        if (spot.section !== section) {
            continue;
        }
        total++;
        if ((counts[k] ?? 0) >= spot.watersNeeded) {
            bloomed++;
        }
    }
    return total === 0 ? 0 : bloomed / total;
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
