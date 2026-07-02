# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

# charged_up F-AI.2: the C2 reject-unsourced gate — every AI card must trace to a named source.
#   PYTHONPATH=. out/pyenv/bin/python -m pytest ai/tests/test_provenance.py

import json
from pathlib import Path

import pytest

from ai.provenance import ProvenanceError, ProvenanceStore, Source

SOURCES = Path(__file__).resolve().parents[1] / "corpus" / "sources.jsonl"


def _store():
    return ProvenanceStore([Source("openstax-biology-2e", "OpenStax Biology 2e")])


def test_sourced_card_resolves():
    store = _store()
    card = {"front": "q", "back": "a", "source_id": "openstax-biology-2e"}
    assert store.is_sourced(card)
    store.assert_sourced(card)  # does not raise


def test_missing_source_id_is_rejected():
    store = _store()
    with pytest.raises(ProvenanceError):
        store.assert_sourced({"front": "q", "back": "a"})
    with pytest.raises(ProvenanceError):
        store.assert_sourced({"front": "q", "back": "a", "source_id": "   "})


def test_unresolvable_source_id_is_rejected():
    store = _store()
    with pytest.raises(ProvenanceError):
        store.assert_sourced({"front": "q", "source_id": "a-source-that-does-not-exist"})


def test_filter_sourced_is_the_c2_gate():
    store = _store()
    cards = [
        {"front": "a", "source_id": "openstax-biology-2e"},  # resolvable -> accepted
        {"front": "b"},  # no source -> blocked
        {"front": "c", "source_id": "unknown"},  # unresolvable -> blocked
    ]
    accepted, rejected = store.filter_sourced(cards)
    assert [c["front"] for c in accepted] == ["a"]
    assert [c["front"] for c in rejected] == ["b", "c"]


def test_corpus_registry_loads_and_is_free_public_non_aamc():
    store = ProvenanceStore.from_jsonl(SOURCES)
    assert len(store) >= 1
    for line in SOURCES.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        d = json.loads(line)
        assert d["source_id"] and d["title"] and d.get("license")  # every source named + licensed
        assert "aamc" not in d["source_id"].lower()  # no AAMC items in the generation corpus
