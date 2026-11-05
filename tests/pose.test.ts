import test from 'node:test';
import assert from 'node:assert/strict';
import { Quaternion, Vector3 } from 'three';
import { clonePose, encode, JOINTS, positions, type Pose } from '../src/motion.ts';
import { EFFECTORS, jointIndex, PoseIK } from '../src/pose-ik.ts';
import { boundedCorrection, poseTargets, PoseResponse, responseProblem } from '../src/pose-response.ts';
import { SomaRetargeter, ANIMASA_MAPPING, UKA_MAPPING } from '../src/retarget.ts';
import { glbJSON, mmdFixture, somaFixture } from './mmd-fixture.ts';

const {stance,rig,bind,points} = somaFixture(), ik = new PoseIK(rig,stance);
const near = (a: number, b: number, epsilon = 1e-6) => assert.ok(Math.abs(a-b) < epsilon,`${a} != ${b}`);
function connected(pose: Pose) {
  const p = positions(pose,rig);
  assert.ok(pose.root.toArray().every(Number.isFinite));
  for (let j=0;j<30;j++) {
    assert.ok(pose.rotations[j].toArray().every(Number.isFinite)); near(pose.rotations[j].length(),1);
    if (rig.parents[j] >= 0) near(p[j].distanceTo(p[rig.parents[j]]),rig.offsets[j].length());
  }
}

test('hand reaches with connected shoulder/torso follow; foot follows pelvis with grounded opposite support', () => {
  const p = positions(stance,rig), target = p[13].clone().add(new Vector3(0.12,0.3,-0.25));
  const reached = ik.solve(stance,{joint:'LeftHand',target}); connected(reached);
  assert.ok(positions(reached,rig)[13].distanceTo(target) < 0.01);
  for (const j of [1,3,10,11,12]) assert.ok(reached.rotations[j].angleTo(stance.rotations[j]) > 0.01,JOINTS[j]);
  const footTarget = p[24].clone().add(new Vector3(0,0.12,-0.25));
  const stepped = ik.solve(stance,{joint:'LeftFoot',target:footTarget},[{joint:'RightFoot',target:p[28]}]); connected(stepped);
  assert.ok(stepped.root.distanceTo(stance.root) > 0.03);
  assert.ok(positions(stepped,rig)[24].distanceTo(footTarget) < 0.02);
  assert.ok(positions(stepped,rig)[28].distanceTo(p[28]) < 0.01);
  // Pure canonical root movement translates every joint coherently.
  const rootTarget = stance.root.clone().add(new Vector3(1,0.2,-0.4));
  const moved = ik.solve(stance,{joint:'Hips',target:rootTarget});
  positions(moved,rig).forEach((v,j)=>near(v.clone().sub(p[j]).distanceTo(rootTarget.clone().sub(stance.root)),0));
});

test('unreachable/repeated goals retain lengths, local cone limits and signed elbow/knee hinges', () => {
  let pose = clonePose(stance);
  for (let n=0;n<12;n++) {
    const joint = EFFECTORS[n%5];
    pose = ik.solve(pose,{joint,target:new Vector3(Math.sin(n)*5,0.1+Math.abs(Math.cos(n))*5,-4)});
    connected(pose);
  }
  for (const [j,min,max] of [[12,-2.7,0],[18,-2.7,0],[23,0,2.65],[27,0,2.65]]) {
    const parent = rig.parents[j], local = pose.rotations[parent].clone().invert().multiply(pose.rotations[j]);
    const restLocal = stance.rotations[parent].clone().invert().multiply(stance.rotations[j]);
    const delta = local.multiply(restLocal.invert());
    const axis = points[22].clone().sub(points[26]).normalize().applyQuaternion(stance.rotations[parent].clone().invert());
    if(delta.w < 0) delta.set(-delta.x,-delta.y,-delta.z,-delta.w);
    const angle = 2*Math.atan2(new Vector3(delta.x,delta.y,delta.z).dot(axis),delta.w);
    assert.ok(angle >= min-1e-6 && angle <= max+1e-6,`${JOINTS[j]} ${angle}`);
    assert.ok(new Vector3(delta.x,delta.y,delta.z).cross(axis).length() < 1e-6,'hinge has no swing');
  }
  for (const [j,max] of [[1,0.3],[2,0.3],[3,0.4],[10,0.6],[22,1.9]]) {
    const p = rig.parents[j];
    const q = pose.rotations[p].clone().invert().multiply(pose.rotations[j]);
    const rest = stance.rotations[p].clone().invert().multiply(stance.rotations[j]);
    assert.ok(q.angleTo(rest) <= max+1e-6);
  }
  const invalid = ik.solve(stance,{joint:'Head',target:new Vector3(NaN,0,0)});
  near(invalid.root.distanceTo(stance.root),0); connected(invalid);
});

test('rotation affects the selected branch within limits; no mutation or detached descendants', () => {
  const pose = ik.rotate(stance,'LeftHand',new Quaternion().setFromAxisAngle(new Vector3(0,1,0),2.5)); connected(pose);
  near(pose.rotations[13].angleTo(stance.rotations[13]),1.2);
  near(pose.rotations[14].angleTo(stance.rotations[14]),1.2);
  near(pose.rotations[19].angleTo(stance.rotations[19]),0);
  near(positions(pose,rig)[13].distanceTo(positions(stance,rig)[13]),0);
});

