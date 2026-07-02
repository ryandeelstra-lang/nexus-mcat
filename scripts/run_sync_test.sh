#!/usr/bin/env bash
# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html
#
# charged_up: run the §7b host-side sync integration test (tests/sync). It drives the iOS
# C ABI (anki-ios) against an in-process anki-sync-server with SYNC_USER1=demo:demo and
# proves two-way, offline-tolerant sync with LWW-by-mtime conflict resolution.
#
# Run from the fork root AFTER `just check` has bootstrapped the toolchain (protoc + the
# out/rslib/proto/descriptors.bin the test reads for the FFI dispatch indices).
set -euo pipefail
export PATH="$HOME/.cargo/bin:$PATH"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
# Build into the TOP-LEVEL target/ (minilints + dprint ignore ./target); a target/ dir under
# tests/sync/ would leave generated proto .rs that minilints scans → red `just check`.
export CARGO_TARGET_DIR="$ROOT/target/tests-sync"

if [ ! -f "out/rslib/proto/descriptors.bin" ]; then
  echo "!!! out/rslib/proto/descriptors.bin missing — run \`just check\` once first to" >&2
  echo "    bootstrap protoc and compile the protos." >&2
  exit 1
fi

# Build the real anki-sync-server binary the test spawns, reusing the engine already
# compiled by `just check` in out/rust (fast: just links the binary).
SERVER_BIN="${ANKI_SYNC_SERVER_BIN:-$ROOT/out/rust/debug/anki-sync-server}"
if [ ! -x "$SERVER_BIN" ]; then
  echo ">>> building anki-sync-server (into out/rust, reusing the engine cache)"
  CARGO_TARGET_DIR="$ROOT/out/rust" cargo build -p anki-sync-server
fi
export ANKI_SYNC_SERVER_BIN="$SERVER_BIN"
echo ">>> using anki-sync-server: $ANKI_SYNC_SERVER_BIN"

echo ">>> running §7b host-side sync test (iOS C ABI ↔ anki-sync-server, demo:demo)"
cargo test --manifest-path tests/sync/Cargo.toml --test sync_7b -- --nocapture --test-threads=1
