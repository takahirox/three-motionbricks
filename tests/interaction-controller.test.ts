import test from 'node:test';
import assert from 'node:assert/strict';
import { Quaternion, Vector3 } from 'three';
import { InteractionController, encodeProposal, proposalQuality } from '../src/interaction-controller.ts';
import { InteractionResponse } from '../src/interaction.ts';
import { clonePose, positions } from '../src/motion.ts';
import { somaFixture } from './mmd-fixture.ts';
const {stance,rig}=somaFixture();
const response=new InteractionResponse(stance);
response.begin('LeftHand',positions(stance,rig)[13],undefined,0);
const request=response.request(1);
// Deterministic tensor fixture for scheduler tests only; never model evidence.
const data=new Float32Array(64*366);
for(let f=0;f<64;f++) {
  data[f*366+1]=1;
  for(let j=0;j<30;j++) data.set([1,0,0,0,1,0],f*366+92+j*6);
}
const output={data,tokens:6,milliseconds:20};

test('proposal masks omit whole future poses, preserve history/root and never mutate request',()=> {
  const before=response.request(1), a=encodeProposal(request,rig,1,0), b=encodeProposal(request,rig,1,1);
  assert.deepEqual(response.request(1),before);
  assert.deepEqual([...b.features.has_local_poses],[1,1,1,1,0,0,0,0]);
  assert.deepEqual(b.features.has_global_root_values,a.features.has_global_root_values);
  assert.deepEqual(b.features.has_local_root_values,a.features.has_local_root_values);
  assert.deepEqual(b.features.local_poses,a.features.local_poses);
  assert.throws(()=>encodeProposal(request,rig,1,3));
});

test('raw selection penalizes rigid heading and does not reward unlimited local activity',()=> {
  const encoded=encodeProposal(request,rig,1,0);
  const still=Array.from({length:18},()=>clonePose(stance));
  const turned=still.map(p=> {
    p.rotations=p.rotations.map(q=>new Quaternion().setFromAxisAngle(new Vector3(0,1,0),1).multiply(q));return p;
  });
  assert.match(proposalQuality(turned,request,rig,encoded).problem!,/heading/);
  const activity=(r:number)=>still.map(p=> {const c=clonePose(p);c.rotations[17].premultiply(new Quaternion().setFromAxisAngle(new Vector3(0,0,1),r));return c;});
  const small=proposalQuality(activity(.05),request,rig,encoded), large=proposalQuality(activity(1),request,rig,encoded);
  assert.equal(small.activity,large.activity,'Activity credit saturates; flailing is not a better reaction');
  const shifted=still.map(p=> {const c=clonePose(p);c.root.x+=.5;return c;});
  assert.match(proposalQuality(shifted,request,rig,encoded).problem!,/root/);
});

test('selection serializes two real-run slots, rejects overlap and disposes cancelled batches before another call',async()=> {
  const controller=new InteractionController(), other=new InteractionController();
  let resolve!: (v: typeof output)=>void, calls=0,current=true;
  const pending=controller.select(request,rig,1,()=> {calls++;return new Promise(r=>{resolve=r;});},()=>current);
  assert.equal(await other.select(request,rig,1,async()=>output,()=>true),undefined);
  current=false;resolve(output);
  assert.equal(await pending,undefined);assert.equal(calls,1);
  let active=0,maxActive=0;
  const result=await controller.select(request,rig,1,async()=>{active++;maxActive=Math.max(maxActive,active);await Promise.resolve();active--;return output;},()=>true);
  assert.equal(result!.candidates.length,2);assert.equal(maxActive,1);assert.equal(result!.queued,0);
  await assert.rejects(controller.select(request,rig,1,async()=>{throw Error('worker failed');},()=>true));
  assert.ok(await other.select(request,rig,1,async()=>output,()=>true),'Failure releases global slot');
});

test('cold/slow delivery reduces count and frequency, then recovers after three fast updates',async()=> {
  const controller=new InteractionController();let now=0;
  const run=async()=>{now+=200;return output;};
  const first=await controller.select(request,rig,1,run,()=>true,{clock:()=>now});
  assert.equal(first!.candidates.length,1);assert.equal(first!.degraded,true);assert.equal(controller.ready(now),false);
  now+=100;
  for(let i=0;i<3;i++) {
    const result=await controller.select(request,rig,1,async()=>{now+=30;return output;},()=>true,{clock:()=>now});
    assert.equal(result!.candidates.length,1);
  }
  const recovered=await controller.select(request,rig,1,async()=>output,()=>true,{clock:()=>now});
  assert.equal(recovered!.candidates.length,2);
});

test('all-rejected batches back off instead of scheduling a new pair every render frame',async()=> {
  const controller=new InteractionController(), bad=new Float32Array(data);
  for(let f=0;f<64;f++) bad[f*366]=10;
  const result=await controller.select(request,rig,1,async()=>({...output,data:bad}),()=>true,{clock:()=>100});
  assert.equal(result!.selected,undefined);
  assert.equal(result!.candidates.length,2);
  assert.equal(controller.ready(399),false);assert.equal(controller.ready(400),true);
});

test('raw tracking follows the forecast trajectory rather than demanding the half-second endpoint immediately',()=> {
  const response=new InteractionResponse(stance);
  response.begin('Hips',stance.root,undefined,0);
  response.control!.velocity.set(.1,0,0);
  const request=response.request(1),encoded=encodeProposal(request,rig,1,0);
  const raw=Array.from({length:18},(_,i)=>{const p=clonePose(stance);p.root.x+=.1*i/30;return p;});
  assert.ok(proposalQuality(raw,request,rig,encoded).tracking<1e-7);
  assert.ok(proposalQuality(raw,request,rig,encoded).activity<1e-7,'Rigid translation earns no local-response credit');
  for(const p of raw) p.rotations[17].premultiply(new Quaternion().setFromAxisAngle(new Vector3(0,0,1),.03));
  assert.ok(proposalQuality(raw,request,rig,encoded).activity>.001,'Pelvis control leaves opposite arm local motion model-owned');
});
