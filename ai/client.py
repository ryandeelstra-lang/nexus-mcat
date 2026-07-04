# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html
"""The ONLY module that imports the model SDK. Reproducibility = record/replay (prompt caching is NOT
determinism). REPLAY answers from a committed cassette keyed by a stable request hash and NEVER opens a
socket; RECORD makes one real chat.completions call and appends it.

Provider-neutral interface: callers build Anthropic-shaped tool dicts (`{name, description,
input_schema}`) and receive `{stop_reason, text, tool_use:{name,input}}`. The Friday build talks to
OpenAI (`gpt-4o`); this module translates the Anthropic-shaped request to OpenAI function-calling and
normalizes the response back, so generate/checker/eval/baseline are provider-agnostic. The request hash
is computed over the *un-translated* payload, so the cassette key is identical whatever the backend."""
from __future__ import annotations
import hashlib, json
from pathlib import Path

from . import config

MODEL = "gpt-4o"


class AIDisabledError(RuntimeError):
    """Raised if a live/record call is attempted while AI is disabled."""


class CassetteMiss(KeyError):
    """Raised in replay mode when no recorded response matches the request."""


def _canonical(payload: dict) -> str:
    return json.dumps(payload, sort_keys=True, ensure_ascii=False, separators=(",", ":"))


def request_hash(payload: dict) -> str:
    return hashlib.sha256(_canonical(payload).encode("utf-8")).hexdigest()


def _to_openai_tools(tools):
    """Anthropic-shaped [{name,description,input_schema}] -> OpenAI [{type:function,function:{...}}]."""
    out = []
    for t in tools or []:
        out.append({"type": "function", "function": {
            "name": t["name"], "description": t.get("description", ""),
            "parameters": t.get("input_schema", {"type": "object", "properties": {}}),
        }})
    return out


def _to_openai_tool_choice(tool_choice):
    if not tool_choice:
        return None
    if tool_choice.get("type") == "tool":
        return {"type": "function", "function": {"name": tool_choice["name"]}}
    return tool_choice


def _serialize(resp) -> dict:
    """OpenAI ChatCompletion -> normalized {stop_reason, text, tool_use}."""
    choice = resp.choices[0]
    msg = choice.message
    out = {"stop_reason": None, "text": msg.content or "", "tool_use": None}
    tool_calls = getattr(msg, "tool_calls", None)
    if tool_calls:
        tc = tool_calls[0]
        try:
            args = json.loads(tc.function.arguments)
        except (json.JSONDecodeError, TypeError):
            args = {}
        out["tool_use"] = {"name": tc.function.name, "input": args}
        out["stop_reason"] = "tool_use"
    else:
        out["stop_reason"] = "end_turn" if choice.finish_reason == "stop" else choice.finish_reason
    return out


class AIClient:
    def __init__(self, mode: str = "replay", cassette=None, model: str = MODEL):
        assert mode in ("replay", "record")
        self.mode = mode
        self.model = model
        self.cassette = Path(cassette) if cassette else None
        self._recorded: dict = {}
        if self.cassette and self.cassette.exists():
            for line in self.cassette.read_text(encoding="utf-8").splitlines():
                if line.strip():
                    rec = json.loads(line)
                    self._recorded[rec["request_hash"]] = rec["response"]

    def message(self, *, system: str, user: str, tools=None, tool_choice=None, max_tokens: int = 2048) -> dict:
        payload = {"model": self.model, "system": system, "user": user,
                   "tools": tools or [], "tool_choice": tool_choice}
        h = request_hash(payload)
        if self.mode == "replay":
            if h not in self._recorded:
                raise CassetteMiss(f"no recorded response for request {h[:12]} in {self.cassette}")
            return self._recorded[h]
        if not config.ai_enabled():
            raise AIDisabledError("record mode requires a model API key and AI enabled (see W2a.1)")
        from openai import OpenAI
        messages = [{"role": "system", "content": system}, {"role": "user", "content": user}]
        kwargs = dict(model=self.model, max_tokens=max_tokens, messages=messages)
        if tools:
            kwargs["tools"] = _to_openai_tools(tools)
            tc = _to_openai_tool_choice(tool_choice)
            if tc:
                kwargs["tool_choice"] = tc
        response = _serialize(OpenAI().chat.completions.create(**kwargs))
        if self.cassette:
            self.cassette.parent.mkdir(parents=True, exist_ok=True)
            with self.cassette.open("a", encoding="utf-8") as fh:
                fh.write(json.dumps({"request_hash": h, "response": response}) + "\n")
        self._recorded[h] = response
        return response
