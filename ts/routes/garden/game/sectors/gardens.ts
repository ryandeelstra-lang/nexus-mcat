// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: GARDENS BY THE BAY (CARS) — "The Ascent of Understanding". Authored from
// docs/sectors/04. The island's night-garden vista: a boardwalk climbs over two mist lagoons
// to a grove of glowing Supertrees. Only 3 plots (FOC→RW→RB) — space serves atmosphere.
// All coordinates are WORLD tiles (this rect spans x 30..55, y 22..39).
import { disc, subtractTiles, tiles } from "./helpers";
import type { SectorLayout } from "./types";

const trail = [
    // The single pilgrimage polyline (entrance stairs → over Lagoon A → overlook → over
    // Lagoon B → summit ascent).
    { tileX: 31, tileY: 23 },
    { tileX: 32, tileY: 23 },
    { tileX: 32, tileY: 24 },
    { tileX: 33, tileY: 24 },
    { tileX: 33, tileY: 25 },
    { tileX: 34, tileY: 25 },
    { tileX: 34, tileY: 26 },
    { tileX: 35, tileY: 26 },
    { tileX: 35, tileY: 27 },
    { tileX: 36, tileY: 27 },
    { tileX: 40, tileY: 27 },
    { tileX: 41, tileY: 27 },
    { tileX: 41, tileY: 28 },
    { tileX: 42, tileY: 28 },
    { tileX: 42, tileY: 29 },
    { tileX: 43, tileY: 29 },
    { tileX: 43, tileY: 31 },
    { tileX: 48, tileY: 31 },
    { tileX: 48, tileY: 29 },
    { tileX: 49, tileY: 29 },
    { tileX: 49, tileY: 28 },
    { tileX: 50, tileY: 28 },
    { tileX: 50, tileY: 27 },
    { tileX: 51, tileY: 27 },
    { tileX: 51, tileY: 25 },
];

// Two mist lagoons + a summit reflecting pool, minus the causeway trail tiles.
const lagoons = subtractTiles(
    tiles(
        disc(38, 27, 2.7),
        disc(45.5, 33, 3.4),
        disc(48, 32, 2.2),
        disc(54, 29, 1.3),
    ),
    trail,
);

export const GARDENS: SectorLayout = {
    section: "CARS",
    entrance: { tileX: 31, tileY: 23 },
    pathWaypoints: [trail],
    waterTiles: lagoons,
    landGaps: [],
    plots: [
        { nodeId: "CARS.FOC", tileX: 33, tileY: 23 },
        { nodeId: "CARS.RW", tileX: 42, tileY: 30 },
        { nodeId: "CARS.RB", tileX: 52, tileY: 25 },
    ],
    props: [
        { key: "struct-landmark-gardens-supertrees", tileX: 52, tileY: 23 },
        { key: "prop-gardens-by-the-bay-sig-00", tileX: 49, tileY: 24 },
        { key: "prop-gardens-by-the-bay-sig-07", tileX: 53, tileY: 27 },
        { key: "foliage-gardens-by-the-bay-22", tileX: 50, tileY: 26 },
        { key: "prop-gardens-by-the-bay-sig-06", tileX: 35, tileY: 22 },
        { key: "prop-gardens-by-the-bay-16", tileX: 31, tileY: 25 },
        { key: "prop-gardens-by-the-bay-sig-07", tileX: 36, tileY: 23 },
        { key: "prop-gardens-by-the-bay-14", tileX: 34, tileY: 28 },
        { key: "foliage-gardens-by-the-bay-21", tileX: 36, tileY: 30 },
        { key: "prop-gardens-by-the-bay-12", tileX: 40, tileY: 30 },
        { key: "prop-gardens-by-the-bay-sig-01", tileX: 43, tileY: 28 },
        { key: "foliage-gardens-by-the-bay-22", tileX: 45, tileY: 29 },
        { key: "prop-gardens-by-the-bay-09", tileX: 50, tileY: 36 },
        { key: "foliage-gardens-by-the-bay-06", tileX: 46, tileY: 37 },
        { key: "foliage-gardens-by-the-bay-00", tileX: 55, tileY: 28 },
    ],
    decor: [
        { key: "prop-gardens-by-the-bay-00", tileX: 37, tileY: 27, hTiles: 0.5, flat: true },
        { key: "prop-gardens-by-the-bay-00", tileX: 39, tileY: 27, hTiles: 0.5, flat: true },
        { key: "prop-gardens-by-the-bay-00", tileX: 45, tileY: 31, hTiles: 0.5, flat: true },
        { key: "prop-gardens-by-the-bay-00", tileX: 47, tileY: 31, hTiles: 0.5, flat: true },
        { key: "prop-gardens-by-the-bay-05", tileX: 43, tileY: 30, hTiles: 0.5, flat: true },
        { key: "prop-gardens-by-the-bay-sig-05", tileX: 39, tileY: 26, hTiles: 0.6, flat: true },
        { key: "prop-gardens-by-the-bay-sig-05", tileX: 45, tileY: 34, hTiles: 0.6, flat: true },
        { key: "prop-gardens-by-the-bay-17", tileX: 52, tileY: 27, hTiles: 0.5, flat: true },
    ],
    fields: [],
    // CARS has no leaf-level prerequisite edges in the sidecar DAG (unlike the science regions),
    // so there are no locked gates here — the two lagoon causeways read as scenic crossings, and
    // the ascent FOC → RW → RB is guided by geography rather than a bar. (If CARS prereq edges are
    // added to graph-sidecar.json later, restore gates at (38,27) and (46,31).)
    gates: [],
    waystone: { tileX: 41, tileY: 26 },
    interactions: [
        {
            tileX: 35,
            tileY: 22,
            title: "The Trailhead",
            line: "Foundations first, gardener. Hold the passage as it is — not as you wish it were — and the "
                + "first span will bear you.",
        },
        {
            tileX: 43,
            tileY: 28,
            title: "The Overlook",
            line: "Mid-span, there is only mist and the words themselves. Everything you need is within the "
                + "text. Reason from it — nothing more.",
        },
        {
            tileX: 52,
            tileY: 23,
            title: "The Supertrees",
            line: "The tallest trees drink the light and give it back. Read beyond the passage now — carry "
                + "its truth somewhere new.",
        },
        {
            tileX: 50,
            tileY: 36,
            title: "The Cloudhouse",
            line: "The Cloudhouse keeps a climate this island never had. New contexts test old conclusions — "
                + "that is reasoning beyond.",
        },
    ],
    critters: [
        { kind: "moteDrift", count: 6, cx: 39, cy: 26, rx: 45, ry: 34, tint: 0x7fe7da, speed: 9 },
        { kind: "shadowLoop", count: 3, cx: 45.5, cy: 33, rx: 2.2, ry: 1.6, tint: 0x0a0a0a, speed: 0.32 },
    ],
    palette: {
        grass: ["#24413A", "#1F3A34", "#1A332E"],
        tuft: "#10231F",
        flowers: ["#35C4AC", "#8A5CF6", "#2E9BC4"],
        flowerDensity: 0.0035,
        pebble: "#3A4A4A",
        path: ["#8A5A3C", "#774B31"],
        pathRim: "#3B2A22",
        waterDeep: "#061B33",
        water: "#0B2C4A",
        waterLight: "#2FB3C9",
        shore: "#35474B",
    },
};
