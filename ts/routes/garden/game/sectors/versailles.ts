// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: VERSAILLES (C-P, Chem/Phys) — "The Laws Beneath Matter". Authored from
// docs/sectors/03. A French formal garden: straight gravel allées on two perpendicular axes
// meeting at a Fountain Court, a rectangular Grand Canal, clipped hedge parterres, marble
// statues and gold urns on the beats. Formality IS the theme. All coordinates are WORLD tiles
// (this rect spans x 0..25, y 22..39).
import { hline, rect, tiles, vline } from "./helpers";
import type { SectorLayout } from "./types";

const hedges = tiles(
    hline(22, 12, 22), // north rim wall
    vline(10, 24, 26), // chem north arm, west wall
    vline(14, 24, 26), // chem north arm, east wall
    [{ tileX: 11, tileY: 26 }, { tileX: 13, tileY: 26 }], // gate 5A->5B posts
    // Fountain-court hedge island (fountain sits open in the center at 12,30).
    [
        { tileX: 11, tileY: 29 },
        { tileX: 12, tileY: 29 },
        { tileX: 13, tileY: 29 },
        { tileX: 11, tileY: 30 },
        { tileX: 13, tileY: 30 },
        { tileX: 11, tileY: 31 },
        { tileX: 12, tileY: 31 },
        { tileX: 13, tileY: 31 },
    ],
    [{ tileX: 13, tileY: 27 }], // gate 4E->5B post
    hline(28, 16, 19), // Grande Allee north wall (gap at x=20 for the bosquet allee)
    hline(28, 21, 23),
    [{ tileX: 17, tileY: 29 }, { tileX: 17, tileY: 31 }], // gate 4A->4B posts
    hline(32, 16, 23), // Grande Allee south wall
    vline(10, 33, 34), // south arm, west wall
    vline(14, 33, 34), // south arm, east wall
    [{ tileX: 11, tileY: 33 }, { tileX: 13, tileY: 33 }], // gate 5B->5E posts
    [{ tileX: 23, tileY: 24 }, { tileX: 25, tileY: 24 }], // gate 5B->5D posts
);

