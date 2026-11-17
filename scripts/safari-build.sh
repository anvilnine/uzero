#!/usr/bin/env bash
# Offline builds: macos|ios|simulator, Debug|Release, [--no-sign] [--dry-run].
# Signing uses installed local credentials only. This script never uploads.
set -euo pipefail
cd "$(dirname "$0")/.."
PLATFORM="${1:-macos}"; CONFIG="${2:-Debug}"
if [ "$#" -gt 0 ]; then shift; fi
if [ "$#" -gt 0 ]; then shift; fi
SIGN=true; DRY=false
for arg in "$@"; do
  case "$arg" in --no-sign) SIGN=false;; --dry-run) DRY=true;; *) echo "Unknown option: $arg" >&2; exit 2;; esac
done
case "$CONFIG" in Debug|Release) ;; *) echo 'Expected Debug or Release' >&2; exit 2;; esac
SDK=macosx; SCHEME='Uzero (macOS)'; DEST='generic/platform=macOS'
case "$PLATFORM" in
 macos) ;;
 ios) SDK=iphoneos; SCHEME='Uzero (iOS)'; DEST='generic/platform=iOS';;
 simulator) SDK=iphonesimulator; SCHEME='Uzero (iOS)'; DEST='generic/platform=iOS Simulator'; SIGN=false;;
 *) echo 'Expected macos, ios or simulator' >&2; exit 2;;
esac
VERSION="$(node -p "JSON.parse(require('fs').readFileSync('package.json')).version")"
ARGS=(-project safari/Uzero.xcodeproj -scheme "$SCHEME" -configuration "$CONFIG" -sdk "$SDK" -destination "$DEST" -derivedDataPath ".output/xcode-$PLATFORM" "MARKETING_VERSION=$VERSION" CURRENT_PROJECT_VERSION=1)
if $SIGN; then ARGS+=(DEVELOPMENT_TEAM=N358LNAWS2 CODE_SIGN_STYLE=Automatic); else ARGS+=(CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO); fi
if $DRY; then printf '%s\n' "xcodebuild ${ARGS[*]} build"; exit 0; fi
node_modules/.bin/wxt build -b safari --mv3
# Only this generated resource tree is synchronized. Remove stale build assets.
RES='safari/Shared (Extension)/Resources'
mkdir -p "$RES"
rsync -a --delete .output/safari-mv3/ "$RES/"
# The project is JSON (Xcode 27). Persist the version for all four native targets.
node --input-type=module - "$VERSION" <<'JS'
import fs from 'node:fs';
const path='safari/Uzero.xcodeproj/project.xcproj';
let text=fs.readFileSync(path,'utf8');
text=text.replace(/"MARKETING_VERSION": "[^"]+"/g,`"MARKETING_VERSION": "${process.argv[2]}"`).replace(/"CURRENT_PROJECT_VERSION": "[^"]+"/g,'"CURRENT_PROJECT_VERSION": "1"');
fs.writeFileSync(path,text);
JS
xcodebuild "${ARGS[@]}" build
echo "Built locally: .output/xcode-$PLATFORM/Build/Products/ (signing requested: $SIGN)"
