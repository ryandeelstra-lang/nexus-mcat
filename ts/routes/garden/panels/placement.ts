// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: the master's 20-question placement test (2026-07-03 directive, MCQ'd 2026-07-05
// — Decision 46) — pure planning + tally logic, unit-tested; PlacementTest.tsx owns the UI.
// The plan walks ALL FOUR MCAT sections evenly (the real exam weighs them equally), drawing
// from the same open CC0 MCQ bank as the sector-stone trials (panels/mcq.ts), interleaved so
// the test roams the whole island. The player never sees a correct/wrong verdict per
// question — every pick is tallied silently and the whole diagnostic surfaces only in the
// calibration/result beat at the end. This is a standalone practice surface like the stone
// trials: it never touches the Anki collection or FSRS (I1); plant/mastery state seeds from
// the player's real subsequent study, not from this diagnostic.

import { buildExam, type Mcq } from "./mcq";

export const PLACEMENT_QUESTIONS = 20;

/** Canonical section walk order (matches the island quilt NW->NE->SW->SE). */
export const SECTION_ORDER = ["P-S", "B-B", "C-P", "CARS"] as const;

export interface SectionTally {
    asked: number;
    knew: number;
}

/**
 * Build the ordered placement exam: an even per-section quota (remainders go to the
 * earliest sections in SECTION_ORDER), questions drawn from the open MCQ bank, and the
 * final order interleaved section-by-section so the diagnostic roams the whole island.
 */
export function buildPlacementExam(total: number = PLACEMENT_QUESTIONS): Mcq[] {
    if (total <= 0) {
        return [];
    }
    const base = Math.floor(total / SECTION_ORDER.length);
    const remainder = total % SECTION_ORDER.length;
    // mcq.ts's bank stores sections as its own codes ("BB"/"CP"/"PS"/"CARS"); re-stamp each
    // drawn question with the world's hyphenated id so the tally/GARDEN_NAMES stay consistent
    // with the rest of the placement flow.
    const queues = SECTION_ORDER.map((section, idx) =>
        buildExam(section, base + (idx < remainder ? 1 : 0)).map((q) => ({ ...q, section }))
    );

    // Interleave: one question per section per round, so the test roams the island.
    const plan: Mcq[] = [];
    for (let round = 0; plan.length < total; round++) {
        let took = false;
        for (const queue of queues) {
            if (round < queue.length) {
                plan.push(queue[round]);
                took = true;
            }
        }
        if (!took) {
            break;
        }
    }
    return plan;
}

/** Accumulate one graded placement answer into the per-section tally. */
export function applyOutcome(
    tally: Record<string, SectionTally>,
    section: string,
    knew: boolean,
): Record<string, SectionTally> {
    const prev = tally[section] ?? { asked: 0, knew: 0 };
    return {
        ...tally,
        [section]: { asked: prev.asked + 1, knew: prev.knew + (knew ? 1 : 0) },
    };
}

/** Sections weakest-first by sample accuracy (only sections that were actually asked). */
export function sectionsByAccuracy(tally: Record<string, SectionTally>): string[] {
    return Object.entries(tally)
        .filter(([, t]) => t.asked > 0)
        .sort(([, a], [, b]) => a.knew / a.asked - b.knew / b.asked)
        .map(([section]) => section);
}

/** Whole days from `nowMs` until an ISO `YYYY-MM-DD` exam date; null when unknown/invalid. */
export function daysUntil(examDateIso: string | null, nowMs: number): number | null {
    if (!examDateIso) {
        return null;
    }
    const t = Date.parse(`${examDateIso}T00:00:00`);
    if (Number.isNaN(t)) {
        return null;
    }
    return Math.ceil((t - nowMs) / 86_400_000);
}

/**
 * Assemble year/month/day parts into a canonical ISO `YYYY-MM-DD`, or null when any part is
 * missing or the trio is not a real calendar date (month 13, Feb 30, non-leap Feb 29 …).
 *
 * The placement intake collects the exam date through plain numeric fields that feed this
 * helper — deliberately NOT a native `<input type="date">`. That control needs the OS date-
 * picker popup, and popping it inside Anki's embedded QtWebEngine renderer can blank/kill the
 * web process; with the React root un-mounted the whole game vanishes. Numeric fields never
 * open a native popup, so the date step can no longer take the garden down with it.
 */
export function partsToIsoDate(
    year: number | null,
    month: number | null,
    day: number | null,
): string | null {
    if (year === null || month === null || day === null) {
        return null;
    }
    if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
        return null;
    }
    if (year < 1000 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) {
        return null;
    }
    // Round-trip through Date to reject impossible days (Feb 30, Apr 31, non-leap Feb 29).
    const date = new Date(year, month - 1, day);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
        return null;
    }
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const _WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const _MONTHS = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
];

/** Human confirmation of an ISO date ("Wed · Oct 15, 2026"), or "" when unknown/invalid. */
export function formatExamDate(examDateIso: string | null): string {
    if (!examDateIso) {
        return "";
    }
    const t = Date.parse(`${examDateIso}T00:00:00`);
    if (Number.isNaN(t)) {
        return "";
    }
    const d = new Date(t);
    return `${_WEEKDAYS[d.getDay()]} · ${_MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}
