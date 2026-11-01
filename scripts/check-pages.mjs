// Check the actual upload directory, independently of the Vite asset allowlist.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Deliberately independent of Vite's copy list: check the directory actually
// uploaded by Actions, including accidentally copied textures and renamed GLBs.
export const requiredFiles = ['index.html', 'assets/soma.glb', 'assets/soma_n1.json',
  'assets/uka/model.glb', 'assets/uka/README.md', 'assets/uka/README.ja.md',
  'assets/uka/conversion.json', 'runtime/ammo.js', 'runtime/ammo-LICENSE', 'NOTICE.txt',
  'licenses/SOMA-X-Apache-2.0.txt', 'licenses/MotionBricks-LICENSE.txt'];

export async function checkPages(root = new URL('../dist/', import.meta.url)) {
  const files = await readdir(root, {recursive: true, withFileTypes: true});
  let count = 0, bytes = 0;
  for (const file of files) {
    assert.ok(!file.isSymbolicLink(), `Pages cannot contain symlinks: ${file.name}`);
    if (!file.isFile()) continue;
    const path = join(file.parentPath, file.name);
    const name = relative(fileURLToPath(root), path).split('\\').join('/');
    const reviewedCharacter = ['assets/soma.glb','assets/uka/model.glb'].includes(name);
    const characterError = `Unreviewed character asset in Pages (Animasa is local-only): ${file.name}`;
    if (/\.(glb|gltf)$/i.test(file.name)) assert.ok(reviewedCharacter, characterError);
    assert.ok(!/\.(onnx|part|pmd|pmx|vmd)$/i.test(file.name), `Source model, motion or weights in Pages: ${file.name}`);
    assert.ok(requiredFiles.includes(name) || /^assets\/[^/]+-[\w-]{8,}\.(js|css|wasm)$/.test(name),
      `Unreviewed file in Pages: ${name}`);
    // Reject names before reading, especially large accidentally copied weights.
    const content = await readFile(path);
    assert.ok(content.subarray(0, 4).toString() !== 'glTF' || reviewedCharacter, characterError);
    assert.ok(!content.subarray(0, 100).toString().startsWith('version https://git-lfs.github.com/spec/'), `LFS pointer: ${file.name}`);
    count++; bytes += content.length;
  }
  const html = await readFile(new URL('index.html', root), 'utf8');
  for (const [, path] of html.matchAll(/(?:src|href)="(\/[^\"]+)"/g)) {
    assert.ok(path.startsWith('/three-motionbricks/'), `Incorrect Pages base: ${path}`);
    await readFile(new URL(path.slice('/three-motionbricks/'.length), root));
  }
  for (const name of requiredFiles) await readFile(new URL(name, root));
  assert.ok(files.some(file => file.name.endsWith('.wasm')), 'Missing local ORT WASM');
  return {count, bytes};
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const {count, bytes} = await checkPages();
  console.log(`Pages artifact checked: ${count} files, ${(bytes / 1_000_000).toFixed(1)} MB; only reviewed assets and generated code/runtime.`);
}
