#!/usr/bin/env python3
# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html
"""Friday AI preflight: the FIRST AI task. Fails LOUDLY (non-zero + copy-paste fix) if the human
dependency (a model API key) or the AI deps are missing. Every LIVE evidence run in W2a gates on this.

Provider-neutral: the charged_up Friday build ships against OpenAI (`gpt-4o`) because that is the key
configured in this environment; the brief does not mandate a vendor. The record/replay client keeps the
same interface for either provider, so swapping is a localized change."""
from __future__ import annotations
import json, os, sys
from pathlib import Path

WORKTREE = Path(__file__).resolve().parents[1]
PROOF = WORKTREE / "ai" / "proof" / "friday"
MODEL = "gpt-4o"

INSTRUCTIONS = f"""
[ai_preflight] A model API key (OPENAI_API_KEY) and/or AI deps are missing. The Friday AI work
(generation, checker, eval, baseline) cannot run its LIVE arms without them. To proceed:

  export OPENAI_API_KEY=sk-...               # your OpenAI key (or ANTHROPIC_API_KEY for the Anthropic path)
  {WORKTREE}/.venv-ai/bin/pip install "openai>=1.40" rank_bm25

Then re-run:  {WORKTREE}/.venv-ai/bin/python scripts/ai_preflight.py

Until then the app stays AI-OFF (AI_DISABLED=1) and STILL SCORES (verified by W2a.2).
"""


def check() -> dict:
    report = {
        "model": MODEL, "has_key": bool(os.environ.get("OPENAI_API_KEY", "").strip()),
        "openai_installed": False, "rank_bm25_installed": False,
        "live_smoke_ok": False, "smoke_model_echo": None,
    }
    try:
        import openai  # noqa: F401
        report["openai_installed"] = True
    except ImportError:
        pass
    try:
        import rank_bm25  # noqa: F401
        report["rank_bm25_installed"] = True
    except ImportError:
        pass
    if report["has_key"] and report["openai_installed"]:
        from openai import OpenAI
        resp = OpenAI().chat.completions.create(
            model=MODEL, max_tokens=16,
            messages=[{"role": "user", "content": "Reply with the single word OK."}],
        )
        echo = (resp.choices[0].message.content or "").strip()
        report["smoke_model_echo"] = echo
        report["model_resolved"] = resp.model
        report["live_smoke_ok"] = echo.upper().startswith("OK")
    return report


def main() -> int:
    report = check()
    PROOF.mkdir(parents=True, exist_ok=True)
    (PROOF / "00-preflight.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    if not (report["has_key"] and report["openai_installed"] and report["rank_bm25_installed"]):
        sys.stderr.write(INSTRUCTIONS)
        return 2
    if not report["live_smoke_ok"]:
        sys.stderr.write(f"\n[ai_preflight] live smoke failed: {MODEL} did not echo OK "
                         f"(got {report['smoke_model_echo']!r}).\n")
        return 3
    print(f"[ai_preflight] OK: key present, deps installed, {MODEL} smoke passed -> {PROOF / '00-preflight.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
