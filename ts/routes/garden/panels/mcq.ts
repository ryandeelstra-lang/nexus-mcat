// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: the open MCQ bank behind the sector-stone trials. Every question is ORIGINAL
// and dedicated to the public domain (CC0 1.0) — anyone may use them for anything, including
// commercial redistribution, with no attribution required (see ts/lib/mcat-mcqs.json `meta`).
// The bank is bundled at build time via the $lib JSON import (the same pattern as
// state/mastery.ts's graph-sidecar). This module only shapes short exams by section; it never
// touches the Anki collection or FSRS — the trials are a standalone practice surface (I1).

import bank from "$lib/mcat-mcqs.json";

/** One multiple-choice question. `passage` is non-empty only for CARS items. */
export interface Mcq {
    id: string;
    section: string;
    subject: string;
    passage: string;
    stem: string;
    options: string[];
    /** Index into `options` of the single correct answer. */
    answer: number;
    explanation: string;
    difficulty: string;
    topic: string;
}

interface McqBank {
    meta: Record<string, unknown> & { license?: string; note?: string };
    questions: Mcq[];
}

const BANK = bank as McqBank;

/** The four sector codes used in the bank (the world uses hyphenated ids like "B-B"). */
export type SectionCode = "BB" | "CP" | "PS" | "CARS";

/** Normalize the world's hyphenated GardenSection ("B-B") to a bank code ("BB"). */
export function sectionCode(section: string): string {
    return section.replace(/-/g, "").toUpperCase();
}

export interface SectionMeta {
    code: string;
    /** The stone's in-world name (kept in the garden's voice). */
    stoneTitle: string;
    /** Human-readable subjects this stone covers. */
    subjectLabel: string;
}

const SECTION_META: Record<string, SectionMeta> = {
    BB: { code: "BB", stoneTitle: "The Tulip Stone", subjectLabel: "Biology & Biochemistry" },
    CP: { code: "CP", stoneTitle: "The Parterre Stone", subjectLabel: "Chemistry & Physics" },
    PS: { code: "PS", stoneTitle: "The Sakura Stone", subjectLabel: "Psychology & Sociology" },
    CARS: { code: "CARS", stoneTitle: "The Night Stone", subjectLabel: "Critical Analysis & Reasoning" },
};

export function metaForSection(section: string): SectionMeta {
    const code = sectionCode(section);
    return SECTION_META[code] ?? { code, stoneTitle: "The Standing Stone", subjectLabel: code };
}

/** All questions for a section (world id or bank code both accepted). */
export function questionsForSection(section: string): Mcq[] {
    const code = sectionCode(section);
    return BANK.questions.filter((q) => q.section.toUpperCase() === code);
}

/** Fisher–Yates shuffle on a copy (browser runtime — Math.random is fine here). */
function shuffled<T>(arr: readonly T[]): T[] {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

/**
 * Build a short trial for a section: up to `n` random questions (fewer only if the bank for
 * that section is smaller than `n`). Returns [] if the section has no questions.
 */
export function buildExam(section: string, n = 5): Mcq[] {
    return shuffled(questionsForSection(section)).slice(0, n);
}

export const bankMeta = BANK.meta;

export function bankCount(): number {
    return BANK.questions.length;
}
