# NOTICE — charged_up is a fork of Anki

**charged_up** is a fork of **Anki** (the desktop spaced-repetition program),
re-targeted as an MCAT study application for desktop + iOS that share one Rust engine.

## Upstream attribution

- **Original work:** Anki — https://github.com/ankitects/anki
- **Copyright:** © Ankitects Pty Ltd and the Anki contributors (see [CONTRIBUTORS](./CONTRIBUTORS)).
- **License:** GNU Affero General Public License, version 3 or later (**AGPL-3.0-or-later**),
  with portions contributed by Anki users under the **BSD-3-Clause** license, and the additional
  third-party components enumerated verbatim in [LICENSE](./LICENSE) (e.g. statsbg.py CC BY 4.0;
  mpv.py / winpaths.py / jQuery / plot.js MIT; MathJax Apache-2.0; protobuf.js BSD-3-Clause).
- Forked from upstream commit `b00308e` (Anki `.version` 26.05).

## charged_up modifications

- **Copyright:** © 2026 the charged_up authors.
- **License:** **AGPL-3.0-or-later** — the same license as the upstream work. The complete,
  corresponding source for our modifications is published with this repository.
- The upstream [LICENSE](./LICENSE) and [CONTRIBUTORS](./CONTRIBUTORS) files are retained **verbatim**.

## MCAT content provenance

- The MCAT **taxonomy** ([docs/data/mcat_taxonomy.yaml](./docs/data/mcat_taxonomy.yaml)) uses only the AAMC
  content-outline _structure_ (section / Foundational-Concept / content-category titles) — public facts, no
  exam items. See [docs/mcat/TAXONOMY.md](./docs/mcat/TAXONOMY.md).
- The seed **deck content** ([deck_content/cards.jsonl](./deck_content/cards.jsonl)) is **self-authored,
  original** material (© 2026 the charged_up authors, AGPL-3.0-or-later) written from general public scientific
  knowledge — **no** real AAMC items, **no** scraped/copyrighted third-party question text. Provenance and the
  held-out leakage wall are documented in [deck_content/DECK-PROVENANCE.md](./deck_content/DECK-PROVENANCE.md)
  and [eval_gold/README.md](./eval_gold/README.md).

## Trademarks / logo

The **Anki logo** is copyright Alex Fraser and is **not** relabeled, modified, or used to brand
charged_up; per [LICENSE](./LICENSE) it may only be used to refer to Anki/AnkiWeb/AnkiMobile/AnkiDroid.
"MCAT" is a program of the Association of American Medical Colleges (AAMC); charged_up is **not**
affiliated with, endorsed by, or sponsored by the AAMC, and ingests **no** real AAMC exam items.

_This NOTICE is documentation only; the binding license terms are in [LICENSE](./LICENSE)._
