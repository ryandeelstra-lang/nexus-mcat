#!/usr/bin/env bash
# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html
#
# charged_up: generate SwiftProtobuf message types for the iOS app from Anki's .proto files,
# using the SAME protoc the engine build downloaded. These are the Anki_<Package>_<Message>
# types AnkiBridge/SyncManager/etc. serialize over the FFI.
#
# Prereqs (one-time): the swift-protobuf plugin `protoc-gen-swift` on PATH:
#   brew install swift-protobuf     # provides protoc-gen-swift
# Run from the fork root AFTER `just check` (which fetches out/extracted/protoc).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PROTOC="${PROTOC_BINARY:-out/extracted/protoc/bin/protoc}"
if [ ! -x "$PROTOC" ]; then
  echo "!!! protoc not found at $PROTOC — run \`just check\` once first." >&2
  exit 1
fi
if ! command -v protoc-gen-swift >/dev/null 2>&1; then
  echo "!!! protoc-gen-swift not on PATH — install it: brew install swift-protobuf" >&2
  exit 1
fi

OUT="ios/ChargedUp/ChargedUp/Proto"
mkdir -p "$OUT"
echo ">>> generating SwiftProtobuf types into $OUT"
"$PROTOC" --proto_path=proto \
  --plugin=protoc-gen-swift="$(command -v protoc-gen-swift)" \
  --swift_out="$OUT" \
  --swift_opt=Visibility=Internal \
  proto/anki/*.proto
echo ">>> generated $(ls "$OUT"/*.pb.swift 2>/dev/null | wc -l | tr -d ' ') .pb.swift files"
