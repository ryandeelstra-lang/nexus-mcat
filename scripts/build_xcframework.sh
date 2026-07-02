#!/usr/bin/env bash
# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html
#
# charged_up: build the iOS FFI staticlib for BOTH the device and the simulator,
# verify the 4-symbol ABI + rustls-only linkage in each slice, and assemble
# ios/AnkiEngine.xcframework (the artifact the ChargedUp SwiftUI app links).
#
# This is the Phase-1 superset of scripts/build_ios.sh (which builds only the
# simulator slice as the W1 GO/NO-GO). Run from the fork root AFTER a normal
# `just`/`just check` build has bootstrapped the toolchain (it downloads protoc to
# out/extracted/protoc, which the anki_proto build script requires).
#
# IMPORTANT: builds into the TOP-LEVEL target/ (which minilints ignores). Building
# into anki-ios/target/ would leave generated proto/bindgen .rs files that minilints
# scans and red-bars `just check` (its IGNORED_FOLDERS are anchored at ./target and
# ./out only).
#
# Usage:  scripts/build_xcframework.sh [--release]
set -euo pipefail

export PATH="$HOME/.cargo/bin:$PATH"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export CARGO_TARGET_DIR="$ROOT/target/anki-ios"

PROFILE_DIR="debug"
EXTRA=()
if [ "${1:-}" = "--release" ]; then
  PROFILE_DIR="release"
  EXTRA=(--release)
fi

# device slice + simulator slice — both aarch64 but DIFFERENT platforms, which is
# exactly what -create-xcframework needs to distinguish (LC_BUILD_VERSION platform).
TARGETS=(aarch64-apple-ios aarch64-apple-ios-sim)

for t in "${TARGETS[@]}"; do
  echo ">>> building anki-ios for $t ($PROFILE_DIR)"
  cargo build --manifest-path anki-ios/Cargo.toml --target "$t" "${EXTRA[@]+"${EXTRA[@]}"}"
done

# ---- verify the ABI surface in EACH slice ---------------------------------------
fail=0
LIB_ARGS=()
for t in "${TARGETS[@]}"; do
  LIB="$CARGO_TARGET_DIR/$t/$PROFILE_DIR/libanki_ios.a"
  if [ ! -f "$LIB" ]; then
    echo "!!! missing $LIB" >&2
    exit 1
  fi
  echo ">>> [$t] exported _anki_ symbols (expect exactly 4):"
  nm -gU "$LIB" | grep ' T _anki_' || true
  count="$(nm -gU "$LIB" | grep -c ' T _anki_' || true)"
  echo ">>> [$t] count: $count"
  if [ "$count" -ne 4 ]; then
    echo "!!! [$t] expected exactly 4 _anki_ symbols, found $count" >&2
    fail=1
  fi
  echo ">>> [$t] native-tls / openssl LIBRARY linkage (expect NONE — rustls/ring only):"
  if nm "$LIB" | grep -iE ' U _(SSL_|EVP_|X509_|native_tls)'; then
    echo "!!! [$t] native-tls/openssl C symbols present — must be rustls-only" >&2
    fail=1
  else
    echo "(none)"
  fi
  LIB_ARGS+=(-library "$LIB" -headers "$ROOT/ios/include")
done

if [ "$fail" -ne 0 ]; then
  echo "!!! ABI verification failed; not assembling the XCFramework" >&2
  exit 1
fi

# ---- assemble the XCFramework ---------------------------------------------------
XCF="$ROOT/ios/AnkiEngine.xcframework"
rm -rf "$XCF" # -create-xcframework refuses to overwrite
xcodebuild -create-xcframework "${LIB_ARGS[@]}" -output "$XCF"

echo ">>> assembled $XCF"
find "$XCF" -maxdepth 2 -print | sed "s#$ROOT/##"
