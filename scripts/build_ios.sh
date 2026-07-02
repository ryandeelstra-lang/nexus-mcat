#!/usr/bin/env bash
# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html
#
# charged_up: cross-compile the iOS FFI staticlib (W1 GO/NO-GO) + verify the ABI surface.
#
# IMPORTANT: builds into the TOP-LEVEL target/ (which minilints ignores). Building into the default
# anki-ios/target/ leaves generated proto/bindgen .rs files that minilints scans and red-bars
# `just check` (its IGNORED_FOLDERS are anchored at ./target and ./out only). Run from the fork root.
set -euo pipefail
export PATH="$HOME/.cargo/bin:$PATH"
export CARGO_TARGET_DIR="$(pwd)/target/anki-ios"

PROFILE_DIR="debug"
EXTRA=()
if [ "${1:-}" = "--release" ]; then PROFILE_DIR="release"; EXTRA=(--release); fi

# Simulator target is the GO/NO-GO; add aarch64-apple-ios for the device half of the XCFramework.
for t in aarch64-apple-ios-sim; do
  echo ">>> building anki-ios for $t ($PROFILE_DIR)"
  cargo build --manifest-path anki-ios/Cargo.toml --target "$t" "${EXTRA[@]+"${EXTRA[@]}"}"
done

LIB="$CARGO_TARGET_DIR/aarch64-apple-ios-sim/$PROFILE_DIR/libanki_ios.a"
echo ">>> exported _anki_ symbols (expect exactly 4):"
nm -gU "$LIB" | grep ' T _anki_' || true
echo ">>> count: $(nm -gU "$LIB" | grep -c ' T _anki_')"
echo ">>> native-tls / openssl LIBRARY linkage (expect NONE — rustls/ring only):"
nm "$LIB" | grep -iE ' U _(SSL_|EVP_|X509_|native_tls)' || echo "(none)"
