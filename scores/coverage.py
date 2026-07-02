# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

"""Coverage map (challenge 7c). GATE denominator = 31 content categories; DISPLAY = 34 leaves
(Decision 22). A content category is 'covered' when its subdeck holds at least one card."""

from __future__ import annotations

from pathlib import Path

import yaml  # type: ignore[import-untyped]

TAXONOMY = Path(__file__).resolve().parents[1] / "docs" / "data" / "mcat_taxonomy.yaml"


def load_taxonomy(path=TAXONOMY) -> dict:
    return yaml.safe_load(Path(path).read_text(encoding="utf-8"))


def content_category_paths(tax: dict) -> set[str]:
    return {leaf["path"] for leaf in tax["leaves"] if leaf["is_content_category"]}


def all_leaf_paths(tax: dict) -> set[str]:
    return {leaf["path"] for leaf in tax["leaves"]}


def covered_paths(topics) -> set[str]:
    """Subdecks (by human deck name == taxonomy path) that hold >= 1 card."""
    return {t.deck_name for t in topics if t.total_cards > 0}


def coverage(topics, tax: dict) -> dict:
    cc = content_category_paths(tax)
    allp = all_leaf_paths(tax)
    covered = covered_paths(topics)
    gate_covered = cc & covered
    display_covered = allp & covered
    return {
        "gate_covered": len(gate_covered),
        "gate_total": len(cc),  # 31
        "gate_fraction": len(gate_covered) / len(cc) if cc else 0.0,
        "display_covered": len(display_covered),
        "display_total": len(allp),  # 34
        "display_fraction": len(display_covered) / len(allp) if allp else 0.0,
        "uncovered_content_categories": sorted(cc - covered),
    }
