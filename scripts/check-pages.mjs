// Check the actual upload directory, independently of the Vite asset allowlist.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
const root = new URL('../dist/', import.meta.url);
const files = await readdir(root, {recursive: true, withFileTypes: true});
let count = 0, bytes = 0;
for (const file of files) {
  assert.ok(!file.isSymbolicLink(), `Pages cannot contain symlinks: ${file.name}`);
  if (!file.isFile()) continue;
  assert.ok(!/\.(onnx|part|pmd|pmx|vmd)$/i.test(file.name), `Source model, motion or weights in Pages: ${file.name}`);
  const content = await readFile(join(file.parentPath, file.name));
  assert.ok(!content.subarray(0, 100).toString().startsWith('version https://git-lfs.github.com/spec/'), `LFS pointer: ${file.name}`);
  count++; bytes += content.length;
}
const html = await readFile(new URL('index.html', root), 'utf8');
for (const [, path] of html.matchAll(/(?:src|href)="(\/[^\"]+)"/g)) {
  assert.ok(path.startsWith('/three-motionbricks/'), `Incorrect Pages base: ${path}`);
  await readFile(new URL(path.slice('/three-motionbricks/'.length), root));
}
for (const name of ['assets/soma.glb', 'assets/soma_n1.json', 'assets/uka/model.glb', 'assets/uka/README.md',
  'assets/uka/README.ja.md', 'assets/uka/conversion.json', 'runtime/ammo.js', 'runtime/ammo-LICENSE', 'NOTICE.txt',
  'licenses/SOMA-X-Apache-2.0.txt', 'licenses/MotionBricks-LICENSE.txt']) await readFile(new URL(name, root));
assert.ok(files.some(file => file.name.endsWith('.wasm')), 'Missing local ORT WASM');
console.log(`Pages artifact checked: ${count} files, ${(bytes / 1_000_000).toFixed(1)} MB; no weights or LFS pointers.`);
