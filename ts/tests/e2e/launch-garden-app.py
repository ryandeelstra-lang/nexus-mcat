#!/usr/bin/env python
# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

"""
charged_up W1a: launcher for the garden e2e suite (CDP-attach flavour).

Unlike qt/tests/launch_anki_for_e2e.py (throwaway base, CDP explicitly stripped),
this launcher runs an ISOLATED but PERSISTENT profile with QtWebEngine remote
debugging enabled, so Playwright drives the real Qt webview via
chromium.connectOverCDP — no Playwright browser download needed.

- ANKI_BASE defaults to /tmp/e2e-w1a-profile (persistent: the 4,395-card starter
  deck imports once on first run via aqt's _maybe_import_starter_deck).
- CDP on GARDEN_CDP_PORT (default 9333); mediasrv pinned to GARDEN_API_PORT
  (default 40001) so it never collides with a dev instance on 40000.
- ANKI_SINGLE_INSTANCE_KEY=e2e-w1a keeps it separate from any other running Anki.
- Does NOT build: runs tools/run.py against the existing out/ artifacts.

Duplicates _seed_prefs from qt/tests/launch_anki_for_e2e.py on purpose so the
harnesses stay independent; keep in sync if the seed schema changes.
"""

from __future__ import annotations

import os
import pickle
import random
import signal
import sqlite3
import subprocess
import sys
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent
BASE = Path(os.environ.get("GARDEN_E2E_BASE", "/tmp/e2e-w1a-profile"))
CDP_PORT = int(os.environ.get("GARDEN_CDP_PORT", "9333"))
MEDIASRV_PORT = int(os.environ.get("GARDEN_API_PORT", "40001"))
TEST_PROFILE = "test"


def _seed_prefs(base: Path) -> None:
    meta = {
        "ver": 0,
        "updates": False,
        "created": int(time.time()),
        "id": random.randrange(0, 2**63),
        "lastMsg": 0,
        "suppressUpdate": True,
        "firstRun": False,
        "defaultLang": "en_US",
        "check_for_updates": False,
    }
    profile = {
        "mainWindowGeom": None,
        "mainWindowState": None,
        "numBackups": 50,
        "lastOptimize": int(time.time()),
        "searchHistory": [],
        "syncKey": None,
        "syncMedia": True,
        "autoSync": False,
        "allowHTML": False,
        "importMode": 1,
        "lastColour": "#00f",
        "stripHTML": True,
        "deleteMedia": False,
    }
    db_path = base / "prefs21.db"
    conn = sqlite3.connect(str(db_path))
    conn.execute(
        "create table profiles (name text primary key collate nocase, data blob not null)"
    )
    conn.execute(
        "insert into profiles values ('_global', ?)",
        (pickle.dumps(meta, protocol=4),),
    )
    conn.execute(
        "insert into profiles values (?, ?)",
        (TEST_PROFILE, pickle.dumps(profile, protocol=4)),
    )
    conn.commit()
    conn.close()


def main() -> int:
    BASE.mkdir(parents=True, exist_ok=True)
    if not (BASE / "prefs21.db").exists():
        _seed_prefs(BASE)

    starter = REPO_ROOT / "qt" / "aqt" / "data" / "mcat-starter.apkg"
    env = {
        **os.environ,
        "ANKI_BASE": str(BASE),
        "ANKI_API_PORT": str(MEDIASRV_PORT),
        # Documented testing escape (see qt/tests/launch_anki_for_e2e.py): grants
        # /_anki/* API access to the external Playwright Chromium driving /garden.
        "ANKI_API_HOST": "0.0.0.0",
        "ANKI_SINGLE_INSTANCE_KEY": "e2e-w1a",
        "ANKIDEV": "1",
        "CHARGED_UP_STARTER_DECK": str(starter),
        "QTWEBENGINE_REMOTE_DEBUGGING": str(CDP_PORT),
        "QTWEBENGINE_CHROMIUM_FLAGS": "--remote-allow-origins=*",
        "PYTHONPYCACHEPREFIX": str(REPO_ROOT / "out" / "pycache"),
        "PYTHONUNBUFFERED": "1",
        "RUST_BACKTRACE": "1",
    }
    # Headless by default; export GARDEN_E2E_HEADED=1 to watch the run.
    if not os.environ.get("GARDEN_E2E_HEADED"):
        env["QT_QPA_PLATFORM"] = "offscreen"

    proc = subprocess.Popen(
        [sys.executable, str(REPO_ROOT / "tools" / "run.py"), "-p", TEST_PROFILE],
        env=env,
        cwd=str(REPO_ROOT),
    )

    def _forward(signum: int, _frame: object) -> None:
        proc.terminate()

    signal.signal(signal.SIGTERM, _forward)
    signal.signal(signal.SIGINT, _forward)

    try:
        return proc.wait()
    except KeyboardInterrupt:
        proc.terminate()
        return proc.wait()


if __name__ == "__main__":
    sys.exit(main())
