// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: pins the Almanac's score rendering against the REAL engine payload shape
// (scores/display.py emits `point`, not `value` — the 2026-07-05 audit found the panel reading
// the wrong key, so the point never rendered). When readiness is available the panel must show
// all of: point + range + confidence + the UNVALIDATED note; when it abstains, the honest reason.
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AlmanacPanel } from "./AlmanacPanel";
import type { DashboardData } from "./rpc";

const noop = async () => {};

function render(dashboard: DashboardData | null): string {
    return renderToStaticMarkup(
        <AlmanacPanel dashboard={dashboard} onRefresh={noop} onClose={() => {}} />,
    );
}

/** The engine's real available-readiness payload shape (scores/display.py readiness_display). */
const availableDashboard = {
    memory: {
        available: true,
        point: 0.83,
        range: [0.75, 0.91],
        confidence: "ok",
    },
    performance: {
        available: true,
        point: 0.7083,
        range: [0.5417, 0.8333],
        evidence: "held-out accuracy on 24 exam-style rewordings; majority baseline 0.54",
        note: "wrong-answer rate 29%; 90% bootstrap range",
    },
    readiness: {
        available: true,
        point: 498,
        range: [486, 511],
        confidence: "low",
        note: "mapping UNVALIDATED against real outcomes",
        coverage_pct: 77.4,
    },
    coverage: {
        gate_covered: 24,
        gate_total: 31,
        display_covered: 26,
        display_total: 34,
        uncovered_content_categories: ["Biochemistry 5D"],
    },
} as DashboardData;

describe("AlmanacPanel — available scores (engine payload shape)", () => {
    it("renders the readiness point, range, confidence, AND the UNVALIDATED note", () => {
        const html = render(availableDashboard);
        expect(html).toContain("498"); // the point (engine key `point`, not `value`)
        expect(html).toContain("486");
        expect(html).toContain("511");
        expect(html).toContain("Confidence: low");
        expect(html).toContain("UNVALIDATED"); // honesty stamp must reach the player
    });

    it("renders the memory point from the engine's `point` key", () => {
        const html = render(availableDashboard);
        expect(html).toContain("0.83");
        expect(html).toContain("0.75");
        expect(html).toContain("0.91");
    });

    it("renders the measured performance number with its bootstrap range", () => {
        const html = render(availableDashboard);
        expect(html).toContain("0.71");
        expect(html).toContain("0.54");
        expect(html).toContain("0.83");
    });
});

describe("AlmanacPanel — readiness abstention", () => {
    it("passes the no-eval abstain reason through verbatim (honesty is never edited away)", () => {
        const html = render({
            readiness: {
                available: false,
                reason: "no performance evaluation available — the 472-528 map runs only on a "
                    + "measured held-out accuracy (docs/score-mapping.md), never a default",
                graded_reviews: 1400,
            },
            coverage: { gate_covered: 24, gate_total: 31 },
        } as DashboardData);
        expect(html).toContain("no performance evaluation available");
        expect(html).toContain("24 / 31");
        expect(html).not.toContain("almanac-value"); // no point rendered while abstaining
    });
});
