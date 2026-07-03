// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: KEUKENHOF (B-B, Bio/Biochem) — "The Machinery of Life". Authored from docs/sectors/02.
// A Dutch flower-park: a straight canal with a stone lock-bridge, rectangular tulip ribbons in
// blocks of color, a windmill on the NE rise. You climb molecule → cell → organ system inland.
// All coordinates are WORLD tiles (this rect spans x 30..55, y 0..17).
import { hline, subtractTiles } from "./helpers";
import type { SectorLayout } from "./types";

// Canal: straight strip at y=6 from x34..52, EXCEPT the lock-bridge crossing at (47,6).
const canal = subtractTiles(hline(6, 34, 52), [{ tileX: 47, tileY: 6 }]);

export const KEUKENHOF: SectorLayout = {
    section: "B-B",
    entrance: { tileX: 31, tileY: 15 },
    pathWaypoints: [
        // MAIN: SW entrance → 2A junction → lock-bridge → windmill rise.
        [
            { tileX: 31, tileY: 15 },
            { tileX: 34, tileY: 14 },
            { tileX: 37, tileY: 13 },
            { tileX: 40, tileY: 12 },
            { tileX: 42, tileY: 12 },
            { tileX: 43, tileY: 11 },
            { tileX: 45, tileY: 10 },
            { tileX: 47, tileY: 8 },
            { tileX: 47, tileY: 6 },
            { tileX: 47, tileY: 5 },
            { tileX: 48, tileY: 4 },
            { tileX: 51, tileY: 4 },
        ],
        // Genetics spur (1B, 1C).
        [
            { tileX: 34, tileY: 14 },
            { tileX: 35, tileY: 15 },
            { tileX: 37, tileY: 16 },
            { tileX: 42, tileY: 16 },
        ],
        // Metabolism spur (1D).
        [
            { tileX: 34, tileY: 14 },
            { tileX: 35, tileY: 12 },
            { tileX: 36, tileY: 10 },
            { tileX: 37, tileY: 9 },
        ],
        // Cell-division spur (2C).
        [
            { tileX: 42, tileY: 12 },
            { tileX: 43, tileY: 10 },
            { tileX: 44, tileY: 9 },
        ],
        // Microbe spur (2B).
        [
            { tileX: 42, tileY: 12 },
            { tileX: 44, tileY: 13 },
            { tileX: 46, tileY: 13 },
        ],
    ],
    waterTiles: canal,
    landGaps: [{ tileX: 47, tileY: 6 }],
    plots: [
        { nodeId: "BB.1A", tileX: 33, tileY: 13 },
        { nodeId: "BB.1B", tileX: 37, tileY: 15 },
        { nodeId: "BB.1C", tileX: 41, tileY: 15 },
        { nodeId: "BB.1D", tileX: 37, tileY: 8 },
        { nodeId: "BB.2A", tileX: 41, tileY: 11 },
        { nodeId: "BB.2B", tileX: 47, tileY: 13 },
        { nodeId: "BB.2C", tileX: 45, tileY: 9 },
        { nodeId: "BB.3A", tileX: 48, tileY: 3 },
        { nodeId: "BB.3B", tileX: 51, tileY: 3 },
    ],
    props: [
        { key: "struct-landmark-keukenhof-windmill", tileX: 49, tileY: 1 },
        { key: "prop-keukenhof-sig-00", tileX: 44, tileY: 3 },
        { key: "prop-keukenhof-sig-01", tileX: 31, tileY: 14 },
        { key: "prop-keukenhof-sig-04", tileX: 32, tileY: 16 },
        { key: "prop-keukenhof-sig-02", tileX: 40, tileY: 10 },
        { key: "prop-keukenhof-sig-03", tileX: 47, tileY: 4 },
        { key: "prop-keukenhof-sig-05", tileX: 52, tileY: 4 },
        { key: "foliage-keukenhof-00", tileX: 35, tileY: 7 },
        { key: "foliage-keukenhof-00", tileX: 41, tileY: 7 },
        { key: "foliage-keukenhof-02", tileX: 43, tileY: 5 },
        { key: "foliage-keukenhof-02", tileX: 45, tileY: 4 },
        { key: "foliage-keukenhof-06", tileX: 31, tileY: 11 },
        { key: "foliage-keukenhof-06", tileX: 52, tileY: 13 },
    ],
    decor: [
        // The lock-bridge is walkable decor; the BB.2A→BB.3A gate controls passage.
        { key: "struct-bridge-stone", tileX: 47, tileY: 6, hTiles: 2.0 },
    ],
    fields: [
        { x0: 34, y0: 2, x1: 46, y1: 4, assets: ["prop-keukenhof-18", "prop-keukenhof-15"] },
        { x0: 31, y0: 10, x1: 38, y1: 11, assets: ["prop-keukenhof-08"] },
        { x0: 39, y0: 7, x1: 46, y1: 8, assets: ["prop-keukenhof-04"] },
        { x0: 43, y0: 16, x1: 52, y1: 16, assets: ["prop-keukenhof-11"] },
        { x0: 34, y0: 16, x1: 35, y1: 16, assets: ["prop-keukenhof-13"] },
    ],
    gates: [
        { src: "BB.1A", dst: "BB.1B", tileX: 35, tileY: 15, orientation: "v" },
        { src: "BB.1B", dst: "BB.1C", tileX: 39, tileY: 16, orientation: "v" },
        { src: "BB.1A", dst: "BB.1D", tileX: 36, tileY: 10, orientation: "h" },
        { src: "BB.1A", dst: "BB.2A", tileX: 40, tileY: 12, orientation: "v" },
        { src: "BB.2A", dst: "BB.2C", tileX: 43, tileY: 10, orientation: "v" },
        { src: "BB.2A", dst: "BB.2B", tileX: 45, tileY: 13, orientation: "v" },
        { src: "BB.2A", dst: "BB.3A", tileX: 47, tileY: 6, orientation: "h" },
        { src: "BB.3A", dst: "BB.3B", tileX: 50, tileY: 4, orientation: "v" },
    ],
    waystone: { tileX: 34, tileY: 12 },
    interactions: [
        {
            tileX: 47,
            tileY: 6,
            title: "The Lock-Bridge",
            line:
                "The lock lifts the water uphill a step at a time. Bloom the cell, and the way over to the "
                + "body's great systems opens — no shortcuts across still water.",
        },
        {
            tileX: 49,
            tileY: 1,
            title: "The Windmill",
            line:
                "The mill turns grain to bread the way your cells turn fuel to life — patient, relentless "
                + "machinery. Everything on this rise is built from the beds below.",
        },
        {
            tileX: 33,
            tileY: 13,
            title: "The Protein Bed",
            line:
                "Every tulip in this park began as a bulb; everything alive began as a protein. You've come "
                + "from the chemists' garden — start biology here, at the root.",
        },
    ],
    critters: [
        { kind: "moteDrift", count: 3, cx: 40, cy: 3, rx: 34, ry: 11, tint: 0xffd166, speed: 6 },
        { kind: "shadowLoop", count: 2, cx: 43, cy: 6, rx: 6, ry: 0.4, tint: 0x1a1a1a, speed: 0.6 },
    ],
    palette: {
        grass: ["#8FA83C", "#83992F", "#748A27"],
        path: ["#A15A3E", "#8E4A32"],
        pathRim: "#5E3324",
        flowers: ["#E4572E", "#FFB703", "#E76F9E", "#7B2CBF", "#F2F2E4"],
        flowerDensity: 0.008,
    },
};
