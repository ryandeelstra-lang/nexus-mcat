// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: dev-only palette lookup for the schematic sector preview (preview.test.ts).
// Mirrors the base region palettes; applies any authored override. Not used at runtime.
import { sectorFor } from "./index";
import type { GardenSection } from "./types";

type RGB = [number, number, number];

function hex(h: string): RGB {
    return [
        parseInt(h.slice(1, 3), 16),
        parseInt(h.slice(3, 5), 16),
        parseInt(h.slice(5, 7), 16),
    ];
}

const BASE: Record<GardenSection, { grass: string; water: string; path: string }> = {
    "P-S": { grass: "#829E45", water: "#2E7A8C", path: "#C0A276" },
    "B-B": { grass: "#78892B", water: "#1D6D8E", path: "#8A4E38" },
    "C-P": { grass: "#527510", water: "#3A6EA5", path: "#D6B681" },
    CARS: { grass: "#26402F", water: "#0E3450", path: "#6A4838" },
};

export function effectivePalettePreview(
    section: GardenSection,
): { grass: RGB; water: RGB; path: RGB } {
    const base = BASE[section];
    const o = sectorFor(section)?.palette;
    return {
        grass: hex(o?.grass?.[1] ?? base.grass),
        water: hex(o?.water ?? base.water),
        path: hex(o?.path?.[0] ?? base.path),
    };
}
