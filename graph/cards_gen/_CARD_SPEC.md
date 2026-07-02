# Card-node generation spec (Nexus comprehensive graph — deepest tier)

You add the DEEPEST layer of the MCAT knowledge graph: one or more **exam-style question cards** per
concept. These become the outermost leaf nodes (the "10K+ from every question" layer) — what lights up as
a student masters individual items, so weak spots are visible at the finest grain.

## Inputs (read these)

For each content-category leaf assigned to you, read `graph/concepts/<LEAF>.json`. It contains:

- `nodes`: a list of `{id, label, kind: topic|subtopic|concept, parent, summary, yield}`.
  You generate cards ONLY for nodes with `kind == "concept"` (ignore topic/subtopic).

## What to produce — per concept

For each concept node, emit exam-style question cards, weighted by the concept's `yield`:

- `yield: "high"` → **2** cards
- `yield: "medium"` → **1** card
- `yield: "low"` (or missing) → **1** card

Each card:

- `id` = `<concept_id>.c<N>` (N = 1,2). Must be globally unique.
- `parent` = the concept id (the card hangs off its concept).
- `leaf` = the category leaf id (e.g. `BB.1A`).
- `label` = a concise MCAT-style question testing that concept, **≤ 90 characters**, Title/sentence case,
  no surrounding quotes, no newlines. Make each card distinct (test a different angle of the concept).

Write real, on-topic questions grounded in the concept's `label` + `summary` — this is a premium product.
Terse is fine (it's a question stub, not a full card): e.g. "Which amino acid property determines its pKa?"

## Output — ONE file only

Write a single JSON file to the path you are told, e.g. `graph/cards_gen/cards_FC1.json`, shaped EXACTLY:

```json
{
    "fc": "FC1",
    "cards": [
        {
            "id": "BB.1A.amino-acids.general-structure.alpha-carbon.c1",
            "parent": "BB.1A.amino-acids.general-structure.alpha-carbon",
            "leaf": "BB.1A",
            "label": "What four groups bond to an amino acid's alpha-carbon?"
        },
        {
            "id": "BB.1A.amino-acids.general-structure.alpha-carbon.c2",
            "parent": "BB.1A.amino-acids.general-structure.alpha-carbon",
            "leaf": "BB.1A",
            "label": "Why is glycine's alpha-carbon not a stereocenter?"
        }
    ]
}
```

## Hard rules

1. Write ONLY your assigned file; edit nothing else.
2. Valid JSON; every `parent` is an existing concept id from your leaf files; ids globally unique.
3. Cover EVERY concept in your leaves (this is what makes the graph comprehensive).
4. After writing, reply with a 2-line summary: concepts covered / cards written.
