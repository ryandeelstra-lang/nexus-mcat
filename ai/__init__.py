# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

"""charged_up AI — sourced, evaluated MCAT card generation (the canonical home; NOT scripts/ or eval/).

Out-of-process (not part of `just check`). Decoupled from the Anki engine: importing `ai` must NOT
import the engine. Default-OFF: with no ANTHROPIC_API_KEY (or AI_DISABLED=1) the app generates nothing,
makes no network call, and the three scores still render (C5/D8). Every live-AI output must be sourced
(C2) and pass the held-out checker before students see it; the live arms are built against recorded
responses for reproducibility.
"""
