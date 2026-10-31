import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { access, mkdir, rename, rm } from 'node:fs/promises';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import model from '../model-source.json' with {type: 'json'};

const expectedHash = model.sha256;
const target = fileURLToPath(new URL('../public/assets/mmm_v6_soma_fp32.onnx', import.meta.url));
async function hashFile(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
try {
  await access(target);
  if (await hashFile(target) === expectedHash) {console.log('Official SOMA FP32 model already verified.'); process.exit(0);}
  throw new Error(`Existing ${target} has the wrong SHA-256. Move it aside before downloading again.`);
} catch (error) {if (error.code !== 'ENOENT') throw error;}
console.log('Downloading the official SOMA FP32 ONNX (757,864,273 bytes).');
console.log('Model license: NVIDIA Open Model Agreement. See docs/assets.md.');
const url = model.url;
await mkdir(new URL('../public/assets/', import.meta.url), {recursive: true});
const partial = `${target}.${process.pid}.part`;
try {
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`Model download HTTP ${response.status}`);
  const hash = createHash('sha256'); let bytes = 0;
  const verify = new Transform({transform(chunk, _, callback) {hash.update(chunk); bytes += chunk.length; callback(null, chunk);}});
  await pipeline(Readable.fromWeb(response.body), verify, createWriteStream(partial, {flags: 'wx'}));
  if (bytes !== model.bytes || hash.digest('hex') !== expectedHash) throw new Error('Model integrity check failed.');
  await rename(partial, target);
  console.log('Saved and SHA-256 verified: public/assets/mmm_v6_soma_fp32.onnx');
} catch (error) {await rm(partial, {force: true}); throw error;}
