// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: SAKURA (P-S, Psych/Soc) — "The Mind's Stream". Recomposed 2026-07-03 for the
// compact 19×13 rect (x 0..18, y 0..12): one C-shaped stroll that follows the water — in at
// the SE, west past the koi pond, north up the stream bank, east to the headwater rise.
// Door-gates are gone (sector-level test locks own progression), bridges are gone (crossings
// are flat fords via landGaps), and no authored flowers — the player grows those. Prereq
// order IS the walking order: 6A at the entrance, 10A deepest in the NE. All coordinates
// are WORLD tiles.
import { disc, hline, tiles, vline } from "./helpers";
import type { SectorLayout } from "./types";

const stream = tiles(
    vline(3, 1, 6), // headwater run down the west
    hline(7, 3, 8), // eastward bend
    disc(9, 9, 2.2), // koi pond
);

export const SAKURA: SectorLayout = {
    section: "P-S",
    entrance: { tileX: 17, tileY: 11 },
    pathWaypoints: [
        // One stroll: SE entrance → west along the pond → north up the stream bank →
        // east along the top to the deepest plot.
        [
            { tileX: 17, tileY: 11 },
            { tileX: 2, tileY: 11 },
            { tileX: 2, tileY: 2 },
            { tileX: 16, tileY: 2 },
        ],
    ],
    waterTiles: stream,
    // Flat fords at grade (the engine paints these as path): the pond outlet + the
    // headwater rill. No bridge sprites anywhere.
    landGaps: [
        { tileX: 9, tileY: 11 },
        { tileX: 3, tileY: 2 },
    ],
    plots: [
        { nodeId: "PS.6A", tileX: 16, tileY: 10 },
        { nodeId: "PS.6B", tileX: 13, tileY: 12 },
        { nodeId: "PS.6C", tileX: 10, tileY: 12 },
        { nodeId: "PS.7A", tileX: 7, tileY: 10 },
        { nodeId: "PS.7B", tileX: 4, tileY: 12 },
        { nodeId: "PS.7C", tileX: 1, tileY: 8 },
        { nodeId: "PS.8A", tileX: 1, tileY: 5 },
        { nodeId: "PS.8B", tileX: 4, tileY: 1 },
        { nodeId: "PS.8C", tileX: 7, tileY: 1 },
        { nodeId: "PS.9A", tileX: 10, tileY: 1 },
        { nodeId: "PS.9B", tileX: 13, tileY: 1 },
        { nodeId: "PS.10A", tileX: 16, tileY: 1 },
    ],
    props: [
        { key: "prop-sakura-sig-00", tileX: 3, tileY: 0 }, // the spring, above the headwater
        { key: "prop-sakura-lantern-a", tileX: 16, tileY: 12 }, // entrance lantern
        { key: "prop-sakura-lantern-b", tileX: 1, tileY: 12 }, // SW turn
        { key: "prop-sakura-lantern-a", tileX: 1, tileY: 1 }, // NW turn
        { key: "prop-sakura-rocks-00", tileX: 11, tileY: 10 }, // pond-edge rocks
        { key: "prop-sakura-bush", tileX: 6, tileY: 6 }, // mid-meadow bush
    ],
    decor: [
        // The single hero tree: a leaning cherry over the stream bend.
        { key: "foliage-sakura-02", tileX: 4.5, tileY: 6, hTiles: 3.2 },
    ],
    fields: [],
    gates: [],
    waystone: { tileX: 15, tileY: 12 },
    interactions: [
        {
            tileX: 3,
            tileY: 1,
            title: "The Spring",
            line: "Every thought begins as a trickle. Listen — the spring only says what the world tells it.",
        },
        {
            tileX: 9,
            tileY: 10,
            title: "The Koi Pond",
            line: "One stream, many koi, one pond — every mind you will ever meet is swimming somewhere in "
                + "this water.",
        },
    ],
    critters: [
        { kind: "shadowLoop", count: 5, cx: 9, cy: 9, rx: 1.4, ry: 1.1, tint: 0x1a1a1a, speed: 0.35 },
    ],
    palette: {
        flowers: ["#F9C5D5", "#F2A9C4", "#E87EA1"],
        flowerDensity: 0,
        path: ["#C7B9A0", "#B9AA8E"],
        pathRim: "#8E8069",
        waterDeep: "#234A57",
        water: "#2E6E7E",
        waterLight: "#5FA8B5",
    },
};
