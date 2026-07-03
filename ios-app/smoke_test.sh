#!/bin/bash
# Builds the KG companion for the iPhone 17 Pro simulator, installs, launches, asserts a live PID.
# This is the Wednesday "phone builds and runs on a real device/emulator" proof.
set -euo pipefail
cd "$(dirname "$0")"
SIM="${KG_SIM:-iPhone 17 Pro}"
BUNDLE=com.chargedup.knowledgegarden.companion

xcodegen generate
xcodebuild -project KnowledgeGardenCompanion.xcodeproj -scheme KnowledgeGardenCompanion \
  -destination "platform=iOS Simulator,name=$SIM" -configuration Debug \
  -derivedDataPath build build | tail -8
APP=build/Build/Products/Debug-iphonesimulator/KnowledgeGardenCompanion.app
[ -d "$APP" ] || { echo "SMOKE-FAIL: app bundle missing"; exit 1; }

xcrun simctl boot "$SIM" 2>/dev/null || true
xcrun simctl install booted "$APP"
OUT=$(xcrun simctl launch booted "$BUNDLE")
echo "$OUT" | grep -Eq ': [0-9]+$' || { echo "SMOKE-FAIL: no pid from launch"; exit 1; }
echo "SMOKE-OK: $OUT"
