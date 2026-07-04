# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html
"""Deterministic char-offset chunker: stable ids + exact spans so every generated card cites the
chunk it came from (span provenance)."""
from __future__ import annotations
from dataclasses import dataclass


@dataclass(frozen=True)
class Chunk:
    chunk_id: str
    source_id: str
    start: int
    end: int
    text: str


def chunk_source(source_id: str, text: str, size: int = 1200, overlap: int = 100) -> list:
    chunks: list = []
    i, n = 0, 0
    while i < len(text):
        end = min(len(text), i + size)
        chunks.append(Chunk(f"{source_id}#c{n:04d}", source_id, i, end, text[i:end]))
        if end == len(text):
            break
        i = end - overlap
        n += 1
    return chunks