test('pose conditioning supplies four recent poses, four feasible targets and seven finite SOMA tensors', () => {
  const response = new PoseResponse(stance), goal = ik.solve(stance,{joint:'LeftHand',target:positions(stance,rig)[13].add(new Vector3(0.1,0.2,-0.2))});
  response.advance(1/30,false); response.edit(goal,100); response.advance(1/30,false);
  // Coalescing/latency retains the observed approach, even after holding the
  // new IK goal for longer than four history frames.
  response.advance(0.3,false);
  const request = response.request(0.8), targets = poseTargets(stance,goal,0.8);
  assert.equal(request.context.length,4); assert.equal(request.targets.length,4);
  assert.ok(request.context[3].rotations[11].angleTo(stance.rotations[11]) < 1e-6);
  assert.ok(request.context[0].rotations[11].angleTo(stance.rotations[11]) < 1e-6);
  for (const target of targets) connected(target);
  assert.ok(targets[3].rotations[11].angleTo(goal.rotations[11]) < targets[0].rotations[11].angleTo(goal.rotations[11]));
  const {features} = encode(request.context,request.targets,rig);
  assert.deepEqual(Object.values(features).map(v=>v.length),[40,32,2136,8,8,8,11]);
  for(const values of Object.values(features)) assert.ok(values.every(Number.isFinite));
});

test('rapid edits coalesce, delayed results cancel across reset/switch/pause and generated seams/underruns hold', () => {
  const response = new PoseResponse(stance), old = response.request(1);
  const moved = clonePose(stance); moved.root.x += 0.1;
  response.edit(moved,100); response.edit(moved,150);
  assert.equal(response.ready(329),false); assert.equal(response.ready(330),true);
  const segment = Array.from({length:20},(_,i)=>{const p=clonePose(stance);p.root.x=1+i/30;return p;});
  assert.equal(response.accept(segment,old.revision),false);
  assert.equal(response.generations,0); assert.equal(response.discarded,1);
  const request = response.request(1); assert.equal(response.accept(segment,request.revision),true);
  near(response.pose.root.distanceTo(moved.root),0); response.advance(0,true);
  near(response.pose.root.distanceTo(moved.root),0); response.advance(0.1,true);
  assert.ok(response.pose.root.x > moved.root.x);
  const paused = clonePose(response.pose); response.edit(paused,400);
  response.advance(1,false); near(response.pose.root.distanceTo(paused.root),0);
  assert.equal(response.accept(segment,request.revision),false);
  response.reset(stance,500); const fresh = response.request(1);
  assert.ok(fresh.context.every(p=>p.root.distanceTo(stance.root)===0));
  response.accept(segment,fresh.revision); response.advance(1,true); const end = clonePose(response.pose);
  response.advance(1,true); near(response.pose.root.distanceTo(end.root),0);
});

test('poor generated responses expose a reason while normal standing responses remain usable', () => {
  assert.equal(responseProblem([stance,stance],rig),undefined);
  const collapsed = clonePose(stance); collapsed.root.y = 0.1;
  assert.match(responseProblem([collapsed],rig)!,/standing/);
  const teleport = clonePose(stance); teleport.root.x = 1;
  assert.match(responseProblem([stance,teleport],rig)!,/one frame/);
});

test('post-generation corrections have angular/root bounds and preserve unrelated generated motion', () => {
  const generated = clonePose(stance), corrected = ik.rotate(generated,'LeftHand',new Quaternion().setFromAxisAngle(new Vector3(0,1,0),1.2));
  generated.rotations[24].setFromAxisAngle(new Vector3(1,0,0),0.1);
  corrected.rotations[24].copy(generated.rotations[24]);
  corrected.root.x += 0.3;
  const result = boundedCorrection(generated,corrected);
  assert.ok(result.root.distanceTo(generated.root)<=0.08+1e-6);
  for(let j=0;j<30;j++) assert.ok(result.rotations[j].angleTo(generated.rotations[j])<=1+1e-6);
  near(result.rotations[24].angleTo(generated.rotations[24]),0);
  connected(result);
});

test('all visible effectors map to canonical joints on both MMD rigs; authority preserves secondary transforms', async () => {
  for (const [path,mapping] of [['animasa',ANIMASA_MAPPING],['uka',UKA_MAPPING]] as const) {
    const {root} = await mmdFixture(glbJSON(`../public/assets/${path}/model.glb`));
    const retarget = new SomaRetargeter(root,bind,points,mapping);
    retarget.apply(stance);
    for (const name of EFFECTORS) {
      const handle = retarget.handle(name); assert.ok(handle?.toArray().every(Number.isFinite),name);
      assert.ok(mapping.some(m=>m.source===name)); assert.ok(jointIndex(name)<30);
    }
    const handBinding = mapping.find(m=>m.source==='LeftHand')!, hand = retarget.byName.get(handBinding.target)!;
    const previous = hand.quaternion.clone(), restore = retarget.captureDrivingPose();
    const secondary = [...retarget.byName.values()].find(b=>!mapping.some(m=>retarget.byName.get(m.target)===b))!;
    secondary.quaternion.setFromAxisAngle(new Vector3(0,1,0),0.4);
    const simulated = secondary.quaternion.clone(); hand.quaternion.identity(); restore();
    near(hand.quaternion.angleTo(previous),0); near(secondary.quaternion.angleTo(simulated),0);
    retarget.apply(stance);
    const moved = clonePose(stance); moved.root.add(new Vector3(0.2,0,-0.1));
    const start = retarget.handle('Hips')!; retarget.apply(moved);
    near(retarget.handle('Hips')!.sub(start).distanceTo(new Vector3(0.2,0,-0.1)),0);
  }
});
