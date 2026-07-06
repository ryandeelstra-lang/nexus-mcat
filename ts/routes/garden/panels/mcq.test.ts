// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: the open MCQ bank contract — the sector-stone trials draw from ts/lib/mcat-mcqs.json.
// This gate pins the requirement ("open MCQs, >=40 per subject, anyone can use for anything") and
// the structural integrity every question must hold for the trial UI to grade it correctly.
import { describe, expect, it } from "vitest";

import bank from "$lib/mcat-mcqs.json";
import { buildExam, metaForSection, questionsForSection, sectionCode } from "./mcq";

const SUBJECTS = [
    "Biology",
    "Biochemistry",
    "General Chemistry",
    "Organic Chemistry",
    "Physics",
    "Psychology",
    "Sociology",
    "CARS",
];

describe("open MCQ bank — license + coverage contract", () => {
    it("is dedicated to the public domain (CC0) — usable by anyone for anything", () => {
        expect(bank.meta.license).toBe("CC0-1.0");
    });

    it("carries at least 40 questions in every one of the eight subjects", () => {
        const counts: Record<string, number> = {};
        for (const q of bank.questions) {
            counts[q.subject] = (counts[q.subject] ?? 0) + 1;
        }
        for (const subject of SUBJECTS) {
            expect(counts[subject] ?? 0, `subject ${subject}`).toBeGreaterThanOrEqual(40);
        }
    });

    it("covers all four section stones", () => {
        const sections = new Set(bank.questions.map((q) => q.section));
        for (const s of ["BB", "CP", "PS", "CARS"]) {
            expect(sections.has(s), `section ${s}`).toBe(true);
        }
    });
});

describe("MCQ structural integrity — every item is gradable", () => {
    it("each question has exactly 4 non-empty, distinct options and an in-range answer", () => {
        for (const q of bank.questions) {
            expect(q.options.length, q.id).toBe(4);
            for (const o of q.options) {
                expect(typeof o).toBe("string");
                expect(o.trim().length, q.id).toBeGreaterThan(0);
            }
            expect(new Set(q.options).size, `${q.id} distinct options`).toBe(4);
            expect(q.answer, q.id).toBeGreaterThanOrEqual(0);
            expect(q.answer, q.id).toBeLessThanOrEqual(3);
            expect(q.stem.trim().length, q.id).toBeGreaterThan(0);
            expect(q.explanation.trim().length, q.id).toBeGreaterThan(0);
        }
    });

    it("every id is unique", () => {
        const ids = bank.questions.map((q) => q.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it("CARS items carry a passage; science items do not need one", () => {
        const cars = bank.questions.filter((q) => q.section === "CARS");
        expect(cars.length).toBeGreaterThan(0);
        for (const q of cars) {
            expect(q.passage.trim().length, `${q.id} passage`).toBeGreaterThan(0);
        }
    });
});

describe("exam shaping", () => {
    it("normalizes the world's hyphenated section ids to bank codes", () => {
        expect(sectionCode("B-B")).toBe("BB");
        expect(sectionCode("C-P")).toBe("CP");
        expect(sectionCode("P-S")).toBe("PS");
        expect(sectionCode("CARS")).toBe("CARS");
    });

    it("questionsForSection accepts a world id and returns only that section", () => {
        const qs = questionsForSection("B-B");
        expect(qs.length).toBeGreaterThan(0);
        expect(qs.every((q) => q.section === "BB")).toBe(true);
    });

    it("buildExam returns up to n questions, all from the requested section", () => {
        const exam = buildExam("C-P", 5);
        expect(exam.length).toBe(5);
        expect(exam.every((q) => q.section === "CP")).toBe(true);
    });

    it("gives each stone a human title and subject label", () => {
        expect(metaForSection("P-S").subjectLabel).toMatch(/Psych/i);
        expect(metaForSection("CARS").stoneTitle.length).toBeGreaterThan(0);
    });
});
