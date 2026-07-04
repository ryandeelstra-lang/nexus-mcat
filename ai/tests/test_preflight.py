# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html
#   PYTHONPATH=. out/pyenv/bin/python -m pytest ai/tests/test_preflight.py
import importlib, sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "scripts"))
import ai_preflight  # noqa: E402


def test_check_reports_no_key(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    report = ai_preflight.check()
    for k in ("model", "has_key", "openai_installed", "rank_bm25_installed", "live_smoke_ok"):
        assert k in report
    assert report["model"] == "gpt-4o"
    assert report["has_key"] is False


def test_main_fails_loudly_without_key(monkeypatch, tmp_path, capsys):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.setattr(ai_preflight, "PROOF", tmp_path)
    rc = ai_preflight.main()
    assert rc == 2  # missing key/deps -> non-zero, loud
    err = capsys.readouterr().err
    assert "OPENAI_API_KEY" in err and "export" in err
    assert (tmp_path / "00-preflight.json").exists()
