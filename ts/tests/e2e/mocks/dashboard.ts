// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up screenshot harness (test-only): JSON fixtures for the /_anki/scoresDashboard endpoint so
// the three-scores dashboard can be rendered in its key honest states (real-data abstention; synthetic
// caveat). Shapes match the Dashboard interface in ScoresDashboard.svelte verbatim — the harness only
// supplies data, it never changes when a score is shown.

// Memory present (with a wide, honest band) + Readiness LOCKED behind the give-up floor + coverage.
export const dashLocked = {
    memory: {
        available: true,
        point: 0.62,
        range: [0.48, 0.74],
        confidence: "low",
        evidence: "From 1,240 graded reviews across 18 of 31 content categories.",
        missing_data: "13 categories have no cards yet — adding them tightens the band.",
        data_provenance: "real",
    },
    performance: {
        available: false,
        reason: "Performance unlocks after your first timed block.",
        data_provenance: "real",
    },
    readiness: {
        available: false,
        reason: "Prove a few more topics and we'll chart your trajectory to test day.",
        graded_reviews: 40,
        graded_reviews_required: 120,
        coverage_pct: 55,
        coverage_required_pct: 80,
        data_provenance: "real",
    },
    coverage: {
        gate_covered: 18,
        gate_total: 31,
        gate_fraction: 18 / 31,
        display_covered: 19,
        display_total: 34,
        display_fraction: 19 / 34,
        uncovered_content_categories: ["4A", "4D", "9B"],
    },
};

// Same shape, but computed on synthetic practice data → the amber honesty caveat banner shows.
export const dashSynthetic = {
    ...dashLocked,
    memory: { ...dashLocked.memory, data_provenance: "synthetic" },
    readiness: { ...dashLocked.readiness, data_provenance: "synthetic" },
};
