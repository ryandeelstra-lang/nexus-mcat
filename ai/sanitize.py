# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html
"""Strip/flag hidden-text injection vectors before source text reaches the model. The primary defense
is DATA-not-instructions isolation (delimited source + a system clause that forbids in-text directives,
see prompts/generate_system.txt); this is the belt-and-suspenders scrubber for hidden payloads."""
from __future__ import annotations
import re

_ZERO_WIDTH = ("​", "‌", "‍", "﻿")
_HTML_COMMENT = re.compile(r"<!--.*?-->", re.DOTALL)
_HIDDEN_EL = re.compile(
    r"<(\w+)[^>]*(?:display\s*:\s*none|visibility\s*:\s*hidden|font-size\s*:\s*0)[^>]*>.*?</\1>",
    re.DOTALL | re.IGNORECASE,
)
_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")


def strip_hidden_text(text: str) -> tuple:
    flags: dict = {}
    cleaned = text or ""

    zw = sum(cleaned.count(z) for z in _ZERO_WIDTH)
    if zw:
        flags["zero_width"] = zw
    for z in _ZERO_WIDTH:
        cleaned = cleaned.replace(z, "")

    n_hidden = len(_HIDDEN_EL.findall(cleaned))
    if n_hidden:
        flags["hidden_spans"] = n_hidden
    cleaned = _HIDDEN_EL.sub(" ", cleaned)

    n_comments = len(_HTML_COMMENT.findall(cleaned))
    if n_comments:
        flags["html_comments"] = n_comments
    cleaned = _HTML_COMMENT.sub(" ", cleaned)

    n_ctrl = len(_CONTROL.findall(cleaned))
    if n_ctrl:
        flags["control_chars"] = n_ctrl
    cleaned = _CONTROL.sub("", cleaned)

    return cleaned, flags
