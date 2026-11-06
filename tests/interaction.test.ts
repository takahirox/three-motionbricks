import test from 'node:test';
import assert from 'node:assert/strict';
import { Quaternion, Vector3 } from 'three';
import { clonePose, encode, positions } from '../src/motion.ts';
import { PoseIK } from '../src/pose-ik.ts';
import { encodeInteraction, InteractionResponse, jointChanges } from '../src/interaction.ts';
import { boundedCorrection } from '../src/pose-response.ts';
import { somaFixture } from './mmd-fixture.ts';
const {stance,rig}=somaFixture(), ik=new PoseIK(rig,stance);
const points=positions(stance,rig);

test('direct hand control preserves opposite arm, torso, root and leg ownership',()=> {
  const target=points[13].clone().add(new Vector3(.02,.08,-.06));
  const pose=ik.direct(stance,{joint:'LeftHand',target});
  assert.ok(positions(pose,rig)[13].distanceTo(target)<.02);
  for(const j of [0,1,2,3,4,6,16,17,18,19,22,23,24,26,27,28])
    assert.ok(stance.rotations[j].angleTo(pose.rotations[j])<1e-6,`Unowned joint ${j}`);
  assert.equal(pose.root.distanceTo(stance.root),0);
  const bounded=boundedCorrection(stance,pose,.45,.08);
  assert.ok(jointChanges(stance,bounded,rig).every(c=>c.radians<=.45+1e-6));
  // Pelvis control is explicitly imposed root motion; legs compensate instead
  // of silently calling the rigid whole-avatar translation pose editor.
  const pelvis=ik.direct(stance,{joint:'Hips',target:stance.root.clone().add(new Vector3(.06,-.03,0))},
    [{joint:'LeftFoot',target:points[24]},{joint:'RightFoot',target:points[28]}]);
  assert.ok(pelvis.root.distanceTo(stance.root)<=.08+1e-6);
  assert.ok(positions(pelvis,rig)[24].distanceTo(points[24])<.04);
  assert.ok(pelvis.rotations[22].angleTo(stance.rotations[22])>.01);
  assert.ok(pelvis.rotations[3].angleTo(stance.rotations[3])<1e-6);
});

test('sparse conditioning changes selected feature only, with frame masks and velocity/recency',()=> {
  const response=new InteractionResponse(stance);
  response.begin('LeftHand',points[13],undefined,0);
  response.update(points[13].clone().add(new Vector3(.02,.04,0)),undefined,100);
  const request=response.request(1), encoded=encodeInteraction(request,rig);
  const neutral=encode(request.context,request.targets,rig).features;
  const index=12*3;
  for(let f=0;f<8;f++) for(let k=0;k<267;k++)
    if(f<4 || k<index || k>=index+3) assert.equal(encoded.features.local_poses[f*267+k],neutral.local_poses[f*267+k]);
  assert.deepEqual(encoded.features.has_local_poses,new Int32Array(8).fill(1));
  assert.deepEqual(encodeInteraction(request,rig,1,1).features.has_local_poses,Int32Array.from([1,1,1,1,1,0,0,0]));
  assert.throws(()=>encodeInteraction(request,rig,1,0));
  const staticRequest={...request,control:{...request.control!,velocity:new Vector3()}};
  assert.notDeepEqual(encoded.features.local_poses,encodeInteraction(staticRequest,rig).features.local_poses);
  assert.deepEqual(encodeInteraction({...request,now:10000},rig).features.local_poses,encodeInteraction(staticRequest,rig).features.local_poses);
  assert.deepEqual(encodeInteraction(request,rig,0).features.local_poses,neutral.local_poses);
  const rotation=new Quaternion().setFromAxisAngle(new Vector3(0,1,0),.2);
  response.update(undefined,rotation,200);
  const rotated=encodeInteraction(response.request(1),rig).features;
  for(let f=4;f<8;f++) for(let k=0;k<267;k++)
    if(k<87+13*6 || k>=87+14*6) assert.equal(rotated.local_poses[f*267+k],neutral.local_poses[f*267+k]);
});

test('pelvis conditioning preserves other world target points and consistent root velocities',()=> {
  const response=new InteractionResponse(stance);
  response.begin('Hips',stance.root,undefined,0);
  response.update(stance.root.clone().add(new Vector3(.03,-.03,.02)),undefined,100);
  const request=response.request(1), encoded=encodeInteraction(request,rig), neutral=encode(request.context,request.targets,rig);
  for(let f=4;f<8;f++) {
    const next=f===7 ? f : f+1;
    const actual=encoded.features, original=neutral.features;
    for(let j=0;j<29;j++) for(const k of [0,2]) {
      const world=actual.local_poses[f*267+j*3+k]+actual.global_root_values[f*5+k];
      const rest=original.local_poses[f*267+j*3+k]+original.global_root_values[f*5+k];
      assert.ok(Math.abs(world-rest)<1e-6,'Unselected world position is neutral');
    }
    assert.ok(Math.abs(actual.local_root_values[f*4+1]-(actual.global_root_values[next*5]-actual.global_root_values[f*5])*30)<1e-6);
  }
});

