# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

# charged_up: pins the MCAT taxonomy (Decision 22) — the frozen coverage spine.
# The readiness GATE divides by the 31 AAMC content categories; the display map by 34 leaves.

import re
from pathlib import Path

import yaml  # type: ignore[import-untyped]

TAXONOMY = Path(__file__).resolve().parents[2] / "docs" / "data" / "mcat_taxonomy.yaml"

# Decision 22: the FROZEN set of 31 AAMC content-category ids. Asserted with `==` (not len()),
# so a dropped / added / mis-lettered category fails CI. FC10 has exactly one category (10A).
FROZEN_CONTENT_CATEGORIES = {
    "1A",
    "1B",
    "1C",
    "1D",
    "2A",
    "2B",
    "2C",
    "3A",
    "3B",
    "4A",
    "4B",
    "4C",
    "4D",
    "4E",
    "5A",
    "5B",
    "5C",
    "5D",
    "5E",
    "6A",
    "6B",
    "6C",
    "7A",
    "7B",
    "7C",
    "8A",
    "8B",
    "8C",
    "9A",
    "9B",
    "10A",
}


def _load():
    with open(TAXONOMY, encoding="utf-8") as f:
        return yaml.safe_load(f)


def test_four_sections():
    data = _load()
    assert [s["abbrev"] for s in data["sections"]] == ["C-P", "CARS", "B-B", "P-S"]
    assert all(s["name"].strip() for s in data["sections"])


def test_ten_foundational_concepts():
    data = _load()
    assert [fc["id"] for fc in data["foundational_concepts"]] == [
        f"FC{i}" for i in range(1, 11)
    ]
    assert all(fc["statement"].strip() for fc in data["foundational_concepts"])


def test_content_category_golden_set():
    data = _load()
    cc = {leaf["id"] for leaf in data["leaves"] if leaf["is_content_category"]}
    assert cc == FROZEN_CONTENT_CATEGORIES  # SET equality, not just a count
    assert len(cc) == 31


def test_total_leaves_is_34():
    data = _load()
    assert len(data["leaves"]) == 34


def test_cars_leaves_are_three_and_non_content():
    data = _load()
    cars = [leaf for leaf in data["leaves"] if leaf["section"] == "CARS"]
    assert len(cars) == 3
    assert all(leaf["is_content_category"] is False for leaf in cars)
    assert all(leaf["fc"] is None for leaf in cars)


def test_paths_are_anki_normalized_and_unique():
    data = _load()
    paths = [leaf["path"] for leaf in data["leaves"]]
    assert len(paths) == len(set(paths))  # unique full-names
    for leaf in data["leaves"]:
        parts = leaf["path"].split("::")
        assert parts[0] == "MCAT"
        # No leading/trailing spaces, no empty component (would break Anki deck normalization).
        assert all(part == part.strip() and part for part in parts)
        assert leaf["name"] == leaf["name"].strip() and leaf["name"]


def test_content_category_id_and_mapping():
    data = _load()
    for leaf in data["leaves"]:
        if leaf["is_content_category"]:
            assert re.fullmatch(r"\d+[A-E]", leaf["id"]), leaf["id"]
            assert leaf["fc"] and leaf["section"] in ("C-P", "B-B", "P-S")
            assert leaf["leaf_id"].endswith(leaf["id"])
