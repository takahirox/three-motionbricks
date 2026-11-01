import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkPages, requiredFiles } from '../scripts/check-pages.mjs';

test('Pages upload check rejects unreviewed models, textures and renamed derivatives', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'motionbricks-pages-'));
  const root = pathToFileURL(directory + '/');
  const put = async (name: string, bytes: string) => {
    await mkdir(dirname(join(directory, name)), {recursive: true});
    await writeFile(join(directory, name), bytes);
  };
  try {
    // Synthetic payloads exercise packaging without acquiring third-party assets.
    for (const name of requiredFiles) await put(name, 'fixture');
    await put('assets/ort-wasm-12345678.wasm', 'fixture');
    await put('assets/index-12345678.js', 'fixture');
    await checkPages(root);
    for (const [name, bytes, error] of [
      ['assets/animasa/model.glb', 'glTF', /Unreviewed character asset/],
      ['assets/index-abcdefgh.js', 'glTF', /Unreviewed character asset/],
      ['assets/miku_v2.pmd', 'fixture', /Source model/],
      ['assets/eyeM2.bmp', 'fixture', /Unreviewed file/],
      ['assets/toon01.png', 'fixture', /Unreviewed file/],
      ['assets/animasa/conversion.json', 'fixture', /Unreviewed file/],
    ] as const) {
      await put(name, bytes);
      await assert.rejects(checkPages(root), error, name);
      await rm(join(directory, name));
    }
    await rm(join(directory, 'NOTICE.txt'));
    await assert.rejects(checkPages(root), /ENOENT/);
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});
