import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { downloadVerifiedModel } from '../scripts/download-model.mjs';
import { verifiedModelCache } from '../scripts/model-cache.mjs';

test('model transfer preserves interruption, validates resume and hash, and reuses complete verified data',async()=> {
  const payload=Buffer.from('test model payload; not real ONNX'), ranges: (string | undefined)[]=[];
  let mode='short';
  const server=createServer((req,res)=> {
    ranges.push(req.headers.range);
    if(mode==='short') {res.writeHead(200);res.end(payload.subarray(0,8));}
    else if(mode==='ignore') {res.writeHead(200);res.end(payload);}
    else if(mode==='wrong-range') {res.writeHead(206,{'Content-Range':`bytes 0-${payload.length-1}/${payload.length}`});res.end(payload);}
    else {
      res.writeHead(206,{'Content-Range':`bytes 8-${payload.length-1}/${payload.length}`});
      res.end(mode==='corrupt' ? Buffer.alloc(payload.length-8) : payload.subarray(8));
    }
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const directory=await mkdtemp(join(tmpdir(),'motionbricks-download-')), target=join(directory,'model.onnx');
  const source={url:`http://127.0.0.1:${(server.address() as {port:number}).port}/model`,bytes:payload.length,
    sha256:createHash('sha256').update(payload).digest('hex')};
  try {
    await assert.rejects(downloadVerifiedModel({source,target}),/Incomplete model/);
    assert.deepEqual(await readFile(target+'.part'),payload.subarray(0,8));
    for(mode of ['ignore','wrong-range']) {
      await assert.rejects(downloadVerifiedModel({source,target}),/did not honor/);
      assert.deepEqual(await readFile(target+'.part'),payload.subarray(0,8),'Bad ranges must not corrupt the reusable prefix');
    }
    mode='corrupt';await assert.rejects(downloadVerifiedModel({source,target}),/integrity/);
    await assert.rejects(stat(target),{code:'ENOENT'},'Unverified data must never become the model');
    assert.equal((await stat(target+'.part')).size,payload.length,'Failed hash remains available for diagnosis');
    await writeFile(target+'.part',payload.subarray(0,8));
    mode='resume';await downloadVerifiedModel({source,target});
    assert.deepEqual(await readFile(target),payload);assert.equal(ranges.at(-1),'bytes=8-');
    const calls=ranges.length;await downloadVerifiedModel({source,target});assert.equal(ranges.length,calls,'No redundant full download');
    const cache=await verifiedModelCache(target,source);
    try {
      const response=await fetch(cache.url);
      assert.equal(response.headers.get('Access-Control-Allow-Origin'),'*');
      assert.deepEqual(Buffer.from(await response.arrayBuffer()),payload);
      assert.equal(cache.stats.requests,1);assert.equal(cache.stats.bytes,payload.length);
      assert.equal((await fetch(cache.url.replace('/model.onnx','/unrelated'))).status,404);
    } finally {await new Promise<void>(resolve=>cache.server.close(()=>resolve()));}
    await writeFile(target,Buffer.alloc(payload.length));
    await assert.rejects(downloadVerifiedModel({source,target}),/wrong size\/SHA-256/);
    await assert.rejects(verifiedModelCache(target,source));
    await writeFile(target,Buffer.alloc(0));
    await assert.rejects(downloadVerifiedModel({source,target}),/wrong size\/SHA-256/);
    assert.equal(ranges.length,calls,'A bad existing model must not trigger replacement or download');
  } finally {
    await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(directory,{recursive:true,force:true});
  }
});
