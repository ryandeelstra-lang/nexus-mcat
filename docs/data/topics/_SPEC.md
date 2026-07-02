# Topic-layer generation spec (charged_up / Nexus knowledge graph)

You are one of several parallel agents building the **topic layer** of an MCAT knowledge graph for a
premium study product. Correctness matters — a real student's study plan depends on it. Output is
consumed by a deterministic assembler, so follow this contract **exactly**.

## The big picture

The graph's top spine already exists and is FROZEN: 4 sections → 10 Foundational Concepts → 31 AAMC
content categories (+ 3 CARS reasoning skills). Your job is to add the depth **beneath the content
categories**: every **topic** and **subtopic** the AAMC content outline lists, plus the **prerequisite
relationships** among them. Ground everything in the AAMC "What's on the MCAT Exam?" content outline
(the standard blueprint). Be complete against the real exam; do not invent non-MCAT material.

## ID scheme (follow EXACTLY — the assembler matches on these)

- Section prefixes: `C-P → CP.` `B-B → BB.` `P-S → PS.` `CARS → CARS.`
- Category ids are GIVEN to you, already prefixed, e.g. `BB.1A`, `CP.4E`, `PS.6A`, `CARS.FOC`.
- **Topic id** = `<CATEGORY_ID>.T##` with a zero-padded 2-digit index, ordered in a sensible
  learning sequence. E.g. `BB.1A.T01`, `BB.1A.T02`.
- **Subtopic id** = `<TOPIC_ID>.S##`. E.g. `BB.1A.T01.S01`.
- Ids must be unique within your file. Never reuse an index.

## Naming

- `name` = a concise, canonical MCAT topic/subtopic title in Title Case, ≤ 60 characters.
- No trailing punctuation, no leading/trailing spaces, no `::` characters.

## Coverage bar (be COMPLETE)

- Enumerate **every** topic the AAMC lists under each of your categories, and the subtopics under each
  topic. Typical real depth: ~4–10 topics per category, each with ~2–6 subtopics.
- Prefer the outline's own groupings. Do not collapse distinct concepts; do not pad with fluff.

## Prerequisites (the load-bearing part)

- An edge `{src, dst}` means **"master `src` BEFORE `dst`"** — `src` is the prerequisite.
- Endpoints must be **topic or subtopic ids ONLY** — NEVER a bare category id (e.g. never `BB.1A`).
- The edge set you emit must be **acyclic**.
- Every edge carries a short `rationale` (≤ 100 chars) and `confidence` ∈ `high | medium | low`.
- Put **within-your-categories** edges under `prerequisites` (use exact ids).
- Put edges that cross INTO or OUT OF another Foundational Concept's categories under
  `cross_prerequisites`, referencing the far end by a **hint** string `"<CATEGORY_ID>: topic name"`
  (you don't know other agents' exact topic ids — the assembler resolves the hint). Give the end you
  DO own as an exact id.
- Favor true conceptual dependencies (e.g. thermodynamics → bioenergetics; amino acids → protein
  folding; action potentials → synaptic transmission). An independent verifier will re-check every
  edge, so be honest with `confidence`.

## `related` (optional, undirected)

- `{a, b, rationale}` for strong non-prerequisite associations within your categories.

## Output — write ONE file only

Write a single YAML file to the path you are told (e.g. `docs/data/topics/gen_FC1.yaml`). Do not edit
any other file. The file MUST parse as YAML and match this shape exactly:

```yaml
fc: "FC1"                 # your Foundational Concept id (or "CARS")
section: "B-B"            # C-P | B-B | P-S | CARS
categories:
  - id: "BB.1A"
    name: "Structure and function of proteins and their constituent amino acids"
    topics:
      - id: "BB.1A.T01"
        name: "Amino Acids"
        subtopics:
          - { id: "BB.1A.T01.S01", name: "Absolute Configuration at the Alpha Carbon" }
          - { id: "BB.1A.T01.S02", name: "Amino Acids as Dipolar Ions" }
      - id: "BB.1A.T02"
        name: "Protein Structure"
        subtopics:
          - { id: "BB.1A.T02.S01", name: "Primary Structure" }
          - { id: "BB.1A.T02.S02", name: "Secondary Structure" }
prerequisites:
  - { src: "BB.1A.T01", dst: "BB.1A.T02", rationale: "Amino acid chemistry underlies folding", confidence: "high" }
cross_prerequisites:
  - { src_hint: "CP.5E: Chemical Thermodynamics", dst: "BB.1A.T02", rationale: "Free energy governs folding", confidence: "medium" }
related:
  - { a: "BB.1A.T01", b: "BB.1A.T02", rationale: "Same molecular level of organization" }
```

## Hard rules

1. Write only your assigned file; make no other edits.
2. Valid YAML; ids unique in-file; the `prerequisites` set is acyclic.
3. Prereq endpoints are topic/subtopic ids only — never a category id.
4. Correctness over volume when they conflict — but still be complete.
5. After writing, reply with a 2-line summary: counts of topics / subtopics / prerequisites written.
