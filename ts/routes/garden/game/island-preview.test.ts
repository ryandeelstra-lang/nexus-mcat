// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: DEV-ONLY Overlook preview — eyeball the Super Depth Analysis island
// (sky, clouds, cliff underside, sister islets) without launching the engine.
// Writes /tmp/island-preview.ppm when CHARGED_UP_PREVIEW=1; otherwise a passing no-op.
import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { buildIslandPlan, renderIslandSurface } from "./island";

function encodePpm(w: number, h: number, rgb: Uint8Array): Uint8Array {
    const header = new TextEncoder().encode(`P6\n${w} ${h}\n255\n`);
    const out = new Uint8Array(header.length + rgb.length);
    out.set(header, 0);
    out.set(rgb, header.length);
    return out;
}

describe("island preview", () => {
    it("renders the Overlook when CHARGED_UP_PREVIEW=1", { timeout: 60_000 }, () => {
        if (process.env.CHARGED_UP_PREVIEW !== "1") {
            expect(true).toBe(true);
            return;
        }
        const plan = buildIslandPlan();
        const surface = renderIslandSurface(plan);
        const rgb = new Uint8Array(surface.width * surface.height * 3);
        for (let i = 0; i < surface.width * surface.height; i++) {
            rgb[i * 3] = surface.data[i * 4];
            rgb[i * 3 + 1] = surface.data[i * 4 + 1];
            rgb[i * 3 + 2] = surface.data[i * 4 + 2];
        }
        const ppm = encodePpm(surface.width, surface.height, rgb);
        writeFileSync("/tmp/island-preview.ppm", ppm);
        expect(ppm.length).toBeGreaterThan(100);
    });
});
