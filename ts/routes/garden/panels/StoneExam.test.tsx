// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: smoke-pins the sector-stone trial panel. Rendered to static markup (the repo's
// no-jsdom pattern) — asserts the intro beat mounts without throwing, shapes a real exam from
// the bundled MCQ bank, and shows the stone's name, subjects, and the water terms. The grading
// and water-reward math are covered by economy.test.ts + mcq.test.ts.
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { GardenStore } from "../state/store";
import { StoneExam } from "./StoneExam";

const noop = (): void => undefined;
const fakeStore = {} as unknown as GardenStore; // intro render never touches the store

describe("StoneExam — intro beat", () => {
    it("mounts for a science stone and shows its name, subjects, and the water reward", () => {
        const html = renderToStaticMarkup(
            <StoneExam section="C-P" store={fakeStore} onGranted={noop} onClose={noop} />,
        );
        expect(html).toContain("The Parterre Stone");
        expect(html).toContain("Chemistry &amp; Physics");
        expect(html).toContain("water"); // the reward terms
        expect(html).toContain("Begin the trial");
    });

    it("accepts every world section id without crashing", () => {
        for (const section of ["B-B", "C-P", "P-S", "CARS"]) {
            const html = renderToStaticMarkup(
                <StoneExam section={section} store={fakeStore} onGranted={noop} onClose={noop} />,
            );
            // Either a real trial intro or the graceful empty state — never a blank render.
            expect(html.length).toBeGreaterThan(0);
            expect(html).toContain("Stone");
        }
    });
});
