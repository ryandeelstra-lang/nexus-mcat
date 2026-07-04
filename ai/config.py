# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

"""AI on/off gating. SAFE DEFAULT: OFF unless a key is present AND not force-disabled.

Provider-neutral: the brief mandates a *sourced, checked, beats-a-baseline* AI, not a specific
vendor. A key from EITHER supported provider (Anthropic or OpenAI) enables the live path; the
charged_up Friday build ships against whichever key is configured (OpenAI, `gpt-4o`, as of
2026-07-03). The AI-off contract is unchanged: default OFF, `AI_DISABLED=1` is the master kill
switch, and no key means OFF (never fabricate)."""

from __future__ import annotations

import os

# The env vars that carry a usable model key, in preference order.
_KEY_ENV_VARS = ("ANTHROPIC_API_KEY", "OPENAI_API_KEY")


def has_api_key() -> bool:
    return any(os.environ.get(name, "").strip() for name in _KEY_ENV_VARS)


def ai_enabled() -> bool:
    """AI is enabled ONLY when a key is present and AI_DISABLED is not set.

    - AI_DISABLED=1                    -> always OFF (the master kill switch; C5/D8 + crash/offline 7g).
    - no ANTHROPIC_API_KEY/OPENAI_API_KEY -> OFF (cannot generate without the model; never fabricate).
    - key present, not disabled        -> ON.
    """
    if os.environ.get("AI_DISABLED", "0") == "1":
        return False
    return has_api_key()
