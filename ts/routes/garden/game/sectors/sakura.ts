// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: SAKURA (P-S, Psych/Soc) — "The Mind's Stream". Authored from docs/sectors/01.
// You follow a stream from its headwater (sensation) down through perception and behavior to a
// koi pond that broadens into society. Prereq order IS the walking order; two water crossings
// are literal gates. All coordinates are WORLD tiles.
import { disc, hline, rect, tiles } from "./helpers";
import type { SectorLayout } from "./types";

const stream = tiles(
    rect(16, 2, 21, 3),
    rect(11, 3, 15, 4),
    rect(7, 4, 10, 5),
    [
        { tileX: 5, tileY: 5 },
        { tileX: 6, tileY: 5 },
        { tileX: 4, tileY: 6 },
        { tileX: 5, tileY: 6 },
        { tileX: 6, tileY: 6 },
    ],
    rect(4, 7, 5, 13),
    hline(13, 5, 10), // inlet
    disc(13, 13, 2.8), // koi pond
    [{ tileX: 13, tileY: 17 }], // outlet
);

export const SAKURA: SectorLayout = {
    section: "P-S",
    entrance: { tileX: 23, tileY: 16 },
    pathWaypoints: [
        // Main stroll path (SE entrance → headwater → down the stream → around the pond).
        [
            { tileX: 23, tileY: 16 },
            { tileX: 23, tileY: 12 },
            { tileX: 22, tileY: 9 },
            { tileX: 22, tileY: 5 },
            { tileX: 13, tileY: 5 },
            { tileX: 12, tileY: 6 },
            { tileX: 10, tileY: 6 },
            { tileX: 8, tileY: 8 },
            { tileX: 8, tileY: 12 },
            { tileX: 8, tileY: 14 },
            { tileX: 8, tileY: 15 },
            { tileX: 9, tileY: 16 },
            { tileX: 12, tileY: 16 },
            { tileX: 16, tileY: 16 },
            { tileX: 17, tileY: 15 },
            { tileX: 17, tileY: 12 },
        ],
        // Dell spur across the red bridge (7B, 7C).
        [
            { tileX: 8, tileY: 8 },
            { tileX: 6, tileY: 9 },
            { tileX: 3, tileY: 9 },
            { tileX: 2, tileY: 9 },
            { tileX: 2, tileY: 8 },
        ],
        [
            { tileX: 2, tileY: 9 },
            { tileX: 2, tileY: 11 },
        ],
    ],
    waterTiles: stream,
    // Bridge decks + stepping stones: walkable, painted-as-water by the shoreline spill.
    landGaps: [
        { tileX: 4, tileY: 9 },
        { tileX: 5, tileY: 9 },
        { tileX: 8, tileY: 13 },
        { tileX: 13, tileY: 16 },
    ],
    plots: [
        { nodeId: "PS.6A", tileX: 23, tileY: 6 },
        { nodeId: "PS.6B", tileX: 18, tileY: 6 },
        { nodeId: "PS.6C", tileX: 12, tileY: 7 },
        { nodeId: "PS.7A", tileX: 9, tileY: 9 },
        { nodeId: "PS.7B", tileX: 2, tileY: 7 },
        { nodeId: "PS.7C", tileX: 2, tileY: 12 },
        { nodeId: "PS.8A", tileX: 7, tileY: 12 },
        { nodeId: "PS.8B", tileX: 7, tileY: 15 },
        { nodeId: "PS.8C", tileX: 10, tileY: 17 },
        { nodeId: "PS.9A", tileX: 15, tileY: 17 },
        { nodeId: "PS.9B", tileX: 18, tileY: 15 },
        { nodeId: "PS.10A", tileX: 18, tileY: 12 },
    ],
    props: [
        { key: "prop-sakura-sig-00", tileX: 22, tileY: 4 },
        { key: "prop-sakura-sig-01", tileX: 24, tileY: 10 },
        { key: "prop-sakura-lantern-a", tileX: 25, tileY: 15 },
        { key: "prop-sakura-lantern-b", tileX: 22, tileY: 17 },
        { key: "prop-sakura-fountain", tileX: 24, tileY: 15 },
        { key: "prop-sakura-lantern-a", tileX: 20, tileY: 4 },
        { key: "prop-sakura-lantern-b", tileX: 20, tileY: 6 },
        { key: "prop-sakura-rocks-00", tileX: 15, tileY: 4 },
        { key: "prop-sakura-bush", tileX: 15, tileY: 6 },
        { key: "prop-sakura-bush", tileX: 9, tileY: 10 },
        { key: "prop-sakura-rocks-00", tileX: 1, tileY: 10 },
        { key: "prop-sakura-sig-03", tileX: 1, tileY: 12 },
        { key: "prop-sakura-sig-05", tileX: 6, tileY: 11 },
        { key: "prop-sakura-rocks-00", tileX: 9, tileY: 15 },
        { key: "prop-sakura-rocks-00", tileX: 16, tileY: 14 },
        { key: "prop-sakura-rocks-00", tileX: 18, tileY: 14 },
        { key: "prop-sakura-lantern-b", tileX: 16, tileY: 17 },
        { key: "prop-sakura-lantern-a", tileX: 19, tileY: 11 },
        { key: "prop-sakura-lantern-b", tileX: 21, tileY: 11 },
    ],
    decor: [
        { key: "struct-bridge-sakura", tileX: 13, tileY: 17, hTiles: 2.2 },
        { key: "prop-sakura-sig-02", tileX: 4.5, tileY: 10, hTiles: 2.2 },
        { key: "prop-sakura-sig-04", tileX: 8, tileY: 13.5, hTiles: 1.4, flat: true },
        { key: "foliage-sakura-02", tileX: 17, tileY: 4, hTiles: 3.2 },
        { key: "foliage-sakura-05", tileX: 1, tileY: 6, hTiles: 3.0 },
        { key: "foliage-sakura-00", tileX: 11, tileY: 15, hTiles: 3.2 },
        { key: "foliage-sakura-08", tileX: 15, tileY: 15, hTiles: 2.8 },
        { key: "prop-sakura-petals-00", tileX: 12, tileY: 12, hTiles: 0.6, flat: true },
        { key: "prop-sakura-petals-01", tileX: 14, tileY: 14, hTiles: 0.6, flat: true },
    ],
    fields: [],
    gates: [
        { src: "PS.6A", dst: "PS.6B", tileX: 20, tileY: 5, orientation: "v" },
        { src: "PS.6B", dst: "PS.6C", tileX: 15, tileY: 5, orientation: "v" },
        { src: "PS.6C", dst: "PS.7A", tileX: 9, tileY: 7, orientation: "v" },
        { src: "PS.7A", dst: "PS.7B", tileX: 6, tileY: 9, orientation: "v" },
        { src: "PS.7B", dst: "PS.7C", tileX: 2, tileY: 10, orientation: "h" },
        { src: "PS.7A", dst: "PS.8A", tileX: 8, tileY: 10, orientation: "h" },
        { src: "PS.8A", dst: "PS.8B", tileX: 8, tileY: 13, orientation: "h" },
        { src: "PS.8B", dst: "PS.8C", tileX: 9, tileY: 16, orientation: "v" },
        { src: "PS.8C", dst: "PS.9A", tileX: 13, tileY: 16, orientation: "v" },
        { src: "PS.9A", dst: "PS.9B", tileX: 16, tileY: 16, orientation: "v" },
        { src: "PS.9A", dst: "PS.10A", tileX: 17, tileY: 14, orientation: "h" },
    ],
    waystone: { tileX: 24, tileY: 14 },
    interactions: [
        {
            tileX: 22,
            tileY: 5,
            title: "The Spring",
            line:
                "Every thought begins as a trickle. Listen — the spring only says what the world tells it.",
        },
        {
            tileX: 5,
            tileY: 9,
            title: "The Dell Bridge",
            line:
                "The stream splits here — what you notice becomes what you do. Cross, and meet the others.",
        },
        {
            tileX: 7,
            tileY: 12,
            title: "The Tsukubai",
            line: "Still water is the only honest mirror. Kneel. Who is looking back?",
        },
        {
            tileX: 13,
            tileY: 16,
            title: "The Taiko-bashi",
            line:
                "The drum bridge meets its reflection and the circle closes — one stream, many koi, one pond.",
        },
    ],
    critters: [
        { kind: "shadowLoop", count: 5, cx: 13, cy: 13, rx: 2.0, ry: 1.6, tint: 0x1a1a1a, speed: 0.35 },
    ],
    palette: {
        flowers: ["#F9C5D5", "#F2A9C4", "#E87EA1"],
        flowerDensity: 0.011,
        path: ["#C7B9A0", "#B9AA8E"],
        pathRim: "#8E8069",
        waterDeep: "#234A57",
        water: "#2E6E7E",
        waterLight: "#5FA8B5",
    },
};
