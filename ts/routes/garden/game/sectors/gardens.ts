// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: GARDENS BY THE BAY (CARS) — "The Ascent of Understanding". Authored from
// docs/sectors/04, re-composed 2026-07-03 after live playtesting: ONE pair of BIG Supertrees
// in the middle (walk behind them, never through), one mist lagoon the boardwalk crosses at
// grade, and almost nothing else — space serves atmosphere. Only 3 plots (FOC→RW→RB).
// All coordinates are WORLD tiles (this rect spans x 25..43, y 19..31).
import { disc } from "./helpers";
import type { SectorLayout } from "./types";

const trail = [
    // The single pilgrimage polyline (NW boardwalk entrance → down the steps → across the
    // lagoon's north shoulder at grade → east beneath the Supertrees).
    { tileX: 26, tileY: 20 },
    { tileX: 26, tileY: 21 },
    { tileX: 27, tileY: 22 },
    { tileX: 27, tileY: 23 },
    { tileX: 28, tileY: 24 },
    { tileX: 28, tileY: 26 },
    { tileX: 32, tileY: 26 },
    { tileX: 32, tileY: 25 },
    { tileX: 38, tileY: 25 },
];

// The one mist lagoon. The boardwalk clips its north shoulder at (31,26)/(32,26) — those two
// tiles are landGaps, painted as flat path by the engine (no planks, no bridge sprites).
const lagoon = disc(32, 28, 2.5);

export const GARDENS: SectorLayout = {
    section: "CARS",
    entrance: { tileX: 26, tileY: 20 },
    pathWaypoints: [trail],
    waterTiles: lagoon,
    landGaps: [
        { tileX: 31, tileY: 26 },
        { tileX: 32, tileY: 26 },
    ],
    plots: [
        { nodeId: "CARS.FOC", tileX: 27, tileY: 21 },
        { nodeId: "CARS.RW", tileX: 30, tileY: 25 },
        { nodeId: "CARS.RB", tileX: 38, tileY: 26 },
    ],
    // Playtest directive: one or two BIG towers mid-region and nothing else tower-like.
    // The twin-tree landmark (hTiles 7) plus one companion supertree (5.5) anchor on open
    // grass with walkable tiles both north (behind) and south (in front) — depth-sort lets
    // the player pass behind them; the anchor tile alone collides.
    props: [
        { key: "struct-landmark-gardens-supertrees", tileX: 36, tileY: 23, hTiles: 7.0 },
        { key: "prop-gardens-by-the-bay-sig-00", tileX: 38, tileY: 22, hTiles: 5.5 },
        { key: "foliage-gardens-by-the-bay-22", tileX: 28, tileY: 21 },
        { key: "foliage-gardens-by-the-bay-22", tileX: 29, tileY: 28 },
        { key: "prop-gardens-by-the-bay-sig-07", tileX: 33, tileY: 24 },
    ],
    decor: [],
    fields: [],
    // CARS has no leaf-level prerequisite edges in the sidecar DAG, and doors are gone
    // game-wide (2026-07-03) — the ascent FOC → RW → RB is guided by geography alone.
    gates: [],
    waystone: { tileX: 35, tileY: 27 },
    interactions: [
        {
            tileX: 32,
            tileY: 27,
            radius: 2.0,
            title: "The Mist Lagoon",
            line: "Mid-span, there is only mist and the words themselves. Everything you need is within the "
                + "text. Reason from it — nothing more.",
        },
        {
            tileX: 36,
            tileY: 23,
            radius: 2.2,
            title: "The Supertrees",
            line: "The tallest trees drink the light and give it back. Read beyond the passage now — carry "
                + "its truth somewhere new.",
        },
    ],
    critters: [
        { kind: "moteDrift", count: 4, cx: 29, cy: 27, rx: 37, ry: 22, tint: 0x7fe7da, speed: 9 },
        { kind: "shadowLoop", count: 3, cx: 32, cy: 28, rx: 1.6, ry: 1.2, tint: 0x0a0a0a, speed: 0.32 },
    ],
    palette: {
        grass: ["#24413A", "#1F3A34", "#1A332E"],
        tuft: "#10231F",
        flowerDensity: 0,
        pebble: "#3A4A4A",
        path: ["#8A5A3C", "#774B31"],
        pathRim: "#3B2A22",
        waterDeep: "#061B33",
        water: "#0B2C4A",
        waterLight: "#2FB3C9",
        shore: "#35474B",
    },
};
