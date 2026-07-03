#!/bin/bash
# Regenerate Swift protobuf types for the KG companion app. Re-run after ANY proto/ change.
# DropPath => flat .pb.swift files in Generated/ (no anki/ package subdirs).
set -euo pipefail
cd "$(dirname "$0")/.."
rm -rf ios-app/Generated && mkdir -p ios-app/Generated
protoc -I proto --swift_out=ios-app/Generated \
  --swift_opt=Visibility=Public,FileNaming=DropPath proto/anki/*.proto
echo "generated: $(ls ios-app/Generated/*.pb.swift | wc -l | tr -d ' ') files"
