import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Bone, Group, Quaternion, Vector3 } from 'three';
import { loadAmmoNode } from 'mmd-gltf/packages/three-mmd-physics/node';
import { PhysicsWorld } from 'mmd-gltf/packages/three-mmd-physics';
import { BACKEND_SHA256 } from 'mmd-gltf/packages/three-mmd-physics/ammo';
import { CharacterSelection } from '../src/characters.ts';
import { SomaRetargeter, UKA_MAPPING } from '../src/retarget.ts';
import { LiveMMDPhysics, ukaPhysicsModel } from '../src/mmd-physics.ts';
import { clonePose, JOINTS } from '../src/motion.ts';
import { glbJSON, somaFixture, ukaFixture } from './mmd-fixture.ts';

test('converted Uka retains skin, source identity, morphs, toon, outline and actual MMD bodies/joints', () => {
  const bytes = readFileSync(new URL('../public/assets/uka/model.glb',import.meta.url));
  const record = JSON.parse(readFileSync(new URL('../public/assets/uka/conversion.json',import.meta.url),'utf8'));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),record.sha256);
  const json = glbJSON('../public/assets/uka/model.glb');
  assert.equal(json.skins[0].joints.length,302);
  assert.equal(json.extensions.MMD_physics.bodies.length,164);
  assert.equal(json.extensions.MMD_physics.joints.length,151);
  assert.ok(json.meshes.some((m: any) => m.primitives.some((p: any) => p.targets.length >= 184)));
  for (const e of ['MMD_materials_toon','MMD_materials_outline']) assert.ok(json.materials.some((m: any) => m.extensions?.[e]));
  assert.ok(json.skins[0].joints.every((i: number) => Number.isInteger(json.nodes[i].extras.pmxBone.index)));
  assert.equal(json.extras.mmdSource,undefined,'Do not embed the source PMX in the deployed GLB');
  assert.ok(json.images.every((i: any) => i.bufferView !== undefined),'All textures must be embedded');
  assert.match(json.extras.attribution,/Nagoya Institute of Technology/);
  for (const file of record.files.filter((f: {path: string}) => f.path.endsWith('.md'))) {
    const notice = readFileSync(new URL(`../public/assets/uka/${file.path}`,import.meta.url));
    assert.equal(createHash('sha256').update(notice).digest('hex'),file.sha256,'Keep original notices byte-for-byte');
  }
  assert.equal(createHash('sha256').update(readFileSync(new URL('../public/runtime/ammo.js',import.meta.url))).digest('hex'),BACKEND_SHA256);
});

test('retargeting handles different world bind axes, intermediary parents, root scale and previous solver writes', () => {
  const root = new Group(), center = new Bone(), hips = new Bone(), extra = new Bone(), arm = new Bone(), end = new Bone();
  root.add(center); center.add(hips); hips.add(extra); extra.add(arm); arm.add(end);
  for (const [bone,name] of [[center,'center'],[hips,'hips'],[arm,'arm'],[end,'end']] as const) bone.userData.pmxBone = {name};
  hips.position.y = 2; extra.rotation.y = 0.6;
  arm.rotation.z = -0.4; end.position.set(1,0,0); root.updateMatrixWorld(true);
  const bind = {root:new Vector3(0,1,0),rotations:JOINTS.map(() => new Quaternion())};
  const points = JOINTS.map(() => new Vector3()); points[12].set(1,0,0);
  const target = new SomaRetargeter(root,bind,points,[{source:'Hips',target:'hips'},
    {source:'LeftArm',target:'arm',sourceEnd:'LeftForeArm',targetEnd:'end'}],'center','hips');
  target.apply(bind);
  const direction = end.getWorldPosition(new Vector3()).sub(arm.getWorldPosition(new Vector3())).normalize();
  assert.ok(direction.distanceTo(new Vector3(1,0,0)) < 1e-7);
  const pose = clonePose(bind); pose.root.set(10,1.2,-3);
  const turn = new Quaternion().setFromAxisAngle(new Vector3(0,1,0),Math.PI/2);
  pose.rotations = pose.rotations.map(q => turn.clone().multiply(q));
  arm.position.y = 90; target.apply(pose);
  assert.ok(hips.getWorldPosition(new Vector3()).distanceTo(new Vector3(10,2.4,-3)) < 1e-7);
  assert.ok(end.getWorldPosition(new Vector3()).sub(arm.getWorldPosition(new Vector3())).normalize()
    .distanceTo(new Vector3(0,0,-1)) < 1e-7);
  target.apply(bind); assert.ok(hips.getWorldPosition(new Vector3()).distanceTo(new Vector3(0,2,0)) < 1e-7);
});