test('enabling playback after IK-only preview retains the displayed pose, history and active control',()=> {
  for(const released of [false,true]) {
    const response=new InteractionResponse(stance);
    response.begin('LeftHand',points[13],undefined,0);
    for(let frame=1;frame<=4;frame++) {
      response.update(points[13].clone().add(new Vector3(0,frame*.03,-frame*.02)),undefined,frame*1000/30);
      response.pose=ik.direct(response.pose,{joint:'LeftHand',target:response.control!.position!});
      response.advance(1/30,false);
    }
    if(released) {response.release(140);response.advance(.4,false);}
    const preview=clonePose(response.pose), request=response.request(1), weight=response.correctionWeight;
    assert.ok(positions(preview,rig)[13].distanceTo(points[13])>.05,'Nontrivial preview edit');
    if(!released) assert.notDeepEqual(request.context[0],request.context[3],'Recent trajectory is present');
    response.reanchorPlayback();
    assert.deepEqual(response.request(1),request,'Re-anchoring preserves history, revision and control');
    assert.equal(response.correctionWeight,weight);
    // No generated segment has arrived yet. Playback must hold the preview,
    // even after released-part correction has faded away.
    response.advance(1/30,true);
    assert.ok(response.pose.root.distanceTo(preview.root)<1e-6);
    assert.ok(response.pose.rotations.every((q,j)=>q.angleTo(preview.rotations[j])<1e-6));
    assert.ok(response.accept(Array.from({length:18},()=>clonePose(stance)),request.revision));
    response.advance(0,true);
    assert.ok(positions(response.pose,rig)[13].distanceTo(positions(preview,rig)[13])<1e-6,'First ONNX seam starts at preview');
  }
});

test('settings invalidate queued and in-flight motion without ending move/rotate control',()=> {
  for(const rotate of [false,true]) {
    const response=new InteractionResponse(stance);
    response.begin('LeftHand',rotate ? undefined : points[13],rotate ? stance.rotations[13] : undefined,0);
    for(let frame=1;frame<=4;frame++) {
      const target=points[13].clone().add(new Vector3(0,frame*.02,0));
      const rotation=new Quaternion().setFromAxisAngle(new Vector3(0,1,0),frame*.05).multiply(stance.rotations[13]);
      response.update(rotate ? undefined : target,rotate ? rotation : undefined,frame*1000/30);
      response.pose=rotate ? ik.rotate(stance,'LeftHand',new Quaternion().setFromAxisAngle(new Vector3(0,1,0),frame*.05))
        : ik.direct(response.pose,{joint:'LeftHand',target});
      response.advance(1/30,false);
    }
    const segment=Array.from({length:18},()=>clonePose(stance));
    const before=response.request(1), displayed=clonePose(response.pose);
    assert.ok(response.accept(segment,before.revision));
    assert.ok(response.remaining>0);
    response.invalidatePlayback();
    const after=response.request(1);
    assert.ok(after.revision>before.revision);
    assert.deepEqual({...after,revision:before.revision},before,'Keep trajectory, timestamps and context');
    assert.equal(response.correctionWeight,1);
    assert.equal(response.remaining,0,'Discard queued motion using the old settings');
    assert.equal(response.accept(segment,before.revision),false,'Reject old in-flight output');
    response.advance(1/30,true);
    assert.ok(response.pose.root.distanceTo(displayed.root)<1e-6,'Hold the displayed root until fresh output arrives');
    assert.ok(response.pose.rotations.every((q,j)=>q.angleTo(displayed.rotations[j])<1e-6),'Hold displayed rotations');
    const nextTarget=points[13].clone().add(new Vector3(0,.1,0));
    const nextRotation=new Quaternion().setFromAxisAngle(new Vector3(0,1,0),.3).multiply(stance.rotations[13]);
    response.update(rotate ? undefined : nextTarget,rotate ? nextRotation : undefined,200);
    if(rotate) assert.ok(response.control!.rotation!.angleTo(nextRotation)<1e-6);
    else assert.deepEqual(response.control!.position,nextTarget);
    assert.ok(response.accept(segment,after.revision),'Accept output using the new settings');
    response.release(210); response.advance(.1,false);
    const releaseWeight=response.correctionWeight;
    response.invalidatePlayback();
    assert.equal(response.correctionWeight,releaseWeight,'Keep the release fade clock');
    response.advance(.3,false);
    assert.equal(response.control,undefined,'Release still completes');
  }
});

test('30 Hz displayed history replaces endpoint intent; movement/release accept in-flight motion without starvation',()=> {
  const response=new InteractionResponse(stance);
  response.begin('LeftHand',points[13],undefined,0);
  const initial=response.request(1);
  for(let frame=1;frame<=4;frame++) {
    response.update(points[13].clone().add(new Vector3(0,frame*.01,0)),undefined,frame*1000/30);
    response.pose=ik.direct(response.pose,{joint:'LeftHand',target:response.control!.position!});
    response.advance(1/30,false);
  }
  const moving=response.request(1);
  assert.equal(moving.revision,initial.revision);
  assert.equal(moving.controls.length,4);
  assert.ok(moving.context[0].rotations[11].angleTo(moving.context[3].rotations[11])>.001);
  const segment=Array.from({length:18},(_,i)=>{const p=clonePose(stance);p.root.x+=i*.001;return p;});
  response.release(140);
  assert.ok(response.accept(segment,initial.revision));
  const seam=response.pose.root.clone();response.advance(0,true);
  assert.ok(response.pose.root.distanceTo(seam)<1e-6);
  response.advance(.2,true);assert.ok(response.correctionWeight>0 && response.correctionWeight<1);
  response.advance(.2,true);assert.equal(response.control,undefined);
  assert.ok(response.pose.root.distanceTo(seam)>.001);
  response.advance(1,true);const end=clonePose(response.pose);response.advance(1,true);
  assert.equal(response.pose.root.distanceTo(end.root),0);
  response.begin('Hips',response.pose.root,undefined,1000);
  assert.equal(response.accept(segment,moving.revision),false);
  const fresh=response.request(1);response.reset(stance,1100);
  assert.equal(response.accept(segment,fresh.revision),false);
  assert.equal(response.control,undefined);
});
