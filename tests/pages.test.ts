import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkPages, requiredFiles } from '../scripts/check-pages.mjs';

test('Pages upload check rejects unreviewed models, textures and renamed derivatives', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'motionbricks-pages-'));
  const root = pathToFileURL(directory + '/');
  const put = async (name: string, bytes: string | Buffer) => {
    await mkdir(dirname(join(directory, name)), {recursive: true});
    await writeFile(join(directory, name), bytes);
  };
  try {
    // Use pinned published Animasa bytes; other payloads are synthetic.
    for (const name of requiredFiles) await put(name, name.startsWith('assets/animasa/') ? await readFile(new URL(`../public/${name}`, import.meta.url)) : 'fixture');
    await put('assets/ort-wasm-12345678.wasm', 'fixture');
    await put('assets/index-12345678.js', 'fixture');
    await checkPages(root);
    for (const [name, bytes, error] of [
      ['assets/animasa/other.glb', 'glTF', /Unreviewed character asset/],
      ['assets/index-abcdefgh.js', 'glTF', /Unreviewed character asset/],
      ['assets/miku_v2.pmd', 'fixture', /Source model/],
      ['assets/eyeM2.bmp', 'fixture', /Unreviewed file/],
      ['assets/toon01.png', 'fixture', /Unreviewed file/],
      ['assets/animasa/other.json', 'fixture', /Unreviewed file/],
    ] as const) {
      await put(name, bytes);
      await assert.rejects(checkPages(root), error, name);
      await rm(join(directory, name));
    }
    await put('assets/animasa/model.glb', 'glTF');
    await assert.rejects(checkPages(root), /Incorrect Animasa/);
    await put('assets/animasa/model.glb', await readFile('public/assets/animasa/model.glb'));
    const corrupted = await readFile('public/assets/animasa/model.glb');
    corrupted[corrupted.length - 1] ^= 1;
    await put('assets/animasa/model.glb', corrupted);
    await assert.rejects(checkPages(root), /Incorrect Animasa hash/);
    await put('assets/animasa/model.glb', await readFile('public/assets/animasa/model.glb'));
    await rm(join(directory, 'NOTICE.txt'));
    await assert.rejects(checkPages(root), /ENOENT/);
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});