export const VERSAILLES: SectorLayout = {
    section: "C-P",
    entrance: { tileX: 25, tileY: 22 },
    pathWaypoints: [
        // Entrance mouth + North Terrace (dead-west).
        [
            { tileX: 25, tileY: 22 },
            { tileX: 25, tileY: 23 },
            { tileX: 24, tileY: 23 },
            { tileX: 12, tileY: 23 },
        ],
        // 5D spur (NE).
        [
            { tileX: 24, tileY: 23 },
            { tileX: 24, tileY: 25 },
        ],
        // Chemistry allee, north arm → court top.
        [
            { tileX: 12, tileY: 23 },
            { tileX: 12, tileY: 28 },
        ],
        // Fountain Court ring (loops around the fountain island).
        [
            { tileX: 10, tileY: 28 },
            { tileX: 14, tileY: 28 },
            { tileX: 14, tileY: 32 },
            { tileX: 10, tileY: 32 },
            { tileX: 10, tileY: 28 },
        ],
        // Canal overlook.
        [
            { tileX: 10, tileY: 30 },
            { tileX: 9, tileY: 30 },
        ],
        // Grande Allee (physics), east arm.
        [
            { tileX: 14, tileY: 30 },
            { tileX: 23, tileY: 30 },
        ],
        // East bosquet allee (terrace → grande allee).
        [
            { tileX: 20, tileY: 23 },
            { tileX: 20, tileY: 30 },
        ],
        // Chemistry allee, south arm → orangery.
        [
            { tileX: 12, tileY: 32 },
            { tileX: 12, tileY: 36 },
        ],
        // Orangery walk.
        [
            { tileX: 12, tileY: 36 },
            { tileX: 7, tileY: 36 },
        ],
    ],
    waterTiles: rect(2, 29, 8, 31),
    landGaps: [],
    plots: [
        { nodeId: "CP.5A", tileX: 13, tileY: 24 },
        { nodeId: "CP.5B", tileX: 11, tileY: 27 },
        { nodeId: "CP.5C", tileX: 9, tileY: 35 },
        { nodeId: "CP.5D", tileX: 24, tileY: 26 },
        { nodeId: "CP.5E", tileX: 13, tileY: 35 },
        { nodeId: "CP.4A", tileX: 19, tileY: 29 },
        { nodeId: "CP.4B", tileX: 16, tileY: 31 },
        { nodeId: "CP.4C", tileX: 21, tileY: 26 },
        { nodeId: "CP.4D", tileX: 22, tileY: 31 },
        { nodeId: "CP.4E", tileX: 15, tileY: 28 },
    ],
    props: [
        { key: "struct-landmark-versailles-fountain", tileX: 12, tileY: 30, hTiles: 3.4 },
        { key: "foliage-versailles-03", tileX: 9, tileY: 27, hTiles: 2.1 },
        { key: "foliage-versailles-03", tileX: 15, tileY: 27, hTiles: 2.1 },
        { key: "foliage-versailles-03", tileX: 9, tileY: 33, hTiles: 2.1 },
        { key: "foliage-versailles-03", tileX: 15, tileY: 33, hTiles: 2.1 },
        { key: "prop-versailles-sig-07", tileX: 9, tileY: 29, hTiles: 1.2 },
        { key: "prop-versailles-sig-07", tileX: 9, tileY: 31, hTiles: 1.2 },
        { key: "prop-versailles-sig-02", tileX: 15, tileY: 24, hTiles: 2.2 },
        { key: "prop-versailles-r0-04", tileX: 18, tileY: 24, hTiles: 1.8 },
        { key: "prop-versailles-r0-14", tileX: 24, tileY: 22, hTiles: 1.6 },
        { key: "prop-versailles-r0-14", tileX: 8, tileY: 37, hTiles: 1.6 },
        { key: "prop-versailles-r0-14", tileX: 10, tileY: 37, hTiles: 1.6 },
        { key: "prop-versailles-sig-06", tileX: 12, tileY: 37, hTiles: 1.8 },
        { key: "prop-versailles-r0-10", tileX: 24, tileY: 30, hTiles: 1.8 },
        { key: "foliage-versailles-12", tileX: 24, tileY: 28, hTiles: 1.4 },
        { key: "foliage-versailles-12", tileX: 24, tileY: 32, hTiles: 1.4 },
    ],
    decor: [
        // Parterre-de-broderie ground decals (the iconic aerial embroidery), non-colliding.
        { key: "prop-versailles-sig-00", tileX: 6, tileY: 25, hTiles: 2.2, flat: true },
        { key: "prop-versailles-sig-05", tileX: 6, tileY: 34, hTiles: 2.2, flat: true },
    ],
    fields: [],
    hedges,
    hedgeKey: "foliage-versailles-20",
    gates: [
        { src: "CP.5A", dst: "CP.5B", tileX: 12, tileY: 26, orientation: "h" },
        { src: "CP.4E", dst: "CP.5B", tileX: 13, tileY: 28, orientation: "v" },
        { src: "CP.4A", dst: "CP.4B", tileX: 17, tileY: 30, orientation: "v" },
        { src: "CP.5B", dst: "CP.5E", tileX: 12, tileY: 33, orientation: "h" },
        { src: "CP.5B", dst: "CP.5D", tileX: 24, tileY: 24, orientation: "h" },
    ],
    waystone: { tileX: 6, tileY: 36 },
    interactions: [
        {
            tileX: 12,
            tileY: 30,
            radius: 2.6,
            title: "The Fountain of First Principles",
            line:
                "The Fountain of First Principles. Physics lifts the water; chemistry teaches it to shine. "
                + "Every allée in this garden begins here.",
        },
        {
            tileX: 9,
            tileY: 30,
            title: "The Canal Overlook",
            line:
                "The Grand Canal runs straight as a good derivation. Master what lies beneath matter, and "
                + "you can see the far end from where you stand.",
        },
        {
            tileX: 24,
            tileY: 30,
            title: "The Exedra",
            line:
                "Marble remembers what students forget: motion, fluids, circuits, waves, atoms — one axis, "
                + "walked in order.",
        },
        {
            tileX: 24,
            tileY: 22,
            title: "The Entrance Urn",
            line:
                "Beyond this hedge, Keukenhof's canals wait for your biomolecules. Bloom the bonds bed "
                + "below — then biology drinks.",
        },
    ],
    critters: [
        { kind: "moteDrift", count: 3, cx: 10, cy: 28, rx: 14, ry: 32, tint: 0xf2f2e4, speed: 12 },
    ],
    palette: {
        grass: ["#567A16", "#4D7112", "#44670E"],
        path: ["#EAE3D2", "#DED2B6"],
        pathRim: "#B3A47C",
        flowers: ["#F2E6C4", "#E7C860", "#D98A9E"],
        flowerDensity: 0.003,
        waterDeep: "#28578B",
        water: "#3A6EA5",
        waterLight: "#7BA7D2",
        shore: "#D9BE8E",
    },
};
