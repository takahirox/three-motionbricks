import { resolve, relative } from 'node:path';
import { convertAnimasa } from './animasa-converter';

const source = process.argv[2], destination = process.argv[3];
if (!source) throw new Error('Usage: npm run assets:animasa -- /path/to/source-root [--publish|.cache/output]. See docs/animasa.md.');
// Public output is restricted to the exact reviewed asset directory. Scratch
// conversion remains isolated from Vite's public tree.
const output = resolve(destination === '--publish' ? 'public/assets/animasa' : destination ?? '.cache/animasa-local');
const rel = relative(resolve('.cache'), output);
if (destination !== '--publish' && (rel === '..' || rel.startsWith('../') || rel === ''))
  throw new Error('Scratch output must be a subdirectory of .cache/; use --publish for the reviewed Animasa directory.');
console.log(JSON.stringify(await convertAnimasa(resolve(source), output), null, 2));
