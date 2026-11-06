#!/usr/bin/env bash
# Build the Safari extension and its Mac/iOS container apps.
# Usage: scripts/safari-build.sh [macos|ios] [Debug|Release]
set -euo pipefail
cd "$(dirname "$0")/.."
PLATFORM="${1:-macos}"
CONFIG="${2:-Debug}"
TEAM="N358LNAWS2"

npx -y pnpm@9 exec wxt build -b safari --mv3
RES="safari/Shared (Extension)/Resources"
rm -rf "$RES"
mkdir -p "$RES"
cp -R .output/safari-mv3/. "$RES/"

SCHEME="Uzero (macOS)"
DEST="generic/platform=macOS"
if [ "$PLATFORM" = "ios" ]; then SCHEME="Uzero (iOS)"; DEST="generic/platform=iOS"; fi

xcodebuild -project safari/Uzero.xcodeproj -scheme "$SCHEME" -configuration "$CONFIG" \
  -destination "$DEST" -derivedDataPath .output/xcode \
  DEVELOPMENT_TEAM="$TEAM" CODE_SIGN_STYLE=Automatic -allowProvisioningUpdates build
echo "Built: .output/xcode/Build/Products/$CONFIG*/"
