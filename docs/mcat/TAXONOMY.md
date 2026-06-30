# MCAT taxonomy — the frozen coverage spine (Decision 22)

**Source (verbatim):** AAMC, _What's on the MCAT® Exam?_ (© 2020 Association of American Medical Colleges) —
<https://students-residents.aamc.org/prepare-mcat-exam/whats-mcat-exam-pdf-outline>. charged_up is **not**
affiliated with or endorsed by the AAMC and ingests **no** real AAMC exam items; only the public content-outline
_structure_ (section / Foundational-Concept / content-category titles) is used.

The machine-readable source of truth is [`../data/mcat_taxonomy.yaml`](../data/mcat_taxonomy.yaml); the 3D
knowledge-graph VIEW and the §7c coverage gate both build **from that file**. This page is the human reference.

## Coverage denominators (Decision 22)

- **Readiness GATE** divides by the **31 AAMC content categories** (`is_content_category: true`).
- **Displayed coverage MAP** divides by all **34 leaves** = 31 content categories **+ 3 CARS reasoning skills**.
- FC10 has exactly **one** content category (10A) — not truncated.
- The 31-id set is frozen and CI-asserted by `pylib/tests/test_mcat_taxonomy.py` (set equality, not a count).

## Sections (4) and Foundational Concepts (10)

| Section                                                       | Abbrev | Foundational Concepts                           |
| ------------------------------------------------------------- | ------ | ----------------------------------------------- |
| Chemical and Physical Foundations of Biological Systems       | C-P    | FC4, FC5                                        |
| Critical Analysis and Reasoning Skills                        | CARS   | (reasoning skills only — no content categories) |
| Biological and Biochemical Foundations of Living Systems      | B-B    | FC1, FC2, FC3                                   |
| Psychological, Social, and Biological Foundations of Behavior | P-S    | FC6, FC7, FC8, FC9, FC10                        |

## The 31 content categories (verbatim AAMC titles) + 3 CARS skills

| AAMC id | Verbatim title                                                                                                        | FC   | Section |
| ------- | --------------------------------------------------------------------------------------------------------------------- | ---- | ------- |
| 1A      | Structure and function of proteins and their constituent amino acids                                                  | FC1  | B-B     |
| 1B      | Transmission of genetic information from the gene to the protein                                                      | FC1  | B-B     |
| 1C      | Transmission of heritable information from generation to generation and the processes that increase genetic diversity | FC1  | B-B     |
| 1D      | Principles of bioenergetics and fuel molecule metabolism                                                              | FC1  | B-B     |
| 2A      | Assemblies of molecules, cells, and groups of cells within single cellular and multicellular organisms                | FC2  | B-B     |
| 2B      | The structure, growth, physiology, and genetics of prokaryotes and viruses                                            | FC2  | B-B     |
| 2C      | Processes of cell division, differentiation, and specialization                                                       | FC2  | B-B     |
| 3A      | Structure and functions of the nervous and endocrine systems and ways these systems coordinate the organ systems      | FC3  | B-B     |
| 3B      | Structure and integrative functions of the main organ systems                                                         | FC3  | B-B     |
| 4A      | Translational motion, forces, work, energy, and equilibrium in living systems                                         | FC4  | C-P     |
| 4B      | Importance of fluids for the circulation of blood, gas movement, and gas exchange                                     | FC4  | C-P     |
| 4C      | Electrochemistry and electrical circuits and their elements                                                           | FC4  | C-P     |
| 4D      | How light and sound interact with matter                                                                              | FC4  | C-P     |
| 4E      | Atoms, nuclear decay, electronic structure, and atomic chemical behavior                                              | FC4  | C-P     |
| 5A      | Unique nature of water and its solutions                                                                              | FC5  | C-P     |
| 5B      | Nature of molecules and intermolecular interactions                                                                   | FC5  | C-P     |
| 5C      | Separation and purification methods                                                                                   | FC5  | C-P     |
| 5D      | Structure, function, and reactivity of biologically relevant molecules                                                | FC5  | C-P     |
| 5E      | Principles of chemical thermodynamics and kinetics                                                                    | FC5  | C-P     |
| 6A      | Sensing the environment                                                                                               | FC6  | P-S     |
| 6B      | Making sense of the environment                                                                                       | FC6  | P-S     |
| 6C      | Responding to the world                                                                                               | FC6  | P-S     |
| 7A      | Individual influences on behavior                                                                                     | FC7  | P-S     |
| 7B      | Social processes that influence human behavior                                                                        | FC7  | P-S     |
| 7C      | Attitude and behavior change                                                                                          | FC7  | P-S     |
| 8A      | Self-identity                                                                                                         | FC8  | P-S     |
| 8B      | Social thinking                                                                                                       | FC8  | P-S     |
| 8C      | Social interactions                                                                                                   | FC8  | P-S     |
| 9A      | Understanding social structure                                                                                        | FC9  | P-S     |
| 9B      | Demographic characteristics and processes                                                                             | FC9  | P-S     |
| 10A     | Social inequality                                                                                                     | FC10 | P-S     |
| —       | Foundations of Comprehension (CARS)                                                                                   | —    | CARS    |
| —       | Reasoning Within the Text (CARS)                                                                                      | —    | CARS    |
| —       | Reasoning Beyond the Text (CARS)                                                                                      | —    | CARS    |

**Count: 31 content categories + 3 CARS = 34 leaves.** Exam blueprint weights (for study allocation):
C-P ≈ FC4 40% / FC5 60%; P-S ≈ FC6 25% / FC7 35% / FC8 20% / FC9 15% / FC10 5%.
