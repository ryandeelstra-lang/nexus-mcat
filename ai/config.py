# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

"""AI on/off gating. SAFE DEFAULT: OFF unless a key is present AND not force-disabled."""

from __future__ import annotations

import os


def has_api_key() -> bool:
    return bool(os.environ.get("OPENAI_API_KEY", "").strip())


def ai_enabled() -> bool:
    """AI is enabled ONLY when a key is present and AI_DISABLED is not set.

    - AI_DISABLED=1            -> always OFF (the master kill switch; C5/D8 + crash/offline 7g).
    - no OPENAI_API_KEY        -> OFF (cannot generate without the model; never fabricate).
    - key present, not disabled -> ON.
    """
    if os.environ.get("AI_DISABLED", "0") == "1":
        return False
    return has_api_key()
