// Test-only, streaming delivery of the exact pinned weights. Application URLs,
// worker code and WASM remain served by the tested origin.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';

export async function verifiedModelCache(path, model) {
  assert.equal((await stat(path)).size, model.bytes);
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  assert.equal(hash.digest('hex'), model.sha256);
  const stats={requests:0,bytes:0};
  const server = createServer((request, response) => {
    if (request.method !== 'GET' || request.url !== '/model.onnx') {response.writeHead(404).end(); return;}
    stats.requests++;
    response.writeHead(200, {'Content-Type':'application/octet-stream',
      'Content-Length':model.bytes, 'Access-Control-Allow-Origin':'*'});
    const stream=createReadStream(path);
    stream.on('data',chunk=>{stats.bytes+=chunk.length;});
    response.on('close',()=>stream.destroy());
    stream.pipe(response);
  });
  await new Promise((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', resolve);});
  return {server, stats, url:`http://127.0.0.1:${server.address().port}/model.onnx`};
}
