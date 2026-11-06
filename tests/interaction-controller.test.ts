import test from 'node:test';
import assert from 'node:assert/strict';
import { Quaternion, Vector3 } from 'three';
import { InteractionController, encodeProposal, proposalQuality, responseCredit } from '../src/interaction-controller.ts';
import { InteractionResponse } from '../src/interaction.ts';
import { clonePose, positions } from '../src/motion.ts';
import { rotateBranch } from '../src/pose-ik.ts';
import { somaFixture } from './mmd-fixture.ts';
const {stance,rig}=somaFixture();
const response=new InteractionResponse(stance);
response.begin('LeftHand',positions(stance,rig)[13],undefined,0);
const request=response.request(1);
// Deterministic tensor fixture for scheduler tests only; never model evidence.
const data=new Float32Array(64*366), placement=encodeProposal(request,rig,1,0).placement;
const inverse=placement.rotation.clone().invert();
for(let f=0;f<64;f++) {
  data.set(stance.root.clone().sub(placement.origin).applyQuaternion(inverse).toArray(),f*366);
  for(let j=0;j<30;j++) {
    const q=inverse.clone().multiply(stance.rotations[j]);
    data.set([...new Vector3(1,0,0).applyQuaternion(q).toArray(),...new Vector3(0,1,0).applyQuaternion(q).toArray()],f*366+92+j*6);
  }
}
const output={data,tokens:6,milliseconds:20};

test('matched neutral proposal preserves history and full-frame masks without mutating control',()=> {
  const before=response.request(1), a=encodeProposal(request,rig,1,0), b=encodeProposal(request,rig,1,1);
  assert.deepEqual(response.request(1),before);
  const neutral=encodeProposal({...request,control:undefined,controls:[]},rig,1,0);
  assert.deepEqual(b.features,neutral.features);
  assert.deepEqual([...b.features.has_local_poses],[1,1,1,1,1,1,1,1]);
  assert.deepEqual(b.features.local_poses.slice(0,4*267),a.features.local_poses.slice(0,4*267));
  assert.throws(()=>encodeProposal(request,rig,1,3));
});

test('matched neutral future removes hand and pelvis control features but retains identical observation history',()=> {
  for(const joint of ['LeftHand','Hips'] as const) {
    const control=new InteractionResponse(stance),index=joint==='Hips' ? 0 : 13;
    control.begin(joint,positions(stance,rig)[index].clone().add(new Vector3(.1,.05,0)),undefined,0);
    control.control!.velocity.set(.1,0,0);
    const req=control.request(1),a=encodeProposal(req,rig,1,0),b=encodeProposal(req,rig,1,1);
    assert.notDeepEqual(a.features.local_poses,b.features.local_poses);
    for(const [name,width] of [['local_poses',267],['global_root_values',5],['local_root_values',4]] as const)
      assert.deepEqual(a.features[name].slice(0,4*width),b.features[name].slice(0,4*width));
    assert.deepEqual(b.features,encodeProposal({...req,control:undefined,controls:[]},rig,1,0).features);
  }
});

test('raw selection penalizes rigid heading/root and never rewards unrelated arm activity',()=> {
  const encoded=encodeProposal(request,rig,1,0);
  const still=Array.from({length:18},()=>clonePose(stance));
  const turned=still.map(p=> {
    const c=clonePose(p);rotateBranch(c,rig,0,new Quaternion().setFromAxisAngle(new Vector3(0,1,0),1));return c;
  });
  assert.match(proposalQuality(turned,request,rig,encoded).problem!,/heading/);
  for(const r of [.03,.3,1]) {
    const activity=still.map(p=> {const c=clonePose(p);rotateBranch(c,rig,17,new Quaternion().setFromAxisAngle(new Vector3(0,0,1),r));return c;});
    const small=proposalQuality(activity,request,rig,encoded,still), neutral=proposalQuality(still,request,rig,encoded,still);
    assert.equal(small.response,0);
    assert.equal(small.score,neutral.score,'Opposite-arm activity cannot improve an otherwise identical score');
  }
  const shifted=still.map(p=> {const c=clonePose(p);c.root.x+=.5;return c;});
  assert.match(proposalQuality(shifted,request,rig,encoded).problem!,/root/);
});

