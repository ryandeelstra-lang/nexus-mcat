# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html
#   PYTHONPATH=. AI_DISABLED=1 out/pyenv/bin/python -m pytest ai/tests/test_ai_off_scores.py
import ast
from pathlib import Path

from ai import config

SCORES = Path(__file__).resolve().parents[2] / "scores"


def _imported_modules(pyfile: Path):
    tree = ast.parse(pyfile.read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for n in node.names:
                yield n.name
        elif isinstance(node, ast.ImportFrom):
            yield node.module or ""


def test_scores_never_imports_ai():
    offenders = []
    for f in SCORES.rglob("*.py"):
        for mod in _imported_modules(f):
            if mod == "ai" or mod.startswith("ai."):
                offenders.append((f.name, mod))
    assert not offenders, f"scores/ must stay AI-independent (C5/D8), but imports ai/: {offenders}"


def test_ai_off_even_with_key(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-fake")
    monkeypatch.setenv("AI_DISABLED", "1")
    assert config.ai_enabled() is False  # kill switch wins even with a key present
