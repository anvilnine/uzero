// Opt-in integration gate: node --test scripts/tests/safari-bundle.integration.mjs
// First build macos Debug, simulator Debug and ios Release with safari-build.sh.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const web = '.output/safari-mv3';
function files(root) {
  return readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const path = join(root, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}
const destinations = [
  ['tracked resources', 'safari/Shared (Extension)/Resources'],
  ['macOS Debug', '.output/xcode-macos/Build/Products/Debug/Uzero.app/Contents/PlugIns/Uzero Extension.appex/Contents/Resources'],
  ['simulator Debug', '.output/xcode-simulator/Build/Products/Debug-iphonesimulator/Uzero.app/PlugIns/Uzero Extension.appex'],
  ['iOS Release', '.output/xcode-ios/Build/Products/Release-iphoneos/Uzero.app/PlugIns/Uzero Extension.appex'],
];
for (const [name, root] of destinations) {
  test(`${name} packages every current Safari web resource unchanged`, () => {
    // Check dynamic script entrypoints too. They are intentionally absent from manifest content_scripts.
    for (const path of ['manifest.json', 'background.js', 'content-scripts/safari-guide.js', 'reorder.html']) {
      assert.ok(readFileSync(join(web, path)).length > 0, path);
    }
    assert.equal(JSON.parse(readFileSync(join(web, 'manifest.json'))).manifest_version, 3);
    for (const path of files(web)) {
      const target = join(root, relative(web, path));
      assert.ok(existsSync(target), `Missing packaged resource: ${target}`);
      assert.deepEqual(readFileSync(target), readFileSync(path), target);
    }
  });
}
