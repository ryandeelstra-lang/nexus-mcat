# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html
#   PYTHONPATH=. out/pyenv/bin/python -m pytest ai/tests/test_corpus_text.py
import pytest
from ai import corpus_text

SID = "openstax-biology-2e.ch03"


def test_loads_real_source_and_hashes():
    text = corpus_text.load_source_text(SID)
    assert len(text) > 500  # a real chapter, not a stub
    assert len(corpus_text.source_sha256(SID)) == 64


def test_quote_resolution_is_the_anti_hallucination_gate():
    text = corpus_text.load_source_text(SID)
    real = text[400:480]
    assert corpus_text.quote_in_source(text, real) is True          # verbatim span resolves
    assert corpus_text.quote_in_source(text, "  " + real.lower() + " ") is True  # whitespace/case tolerant
    assert corpus_text.quote_in_source(text, "the mitochondrion synthesizes 999 ATP per turn") is False  # fabricated
    assert corpus_text.quote_in_source(text, "") is False


def test_missing_source_raises():
    with pytest.raises(FileNotFoundError):
        corpus_text.load_source_text("no-such-source@v0")
