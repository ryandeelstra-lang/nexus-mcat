# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html
"""Real-source text + the span/quote provenance check. A generated card cites a `quote`; the quote
MUST be a verbatim (normalized) substring of the source text, or the card is unsourced and blocked.
This is the anti-hallucination layer ON TOP of the source-id C2 gate in provenance.py."""
from __future__ import annotations
import hashlib
from pathlib import Path

from .leakage import normalize

_SOURCES_DIR = Path(__file__).resolve().parent / "corpus" / "sources"


def load_source_text(source_id: str, root: Path | None = None) -> str:
    root = Path(root) if root else _SOURCES_DIR
    path = root / f"{source_id}.txt"
    if not path.exists():
        raise FileNotFoundError(f"no source text for {source_id!r} at {path}")
    return path.read_text(encoding="utf-8")


def source_sha256(source_id: str, root: Path | None = None) -> str:
    return hashlib.sha256(load_source_text(source_id, root).encode("utf-8")).hexdigest()


def quote_in_source(source_text: str, quote: str) -> bool:
    """True iff the (normalized) quote is a non-empty substring of the (normalized) source."""
    nq = normalize(quote)
    if not nq:
        return False
    return nq in normalize(source_text)