test('response credit requires matched evidence and directional trajectory help from model-owned DOFs',()=> {
  const base=Array.from({length:18},()=>clonePose(stance)), helpful=base.map(p=> {
    const c=clonePose(p);rotateBranch(c,rig,3,new Quaternion().setFromAxisAngle(new Vector3(0,0,1),.06));return c;
  });
  const target=positions(helpful[0],rig)[13];
  const control=new InteractionResponse(stance);control.begin('LeftHand',target,undefined,0);
  const req=control.request(1), encoded=encodeProposal(req,rig,1,0);
  const credit=responseCredit(helpful,base,req,rig,encoded);
  assert.ok(credit>0 && credit<=.04,'Chest motion helps the imposed reach without direct-chain credit');
  assert.equal(proposalQuality(helpful,req,rig,encoded).response,0,'No actual paired baseline means no credit');
  assert.equal(responseCredit(helpful,helpful,req,rig,encoded),0,'Shared no-drag activity earns no credit');
  control.begin('LeftHand',positions(stance,rig)[13].clone().multiplyScalar(2).sub(target),undefined,0);
  const reversed=control.request(1);
  assert.equal(responseCredit(helpful,base,reversed,rig,encodeProposal(reversed,rig,1,0)),0,'Same motion cannot help reversed demand');
  const chain=base.map(p=> {const c=clonePose(p);rotateBranch(c,rig,11,new Quaternion().setFromAxisAngle(new Vector3(0,0,1),.06));return c;});
  assert.equal(responseCredit(chain,base,req,rig,encoded),0,'Direct IK chain cannot earn generated response credit');
  assert.equal(responseCredit(helpful,base,request,rig,encodeProposal(request,rig,1,0)),0,'No imposed displacement cannot reward unrelated motion');
  const movingRoot=base.map(p=>{const c=clonePose(p);c.root.addScalar(.03);return c;});
  assert.equal(responseCredit(movingRoot,base,req,rig,encoded),0,'Root translation cannot masquerade as response');
});

test('rotation assistance depends on imposed orientation and excludes rigid turning',()=> {
  const base=Array.from({length:18},()=>clonePose(stance)),helpful=base.map(p=> {
    const c=clonePose(p);rotateBranch(c,rig,3,new Quaternion().setFromAxisAngle(new Vector3(0,0,1),.06));return c;
  });
  const control=new InteractionResponse(stance);
  control.begin('LeftHand',undefined,helpful[0].rotations[13],0);
  const req=control.request(1);
  assert.ok(responseCredit(helpful,base,req,rig,encodeProposal(req,rig,1,0))>0);
  const rigid=base.map(p=>{const c=clonePose(p);rotateBranch(c,rig,0,new Quaternion().setFromAxisAngle(new Vector3(0,0,1),.06));return c;});
  assert.ok(responseCredit(rigid,base,req,rig,encodeProposal(req,rig,1,0))<1e-12);
});

test('moving and overshooting baselines spend the absolute hand position/orientation residual',()=> {
  const trunk=(r:number)=>Array.from({length:18},()=> {
    const p=clonePose(stance);rotateBranch(p,rig,3,new Quaternion().setFromAxisAngle(new Vector3(0,0,1),r));return p;
  });
  const target=trunk(.06)[0];
  // Position and orientation are tested separately so one cannot hide a wrong
  // sign in the other. Both baseline motion and overshoot must be accounted for.
  for(const mode of ['position','rotation']) {
    const control=new InteractionResponse(stance);
    control.begin('LeftHand',mode==='position' ? positions(target,rig)[13] : undefined,
      mode==='rotation' ? target.rotations[13] : undefined,0);
    const req=control.request(1),encoded=encodeProposal(req,rig,1,0);
    for(const [baseline,worse] of [[.04,.12],[.09,.14],[.06,.08]]) {
      assert.equal(responseCredit(trunk(worse),trunk(baseline),req,rig,encoded),0,
        `${mode}: further motion past the target cannot earn credit (baseline ${baseline})`);
    }
    for(const baseline of [.04,.09]) assert.ok(responseCredit(trunk(.06),trunk(baseline),req,rig,encoded)>0,
      `${mode}: reaching the absolute target helps from either side`);
    const moving=Array.from({length:18},(_,i)=>trunk(.02+.002*i)[0]);
    const overshooting=Array.from({length:18},(_,i)=>trunk(.10+.002*i)[0]);
    assert.equal(responseCredit(overshooting,moving,req,rig,encoded),0,
      `${mode}: continuously moving baseline cannot make worsening overshoot helpful`);
  }
});

