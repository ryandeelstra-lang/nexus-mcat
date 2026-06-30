# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

"""AI provenance store + the C2 reject-unsourced gate.

Hard limit (rubric §A): every AI output must trace back to a named source, or the AI section scores 0.
So every generated card carries a `source_id` that MUST resolve to a known source in the store; cards
without a resolvable source are BLOCKED before any student sees them (`assert_sourced` / `filter_sourced`)."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


@dataclass(frozen=True)
class Source:
    source_id: str
    title: str
    url: str = ""
    license: str = ""


class ProvenanceError(Exception):
    """Raised when an AI card is unsourced or cites an unresolvable source (C2 violation)."""


class ProvenanceStore:
    def __init__(self, sources: Iterable[Source] = ()):
        self._by_id: dict[str, Source] = {}
        for s in sources:
            self.add(s)

    def add(self, source: Source) -> None:
        if not source.source_id.strip():
            raise ProvenanceError("source_id must be non-empty")
        self._by_id[source.source_id] = source

    @classmethod
    def from_jsonl(cls, path) -> "ProvenanceStore":
        store = cls()
        for line in Path(path).read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line:
                continue
            d = json.loads(line)
            store.add(Source(d["source_id"], d.get("title", ""), d.get("url", ""), d.get("license", "")))
        return store

    def resolve(self, source_id: str) -> Source | None:
        return self._by_id.get((source_id or "").strip())

    def is_sourced(self, card: dict) -> bool:
        return self.resolve(card.get("source_id", "")) is not None

    def assert_sourced(self, card: dict) -> None:
        sid = (card.get("source_id") or "").strip()
        if not sid:
            raise ProvenanceError(
                "AI card has no source_id (C2: every AI output must trace to a named source)"
            )
        if sid not in self._by_id:
            raise ProvenanceError(
                f"AI card source_id {sid!r} does not resolve to a known source (C2)"
            )

    def filter_sourced(self, cards: Iterable[dict]) -> tuple[list[dict], list[dict]]:
        """The C2 gate: split cards into (accepted, rejected). Rejected = unsourced/unresolvable — blocked."""
        accepted: list[dict] = []
        rejected: list[dict] = []
        for c in cards:
            (accepted if self.is_sourced(c) else rejected).append(c)
        return accepted, rejected

    def __len__(self) -> int:
        return len(self._by_id)
