// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: authored sector layouts (docs/sectors/*). Each of the four great gardens is
// composed by hand — winding paths, hero landmarks, plot placement in prereq order, water
// shapes, vignettes, and walk-up interactions — instead of the old serpentine auto-layout.
// This is DATA only: pure coordinates + asset keys + strings. The framework (index.ts) turns
// it into a RegionPlan the world renders. Determinism (docs/26): no runtime randomness — every
// tile here is authored or derived by seeded noise elsewhere.
import type { GardenSection, TileCoord } from "../worldgen";

/** A plot bound to a real leaf topic, placed beside (never on) a trail tile. */
export interface SectorPlot {
    nodeId: string;
    tileX: number;
    tileY: number;
}

/** A solid prop (collision at its anchor tile) — trees, lanterns, statues, landmarks. */
export interface SectorProp {
    key: string;
    tileX: number;
    tileY: number;
}

/** A non-colliding authored decoration: bridges over gaps, hero trees, flat decals, rafts.
 * Rendered by the world at an exact spot, aspect-preserved, depth-sorted by Y (or `flat`). */
export interface SectorDecor {
    key: string;
    /** Bottom-center anchor, in tiles (fractional allowed for fine placement). */
    tileX: number;
    tileY: number;
    /** Display height in tiles (aspect preserved). */
    hTiles: number;
    /** Flat ground decals render just above the ground, below every standing sprite. */
    flat?: boolean;
    flip?: boolean;
}

/** A rectangular field fill (tulip ribbons, parterre beds): rows of a strip asset. */
export interface FieldFill {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
    /** Strip asset(s) filling the rows (alternated for a rainbow carpet). */
    assets: string[];
    /** Vertical spacing between rows in tiles (default ~1). */
    rowStep?: number;
    /** Row height in tiles (default derived from width). */
    hTiles?: number;
}

/** An in-region prereq gate at an authored tile on the path between its two plots. */
export interface SectorGate {
    src: string;
    dst: string;
    tileX: number;
    tileY: number;
    orientation: "h" | "v";
}

/** A walk-up flavor interaction: press E within `radius` tiles → a Keeper-voiced line. */
export interface SectorInteraction {
    tileX: number;
    tileY: number;
    /** Interaction radius in tiles (default 1.6). */
    radius?: number;
    title: string;
    line: string;
}

/** An ambient critter that makes the world feel alive (deterministic — seeded, no RNG).
 *  - shadowLoop: soft dark ellipses looping a path/ellipse (koi in a pond, ducks on a canal).
 *  - moteDrift: glowing motes drifting between two anchors (bees over tulips, fireflies). */
export interface SectorCritter {
    kind: "shadowLoop" | "moteDrift";
    /** Number of critters. */
    count: number;
    /** For shadowLoop: ellipse center (tiles). For moteDrift: first anchor. */
    cx: number;
    cy: number;
    /** For shadowLoop: ellipse radii (tiles). For moteDrift: second anchor. */
    rx: number;
    ry: number;
    /** Tint (hex int). */
    tint: number;
    /** Loop speed in tiles/sec (shadowLoop) or drift period seconds (moteDrift). */
    speed: number;
    /** Only visible at night (fireflies) when true. */
    nightOnly?: boolean;
}

/** A partial override of a region's ground palette (hex strings). */
export interface PaletteOverride {
    grass?: [string, string, string];
    tuft?: string;
    flowers?: string[];
    flowerDensity?: number;
    pebble?: string;
    path?: [string, string];
    pathRim?: string;
    waterDeep?: string;
    water?: string;
    waterLight?: string;
    shore?: string;
}

/** The complete authored layout for one great garden. */
export interface SectorLayout {
    section: GardenSection;
    /** The trail tile the plaza connector should attach to (nearest to the Keeper). */
    entrance: TileCoord;
    /** Polylines (waypoints) rasterized 8-connected into the walkable trail. */
    pathWaypoints: TileCoord[][];
    /** Explicit water tiles (built with the rect/disc/line helpers). */
    waterTiles: TileCoord[];
    /** Walkable tiles inside water bounds (bridge decks, stepping stones). */
    landGaps: TileCoord[];
    /** One plot per leaf topic, at authored coordinates. */
    plots: SectorPlot[];
    /** Solid props (collision). */
    props: SectorProp[];
    /** Non-colliding authored decoration. */
    decor: SectorDecor[];
    /** Rectangular field fills (tulip ribbons / parterre beds). */
    fields: FieldFill[];
    /** Authored in-region prereq gate positions. */
    gates: SectorGate[];
    /** Region waystone (fast-travel marker). */
    waystone: TileCoord;
    /** Walk-up flavor interactions. */
    interactions: SectorInteraction[];
    /** Optional ambient critters. */
    critters?: SectorCritter[];
    /** Optional ground-palette override. */
    palette?: PaletteOverride;
}

export type { GardenSection, TileCoord };