test('Uka mapping is complete, direct bones are not physics writers, and incremental physics releases native handles', async () => {
  const {root,json} = await ukaFixture(), soma = somaFixture();
  const retarget = new SomaRetargeter(root,soma.bind,soma.points);
  const model = ukaPhysicsModel(root), driven = new Set(UKA_MAPPING.map(b => b.target));
  assert.equal(UKA_MAPPING.length,22);
  assert.ok(model.profile.bodies.filter(b => b.mode !== 0 && b.bone >= 0)
    .every(b => !driven.has(model.solver.bones.find(s => s.index === b.bone)!.name)));
  assert.equal(model.controls.size,10);
  assert.equal([...model.controls.values()].filter(Boolean).length,6,'Only sleeve IK is enabled');
  assert.equal(json.extensions.MMD_skeleton_solver.bones.filter((b: any) => b.fixedAxis).length,4,'Source constraints are preserved');
  const {api} = await loadAmmoNode(), initialAllocations = PhysicsWorld.allocations;
  const physics = new LiveMMDPhysics(root,api);
  for (let i=0;i<90;i++) {
    const pose = clonePose(soma.stance); pose.root.x = Math.sin(i/15)*0.15;
    retarget.apply(pose); physics.update(1/60);
  }
  assert.equal(physics.steps,180);
  assert.ok(physics.maximumSecondaryAngle > 0.02,'Rigid-body simulation must move secondary bones');
  assert.ok(PhysicsWorld.allocations > initialAllocations);
  root.traverse(o => assert.ok([...o.position.toArray(),...o.quaternion.toArray()].every(Number.isFinite)));
  const allocations = PhysicsWorld.allocations;
  retarget.apply(soma.stance); physics.update(0.5);
  assert.equal(physics.steps,186,'Catch-up must be capped at six fixed ticks');
  assert.equal(PhysicsWorld.allocations,allocations,'Live stepping must reuse the existing Bullet world');
  physics.reset(); assert.equal(PhysicsWorld.allocations,initialAllocations);
  retarget.apply(soma.stance); physics.update(1/60); physics.dispose(); physics.dispose();
  assert.equal(PhysicsWorld.allocations,initialAllocations);
});

test('character selection disposes stale loads, tolerates stale failures and can retry a failed load', async () => {
  let disposed = 0, resets = 0;
  const resource = () => ({reset:() => resets++,dispose:() => disposed++});
  const selected: unknown[] = [], controller = new CharacterSelection(selected.push.bind(selected));
  let finish!: (value: ReturnType<typeof resource>) => void;
  const loading = controller.select(() => new Promise(resolve => {finish = resolve;}));
  await controller.select(); finish(resource()); assert.equal(await loading,false);
  assert.equal(disposed,1); assert.equal(controller.current,undefined);
  await assert.rejects(controller.select(async () => {throw new Error('missing GLB');}),/missing GLB/);
  await controller.select(async () => resource()); assert.equal(resets,1);
  controller.dispose(); assert.equal(disposed,2);
  let reject!: (error: Error) => void;
  const old = controller.select(() => new Promise((_r,r) => {reject = r;}));
  await controller.select(); reject(new Error('obsolete')); assert.equal(await old,false);
});
