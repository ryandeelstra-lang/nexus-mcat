# Open MCAT Practice Questions (`mcat-mcqs.json`)

A bank of **original, MCAT-style multiple-choice questions** that powers the sector-stone
trials in the garden. Every question is **dedicated to the public domain under
[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/)** — anyone may use, copy, modify,
and redistribute them **for any purpose, including commercial use, with no attribution
required**.

> ⚠️ Not affiliated with or endorsed by the AAMC. Contains **no** real AAMC exam items — every
> question is original writing. "MCAT" is used only to describe the subject scope and style.

## Coverage

≥ 40 questions in each of the eight subjects, grouped under the four MCAT sections used by the
garden's four quadrant stones:

| Section (stone)              | Subjects                                          |
| ---------------------------- | ------------------------------------------------- |
| **B-B** — The Tulip Stone    | Biology, Biochemistry                             |
| **C-P** — The Parterre Stone | General Chemistry, Organic Chemistry, Physics     |
| **P-S** — The Sakura Stone   | Psychology, Sociology                             |
| **CARS** — The Night Stone   | Critical Analysis & Reasoning (original passages) |

## Schema

`mcat-mcqs.json` is `{ meta, questions: Mcq[] }`. Each question:

```jsonc
{
    "id": "BB-biology-001", // stable unique id
    "section": "BB", // BB | CP | PS | CARS
    "subject": "Biology", // human subject label
    "passage": "", // non-empty only for CARS items
    "stem": "…", // the question
    "options": ["A", "B", "C", "D"],
    "answer": 2, // index into options of the ONE correct choice
    "explanation": "…", // why the answer is right
    "difficulty": "medium", // easy | medium | hard
    "topic": "central dogma" // short content tag
}
```

Loaded and shaped into short exams by [`../routes/garden/panels/mcq.ts`](../routes/garden/panels/mcq.ts).
The trials are a **standalone practice surface**: they read this bundled JSON and never touch the
Anki collection or FSRS state (integrity rule I1).

## How these were produced, and why CC0 rather than a found source

The questions were **generated as original items and then screened by an independent blind
re-solve audit** — a separate reviewer solved each question without the answer key, and any item
where the reviewer disagreed with the key, found it ambiguous (0 or >1 defensible answers), found
a factual error, or judged it off-level was dropped. Only items that survived are shipped.

We first searched for a ready-made open bank we could ship instead. The open-license MCAT-MCQ
landscape is thin and, as of 2026-07, does **not** yield a clean, all-subjects, MCAT-format bank
under a no-strings license:

- **OpenStax** relicensed its textbooks from CC BY 4.0 to **CC BY-NC-SA 4.0 on 2026-04-23**
  (NonCommercial — fails a commercial-use bar). Only older mirrored editions
  (e.g. philschatz.com) remain **CC BY 4.0** and cover Biology / Psychology / Sociology as
  _recall_ questions (attribution required; not MCAT-format).
- **Saylor Academy LegacyExams** (CC BY) and **Wikiversity Quizbank** (CC BY-SA) offer
  genuinely-open college-level items for several science subjects, but with attribution /
  share-alike strings, uneven coverage, and non-MCAT formatting.
- **Khan Academy**'s MCAT collection is CC BY-**NC**-SA (NonCommercial — fails).
- **AAMC / UWorld / Kaplan / Princeton Review / Jack Westin** are proprietary.
- ML QA datasets (**MMLU, GPQA, MMLU-Pro, MedMCQA, MedQA**) mostly carry copyrighted or
  gated/derived question text and/or NonCommercial-in-practice terms.
- **CARS-style** reading-comprehension items are essentially absent from open sources.

Original CC0 content is strictly the most permissive outcome (no attribution, no NC trap, no
share-alike, no copyright/leakage risk) and lets us cover all eight subjects uniformly in one
MCAT-styled format. See the full source sweep in the accompanying research report.
