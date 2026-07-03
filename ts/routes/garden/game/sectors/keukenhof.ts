// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: KEUKENHOF (B-B, Bio/Biochem) — "The Machinery of Life". Compact re-authoring for
// the shrunk overworld (2026-07-03): a straight canal with a flat ford crossing, the windmill
// alone on the NE rise, poplars lining the water. NO authored flowers — the player grows them
// (empty beds bloom as topics bloom). You climb molecule → cell → organ system inland.
// All coordinates are WORLD tiles (this rect spans x 25..43, y 0..12).
import { hline, subtractTiles } from "./helpers";
import type { SectorLayout } from "./types";

// Canal: straight strip at y=4 from x26..43, EXCEPT the flat ford crossing at (38,4).
const canal = subtractTiles(hline(4, 26, 43), [{ tileX: 38, tileY: 4 }]);

export const KEUKENHOF: SectorLayout = {
    section: "B-B",
    entrance: { tileX: 26, tileY: 11 },
    pathWaypoints: [
        // MAIN: SW entrance → east along the beds → north over the ford → windmill rise.
        [
            { tileX: 26, tileY: 11 },
            { tileX: 38, tileY: 11 },
            { tileX: 38, tileY: 2 },
            { tileX: 41, tileY: 2 },
        ],
        // Inland spur (1D metabolism, 2A cell) off the entrance lane.
        [
            { tileX: 30, tileY: 11 },
            { tileX: 30, tileY: 8 },
            { tileX: 34, tileY: 8 },
        ],
    ],
    waterTiles: canal,
    landGaps: [{ tileX: 38, tileY: 4 }],
    plots: [
        { nodeId: "BB.1A", tileX: 26, tileY: 10 },
        { nodeId: "BB.1B", tileX: 29, tileY: 12 },
        { nodeId: "BB.1C", tileX: 33, tileY: 12 },
        { nodeId: "BB.1D", tileX: 29, tileY: 8 },
        { nodeId: "BB.2A", tileX: 33, tileY: 7 },
        { nodeId: "BB.2B", tileX: 37, tileY: 12 },
        { nodeId: "BB.2C", tileX: 37, tileY: 6 },
        { nodeId: "BB.3A", tileX: 37, tileY: 2 },
        { nodeId: "BB.3B", tileX: 42, tileY: 2 },
    ],
    props: [
        { key: "struct-landmark-keukenhof-windmill", tileX: 40, tileY: 1 },
        { key: "foliage-keukenhof-00", tileX: 28, tileY: 3 },
        { key: "foliage-keukenhof-00", tileX: 33, tileY: 3 },
        { key: "foliage-keukenhof-02", tileX: 42, tileY: 5 },
        { key: "foliage-keukenhof-06", tileX: 27, tileY: 7 },
        { key: "foliage-keukenhof-06", tileX: 41, tileY: 9 },
    ],
    decor: [],
    fields: [],
    gates: [],
    waystone: { tileX: 34, tileY: 10 },
    interactions: [
        {
            tileX: 38,
            tileY: 4,
            title: "The Ford",
            line: "The canal runs shallow here — a stone sill laid at grade, worn smooth by boots. "
                + "Cross when you're ready: the mill on the rise grinds nothing until the beds below feed it.",
        },
        {
            tileX: 40,
            tileY: 1,
            title: "The Windmill",
            line: "The mill turns grain to bread the way your cells turn fuel to life — patient, relentless "
                + "machinery. Everything on this rise is built from the beds below.",
        },
    ],
    critters: [
        { kind: "moteDrift", count: 3, cx: 36, cy: 6, rx: 28, ry: 10, tint: 0xffd166, speed: 6 },
        { kind: "shadowLoop", count: 2, cx: 32, cy: 4, rx: 5, ry: 0.4, tint: 0x1a1a1a, speed: 0.6 },
    ],
    palette: {
        grass: ["#8FA83C", "#83992F", "#748A27"],
        path: ["#A15A3E", "#8E4A32"],
        pathRim: "#5E3324",
        flowers: ["#E4572E", "#FFB703", "#E76F9E", "#7B2CBF", "#F2F2E4"],
        flowerDensity: 0,
    },
};
