#!/usr/bin/env bash
# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html
#
# charged_up: (re)generate ios/ChargedUp/ChargedUp/ServiceIndices.swift from Anki's
# compiled DescriptorPool, so the Swift FFI client never hard-guesses (service, method)
# u32 indices. Run from the fork root AFTER a normal `just`/`just check` build (which
# writes out/rslib/proto/descriptors.bin via the anki_proto build script).
#
# Usage: scripts/generate_service_indices.sh
set -euo pipefail
export PATH="$HOME/.cargo/bin:$PATH"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
# Build into the TOP-LEVEL target/ (which minilints + dprint ignore); a target/ dir under
# scripts/ would leave dependency build-script .rs output that minilints scans → red `just check`.
export CARGO_TARGET_DIR="$ROOT/target/service-index-dumper"

DESCRIPTORS="${DESCRIPTORS_BIN:-out/rslib/proto/descriptors.bin}"
if [ ! -f "$DESCRIPTORS" ]; then
  echo "!!! $DESCRIPTORS not found — run \`just check\` (or \`just build\`) first to compile the protos." >&2
  exit 1
fi

OUT="ios/ChargedUp/ChargedUp/ServiceIndices.swift"
mkdir -p "$(dirname "$OUT")"
echo ">>> generating $OUT from $DESCRIPTORS"
cargo run --quiet --manifest-path scripts/service-index-dumper/Cargo.toml -- "$DESCRIPTORS" > "$OUT"
echo ">>> wrote $(wc -l < "$OUT") lines"