test('pelvis stabilization compares the remaining imposed translation and existing trunk articulation',()=> {
  const trunk=(r:number)=>Array.from({length:18},()=> {
    const p=clonePose(stance);rotateBranch(p,rig,1,new Quaternion().setFromAxisAngle(new Vector3(0,0,1),r));return p;
  });
  const neutral=positions(stance,rig),help=positions(trunk(.03)[0],rig);
  const displacement=help[3].clone().sub(neutral[3]).add(help[6].clone().sub(neutral[6])).multiplyScalar(-.5);
  const control=new InteractionResponse(stance);control.begin('Hips',stance.root.clone().add(displacement),undefined,0);
  const req=control.request(1),encoded=encodeProposal(req,rig,1,0);
  const baseline=trunk(.03);
  // The baseline already supplies the counterrotation. Repeating that demanded
  // delta overshoots, while undoing an overshoot is useful.
  assert.equal(responseCredit(trunk(.06),baseline,req,rig,encoded),0);
  assert.ok(responseCredit(baseline,trunk(.06),req,rig,encoded)>0);
  const moved=baseline.map(p=>{const c=clonePose(p);c.root.add(displacement);return c;});
  assert.equal(responseCredit(trunk(.06),moved,req,rig,encoded),0,
    'Already imposed baseline root translation must not create fresh trunk demand');
});

test('pelvis credit measures trunk stabilization rather than arm activity or imposed root travel',()=> {
  const base=Array.from({length:18},()=>clonePose(stance)), trunk=base.map(p=> {
    const c=clonePose(p);rotateBranch(c,rig,1,new Quaternion().setFromAxisAngle(new Vector3(0,0,1),.03));return c;
  });
  const displacement=positions(trunk[0],rig)[3].sub(positions(stance,rig)[3])
    .add(positions(trunk[0],rig)[6].sub(positions(stance,rig)[6])).multiplyScalar(-.5);
  const control=new InteractionResponse(stance);control.begin('Hips',stance.root.clone().add(displacement),undefined,0);
  const req=control.request(1),encoded=encodeProposal(req,rig,1,0);
  assert.ok(responseCredit(trunk,base,req,rig,encoded)>0);
  const arm=base.map(p=> {const c=clonePose(p);rotateBranch(c,rig,17,new Quaternion().setFromAxisAngle(new Vector3(0,0,1),.3));return c;});
  assert.ok(responseCredit(arm,base,req,rig,encoded)<1e-12,'Unrelated arm earns no credit beyond numerical reconstruction noise');
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
  assert.ok(result!.candidates.every(c=>c.quality.matchedBaseline));
  const trajectory=encodeProposal(request,rig,1,0);
  for(const c of result!.candidates) assert.deepEqual(c.quality,proposalQuality(c.segment,request,rig,trajectory,result!.candidates[1].segment),'Both candidates use the same imposed trajectory and baseline');
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
  assert.ok(result!.candidates.every(c=>!c.quality.matchedBaseline && c.quality.response===0),
    'Rejected baseline cannot grant response credit');
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
  assert.ok(proposalQuality(raw,request,rig,encoded).response<1e-7,'Rigid translation earns no local-response credit');
  assert.equal(proposalQuality(raw,request,rig,encoded).response,0,'No baseline means no reaction credit');
});
