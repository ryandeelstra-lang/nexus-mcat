// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: VERSAILLES (C-P, Chem/Phys) — "The Laws Beneath Matter". Reauthored from live
// playtesting (2026-07-03): ONE long winding promenade snakes through the whole parterre in
// four sweeps, lined by clipped hedges that follow the path with deliberate breaks. The
// fountain is the centerpiece — the path dips around it so you walk right past. No doors,
// no canal, no flower scatter; a few marble statues mark the bends. All coordinates are
// WORLD tiles (this rect spans x 0..18, y 19..31).
import { hline, tiles } from "./helpers";
import type { SectorLayout } from "./types";

// Hedge lines shadow the promenade one tile off each sweep, with breaks at plot frontages
// and at the NE mouth so the plaza connector always reaches the trail.
const hedges = tiles(
    // Sweep 1 (y=20): hedge above, breaks flanking the 4A plot and clear of the NE mouth.
    hline(19, 2, 6),
    hline(19, 8, 9),
    hline(19, 13, 15),
    // Sweep 2 (y=23): hedge above, breaks at the 4E frontage and before 5A.
    hline(22, 3, 5),
    hline(22, 8, 10),
    hline(22, 12, 13),
    // Sweep 3 (y=26): hedge below, breaks aligned with sweep-4's so you can slip through.
    hline(27, 3, 6),
    hline(27, 9, 11),
    hline(27, 13, 14),
    // Sweep 4 (y=29): hedge above.
    hline(28, 4, 6),
    hline(28, 9, 11),
    hline(28, 13, 14),
    // South rim below the last sweep, open around the 5C/5E plots.
    hline(31, 4, 6),
    hline(31, 11, 12),
);

export const VERSAILLES: SectorLayout = {
    section: "C-P",
    entrance: { tileX: 17, tileY: 20 },
    pathWaypoints: [
        // One serpentine promenade: NE entrance → four sweeps → SE end. The second sweep
        // dips a row (x 7..11) so the path bends around the fountain centerpiece at (9,25).
        [
            { tileX: 17, tileY: 20 },
            { tileX: 2, tileY: 20 },
            { tileX: 2, tileY: 23 },
            { tileX: 7, tileY: 23 },
            { tileX: 7, tileY: 24 },
            { tileX: 11, tileY: 24 },
            { tileX: 11, tileY: 23 },
            { tileX: 16, tileY: 23 },
            { tileX: 16, tileY: 26 },
            { tileX: 2, tileY: 26 },
            { tileX: 2, tileY: 29 },
            { tileX: 17, tileY: 29 },
        ],
    ],
    waterTiles: [],
    landGaps: [],
    plots: [
        // Walk order along the promenade tracks the prereqs loosely: 5D at the NE seam
        // (the chemistry→biochem read toward Keukenhof), 5A/4A right off the entrance,
        // then 4E/4C, the 5B/4B middle sweep, and 5E/5C deepest on the last sweep.
        { nodeId: "CP.5D", tileX: 17, tileY: 21 },
        { nodeId: "CP.5A", tileX: 14, tileY: 21 },
        { nodeId: "CP.4A", tileX: 11, tileY: 19 },
        { nodeId: "CP.4E", tileX: 7, tileY: 21 },
        { nodeId: "CP.4C", tileX: 1, tileY: 22 },
        { nodeId: "CP.5B", tileX: 5, tileY: 24 },
        { nodeId: "CP.4B", tileX: 13, tileY: 24 },
        { nodeId: "CP.4D", tileX: 16, tileY: 27 },
        { nodeId: "CP.5C", tileX: 9, tileY: 30 },
        { nodeId: "CP.5E", tileX: 14, tileY: 30 },
    ],
    props: [
        // The centerpiece: the fountain sits dead-center of the rect, off the path, with
        // the promenade passing adjacent above (y=24 dip) and below (y=26 sweep).
        { key: "struct-landmark-versailles-fountain", tileX: 9, tileY: 25, hTiles: 3.4 },
        { key: "foliage-versailles-03", tileX: 8, tileY: 25, hTiles: 2.1 },
        { key: "foliage-versailles-03", tileX: 10, tileY: 25, hTiles: 2.1 },
        // Occasional statues, one at each sweeping bend.
        { key: "prop-versailles-sig-02", tileX: 1, tileY: 20, hTiles: 2.2 },
        { key: "prop-versailles-r0-04", tileX: 17, tileY: 24, hTiles: 1.8 },
        { key: "prop-versailles-r0-10", tileX: 1, tileY: 27, hTiles: 1.8 },
    ],
    decor: [],
    fields: [],
    hedges,
    hedgeKey: "foliage-versailles-20",
    gates: [],
    waystone: { tileX: 17, tileY: 30 },
    interactions: [
        {
            tileX: 9,
            tileY: 25,
            radius: 2.6,
            title: "The Fountain of First Principles",
            line: "The Fountain of First Principles. Physics lifts the water; chemistry teaches it to shine. "
                + "The whole promenade winds around this basin.",
        },
        {
            tileX: 17,
            tileY: 24,
            title: "The Exedra",
            line: "Marble remembers what students forget: motion, fluids, circuits, waves, atoms — one long "
                + "walk, taken in order.",
        },
    ],
    critters: [
        { kind: "moteDrift", count: 3, cx: 7, cy: 24, rx: 11, ry: 26, tint: 0xf2f2e4, speed: 12 },
    ],
    palette: {
        grass: ["#567A16", "#4D7112", "#44670E"],
        path: ["#EAE3D2", "#DED2B6"],
        pathRim: "#B3A47C",
        flowers: ["#F2E6C4", "#E7C860", "#D98A9E"],
        flowerDensity: 0,
        waterDeep: "#28578B",
        water: "#3A6EA5",
        waterLight: "#7BA7D2",
        shore: "#D9BE8E",
    },
};
