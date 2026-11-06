// Recompute saved real-proposal inputs, output and scores at the current source.
// No inference, network, diagnostics hook or synthetic model output.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {Quaternion,Vector3} from 'three';
import {type Pose} from '../src/motion';
import {type PartControl} from '../src/interaction';
import {encodeProposal,proposalQuality} from '../src/interaction-controller';
import {somaFixture} from '../tests/mmd-fixture';
const read=async (path:string)=>readFile(new URL(path,import.meta.url));
const summary=JSON.parse((await read('../docs/interaction-response-quality-validation.json')).toString());
const traces=JSON.parse(gunzipSync(await read('../docs/interaction-response-quality-traces.json.gz')).toString());
for(const [name,hash] of Object.entries(summary.runtimeSourceSha256))
  assert.equal(createHash('sha256').update(await read(`../src/${name}`)).digest('hex'),hash,`Current source: ${name}`);
const {rig}=somaFixture();
const pose=(p:any):Pose=>({root:new Vector3().fromArray(p.root),rotations:p.rotations.map((q:number[])=>new Quaternion().fromArray(q))});
const vector=(v:any)=>v ? new Vector3(v.x,v.y,v.z) : undefined;
const quaternion=(q:any)=>!q ? undefined : Array.isArray(q) ? new Quaternion().fromArray(q) : new Quaternion(q._x,q._y,q._z,q._w);
const control=(c:any):PartControl|undefined=>!c ? undefined : {...c,position:vector(c.position),rotation:quaternion(c.rotation),
  velocity:vector(c.velocity)!,angularVelocity:quaternion(c.angularVelocity)!};
let sequences=0,proposals=0,samples=0;
const check=(s:any,batch:any,strength=1)=> {
  const request={revision:0,context:s.context.map(pose),targets:s.neutralTargets.map(pose),
    control:control(s.control),controls:s.controls.map((c:any)=>({...control(c)!,sampledAt:c.sampledAt})),now:s.requestedAt};
  const imposed=encodeProposal(request,rig,strength,0);
  const baseline=batch.candidates.find((c:any)=>c.index===1 && !c.quality.problem)?.rawMotion.map(pose);
  assert.ok(batch.candidates.length>=1 && batch.candidates.length<=2);
  const best=batch.candidates.find((c:any)=>c.index===batch.selected);
  assert.ok(best);
  for(const c of batch.candidates) {
    const encoded=encodeProposal(request,rig,strength,c.index);
    for(const [name,values] of Object.entries(encoded.features)) {
      assert.equal(c.features[name].length,values.length);
      // Browser/Node trig and FK can round differently before Float32 storage.
      // Masks/token constraints remain exact; feature comparisons allow 1e-6.
      for(let i=0;i<values.length;i++) assert.ok(Math.abs(values[i]-c.features[name][i])<=(values instanceof Int32Array ? 0 : 1e-6),`Supported conditioning ${name}[${i}]`);
    }
    const quality=proposalQuality(c.rawMotion.map(pose),request,rig,imposed,baseline);
    for(const [key,value] of Object.entries(quality)) {
      if(typeof value==='number') assert.ok(Math.abs(value-c.quality[key])<1e-8,`Recomputed ${key}`);
      else assert.equal(c.quality[key],value);
    }
    assert.ok(c.quality.response<=.04+1e-12);
    if(!baseline || c.index===1 || !request.control) assert.ok(c.quality.response<1e-12,'No unsupported reaction credit');
    if(!c.quality.problem) assert.ok(best.quality.score<=c.quality.score+1e-12);
    proposals++;
  }
  sequences++;
};
for(const r of traces.experiment.rollouts) for(const s of r.sequences) check(s,s);
for(const r of traces.traces) {
  for(const s of r.interactionSequences) {
    check(s,s.selection,.8); // Pointer suite leaves the default conditioning strength unchanged.
    const selected=s.selection.candidates.find((c:any)=>c.index===s.selection.selected);
    assert.deepEqual(s.rawMotion,selected.rawMotion);
    assert.equal(s.selection.queued,0);
  }
  for(const s of r.displayedInteraction) {
    assert.ok(s.directCorrection.every((c:any)=>c.radians<=.45+1e-6));
    if(r.joint==='LeftHand') assert.ok(s.directCorrection.filter((c:any)=>['Chest','RightHand','RightArm','Hips'].includes(c.joint)).every((c:any)=>c.radians<1e-6));
    samples++;
  }
}
console.log(JSON.stringify({sourceHashes:Object.keys(summary.runtimeSourceSha256).length,sequences,proposals,samples}));
