import { resolve, relative } from 'node:path';
import { convertAnimasa } from './animasa-converter';

const source = process.argv[2], output = resolve(process.argv[3] ?? '.cache/animasa-local');
if (!source) throw new Error('Usage: npm run assets:animasa -- /path/to/source-root [local-output-directory]. See docs/animasa.md.');
// Require ignored workspace storage, outside the Vite public tree and Pages artifact.
const rel = relative(resolve('.cache'),output);
if (rel === '..' || rel.startsWith('../') || resolve(output) === resolve('.cache'))
  throw new Error('Animasa output must be a subdirectory of .cache/; redistribution is not cleared.');
console.log(JSON.stringify(await convertAnimasa(resolve(source),output),null,2));
