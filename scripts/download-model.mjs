import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import model from '../model-source.json' with {type: 'json'};

async function hashFile(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
async function size(path) {
  try {return (await stat(path)).size;} catch (error) {if (error.code === 'ENOENT') return undefined; throw error;}
}

/** One connection, no automatic retries. Keep partial bytes across interruption;
 * resume only an exact range and publish only the size/hash-verified payload. */
export async function downloadVerifiedModel({source, target, signal, progress = () => {}}) {
  if (await size(target) !== undefined) {
    if (await size(target) === source.bytes && await hashFile(target) === source.sha256) return;
    throw new Error(`Existing ${target} has the wrong size/SHA-256. Move it aside before downloading again.`);
  }
  await mkdir(dirname(target), {recursive:true});
  const partial = `${target}.part`, offset = (await size(partial)) ?? 0;
  if (offset > source.bytes) throw new Error(`Partial ${partial} is oversized. Move it aside before downloading again.`);
  progress(offset);
  if (offset < source.bytes) {
    const response = await fetch(source.url, {signal, headers:offset ? {Range:`bytes=${offset}-`} : {}});
    if (!response.ok || !response.body) throw new Error(`Model download HTTP ${response.status}; partial retained at ${partial}`);
    if (offset && (response.status !== 206 || response.headers.get('content-range') !== `bytes ${offset}-${source.bytes-1}/${source.bytes}`)) {
      await response.body.cancel();
      throw new Error(`Host did not honor the pinned resume range; partial retained at ${partial}`);
    }
    let received = offset;
    const count = new Transform({transform(chunk, _, callback) {
      if (received + chunk.length > source.bytes) {callback(new Error('Model download exceeds pinned length.')); return;}
      received += chunk.length; progress(received); callback(null, chunk);
    }});
    await pipeline(Readable.fromWeb(response.body), count, createWriteStream(partial, {flags:offset ? 'a' : 'w'}), {signal});
  }
  if (await size(partial) !== source.bytes) throw new Error(`Incomplete model; partial retained at ${partial}. Run again to resume.`);
  if (await hashFile(partial) !== source.sha256) throw new Error(`Model integrity check failed. Move ${partial} aside before downloading again.`);
  await rename(partial, target);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const target = fileURLToPath(new URL('../public/assets/mmm_v6_soma_fp32.onnx', import.meta.url));
  const timeoutMs = Number(process.env.MODEL_DOWNLOAD_TIMEOUT_MS ?? 900000);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new Error('MODEL_DOWNLOAD_TIMEOUT_MS must be a positive integer.');
  console.log('Downloading/resuming official SOMA FP32 ONNX. Model license: NVIDIA Open Model Agreement; see docs/assets.md.');
  let lastLog = -Infinity;
  await downloadVerifiedModel({source:model, target, signal:AbortSignal.timeout(timeoutMs), progress(bytes) {
    if (Date.now()-lastLog >= 30000) {console.log(`${bytes} / ${model.bytes} bytes; partial is retained on interruption.`); lastLog=Date.now();}
  }});
  console.log('Saved and SHA-256 verified: public/assets/mmm_v6_soma_fp32.onnx');
}
