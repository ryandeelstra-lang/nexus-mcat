// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: the authored-sector registry. worldgen consumes these to compose the four great
// gardens by hand (docs/sectors/*). A section without a layout here falls back to the legacy
// serpentine generator, so the world is always buildable during the transition.
import type { GardenSection } from "../worldgen";
import { GARDENS } from "./gardens";
import { KEUKENHOF } from "./keukenhof";
import { SAKURA } from "./sakura";
import type { SectorLayout } from "./types";
import { VERSAILLES } from "./versailles";

export const SECTORS: Partial<Record<GardenSection, SectorLayout>> = {
    "P-S": SAKURA,
    "B-B": KEUKENHOF,
    "C-P": VERSAILLES,
    CARS: GARDENS,
};

export function sectorFor(section: GardenSection): SectorLayout | undefined {
    return SECTORS[section];
}

export type { SectorLayout };
export * from "./types";
