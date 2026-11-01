import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Quaternion, Vector3 } from 'three';
import { loadAmmoNode } from 'mmd-gltf/packages/three-mmd-physics/node';
import { PhysicsWorld } from 'mmd-gltf/packages/three-mmd-physics';
import { parseAnimasa, convertAnimasa, sha256 } from '../scripts/animasa-converter';
import manifest from '../scripts/animasa-manifest.json';
import { verifyAnimasaGLB, ANIMASA_GLB_SHA256, ANIMASA_GLB_BYTES } from '../src/animasa';
import { ANIMASA_MAPPING, SomaRetargeter } from '../src/retarget';
import { LiveMMDPhysics, mmdPhysicsModel } from '../src/mmd-physics';
import { mmdFixture, somaFixture } from './mmd-fixture';

test('Animasa rejects unverified sources and GLBs before parsing',async () => {
  assert.throws(()=>parseAnimasa(Buffer.from('not Animasa')),/SHA-256 mismatch/);
  await assert.rejects(verifyAnimasaGLB(new ArrayBuffer(100)),/Incorrect Animasa/);
  await assert.rejects(verifyAnimasaGLB(new ArrayBuffer(ANIMASA_GLB_BYTES)),/not the verified Animasa/);
  assert.equal(ANIMASA_MAPPING.length,20);
  assert.ok(!ANIMASA_MAPPING.some(b=>['上半身M','上半身2'].includes(b.target)));
});

// Opt-in: exact third-party source stays outside Git, npm test and Pages.
test('exact local Animasa conversion, retargeting and Bullet integration', {skip:!process.env.ANIMASA_SOURCE}, async () => {
  const source = resolve(process.env.ANIMASA_SOURCE!);
  const record = await convertAnimasa(source,resolve('.cache/animasa-test-a'));
  const repeat = await convertAnimasa(source,resolve('.cache/animasa-test-b'));
  for (const file of manifest.files.filter(f=>f.path.endsWith('.txt')))
    assert.equal(sha256(await readFile(resolve('.cache/animasa-test-a/notices',file.path))),file.sha256);
  assert.equal(record.sha256,repeat.sha256,'Conversion must be byte deterministic');
  assert.equal(record.sha256,ANIMASA_GLB_SHA256,'Browser must accept exactly this conversion');
  const bytes = await readFile('.cache/animasa-test-a/model.glb');
  await verifyAnimasaGLB(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
  const json = JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString());
  assert.equal(json.skins[0].joints.length,140);
  assert.equal(json.extensions.MMD_physics.bodies.length,45);
  assert.equal(json.extensions.MMD_physics.joints.length,27);
  assert.equal(json.extensions.MMD_skeleton_solver.bones.filter((b:any)=>b.ik).length,7);
  assert.equal(json.extensions.MMD_skeleton_solver.bones.filter((b:any)=>b.append).length,8);
  assert.equal(json.extras.pmdPhysics.bodies.filter((b:any)=>b.rotationDamping>1).length,6);
  assert.ok(json.images.every((i:any)=>i.bufferView !== undefined));
  assert.ok(json.materials.every((m:any)=>m.extensions.MMD_materials_toon));
  assert.ok(json.materials.some((m:any)=>m.extensions.MMD_materials_outline));
  assert.equal(json.meshes[0].primitives[0].targets.length,30);
  assert.equal(json.animations,undefined,'No VMD or prerecorded animation');
  const model = parseAnimasa(await readFile(resolve(source,'miku/miku_v2.pmd')));
  const binaryStart = 28 + bytes.readUInt32LE(12);
  const component = (view:number,offset:number,type:number) => {
    const at = binaryStart + (json.bufferViews[view].byteOffset ?? 0) + offset;
    return type === 5126 ? bytes.readFloatLE(at) : type === 5125 ? bytes.readUInt32LE(at)
      : type === 5123 ? bytes.readUInt16LE(at) : bytes.readUInt8(at);
  };
  const attribute = (index:number,width:number) => {
    const a = json.accessors[index], size = {5126:4,5125:4,5123:2,5121:1}[a.componentType as 5126] ?? 1;
    const result = new Array(a.count*width).fill(0);
    if (a.bufferView !== undefined) for(let i=0;i<result.length;i++) {
      const stride = json.bufferViews[a.bufferView].byteStride ?? width*size;
      result[i]=component(a.bufferView,(a.byteOffset ?? 0)+Math.floor(i/width)*stride+(i%width)*size,a.componentType);
    }
    if (a.sparse) for(let i=0;i<a.sparse.count;i++) {
      const s=a.sparse, step=s.indices.componentType===5125?4:s.indices.componentType===5123?2:1;
      const vertex=component(s.indices.bufferView,(s.indices.byteOffset ?? 0)+i*step,s.indices.componentType);
      for(let k=0;k<width;k++) result[vertex*width+k]=component(s.values.bufferView,(s.values.byteOffset ?? 0)+(i*width+k)*size,a.componentType);
    }
    return result;
  };
  const primitive = json.meshes[0].primitives[0];
  const weights = attribute(primitive.attributes.WEIGHTS_0,4), indices = attribute(primitive.attributes.JOINTS_0,4);
  for(let i=0;i<model.vertices.length;i++) {
    const expected = new Map<number,number>();
    model.vertices[i].skinIndices!.forEach((joint,k)=>expected.set(joint,(expected.get(joint) ?? 0)+model.vertices[i].skinWeights![k]));
    const actual = new Map<number,number>();
    for(let k=0;k<4;k++) if(weights[i*4+k]) actual.set(indices[i*4+k],weights[i*4+k]);
    for(const [joint,weight] of expected) assert.ok(Math.abs(weight-(actual.get(joint) ?? 0))<1e-6);
  }
  const deltas = attribute(primitive.targets[0].POSITION,3);
  for(const e of model.morphs[0].elements) for(let k=0;k<3;k++)
    assert.ok(Math.abs(deltas[e.index*3+k]-e.position![k]*0.08)<1e-7,'PMD base-table morph indices must become actual vertex indices');
  const physicsBodies = json.extensions.MMD_physics.bodies;
  const originalBodies = json.extras.pmdPhysics.bodies;
  // Check the emitted inclusion masks against untouched PMD records, rather
  // than the PMX adapter (which must use the opposite bit convention).
  assert.equal(originalBodies.find((b:any)=>b.name==='頭').groupTarget,65535);
  assert.equal(originalBodies.find((b:any)=>b.name==='右髪1').groupTarget,65527);
  originalBodies.forEach((body:any,i:number) => {
    assert.equal(physicsBodies[i].group,body.groupIndex,body.name);
    assert.equal(physicsBodies[i].mask,body.groupTarget,`${body.name}: preserve historical PMD collision inclusion mask`);
  });
  model.rigidBodies.forEach((value:any,i:number) => {
    const base = value.boneIndex < 0 ? [0,0,0] : model.bones[value.boneIndex].position;
    for(let k=0;k<3;k++) assert.ok(Math.abs(physicsBodies[i].translation[k]-(value.position[k]-base[k])*0.08)<1e-7,'PMD body offsets must not be treated as PMX absolute positions');
  });
  for (const i of json.skins[0].joints) {
    const n = json.nodes[i], original = model.bones[n.extras.pmxBone.index];
    assert.equal(n.extras.pmdBone.name,original.name);
    assert.equal(n.extras.pmdBone.parentIndex,original.parentIndex);
  }
  const {root} = await mmdFixture(json), soma = somaFixture();
  const retarget = new SomaRetargeter(root,soma.bind,soma.points,ANIMASA_MAPPING);
  const physicsModel = mmdPhysicsModel(root,false,true);
  assert.equal(physicsModel.controls.size,4);
  assert.ok([...physicsModel.controls.values()].every(v=>!v));
  const dynamic = new Set(physicsModel.profile.bodies.filter(b=>b.mode!==0 && b.bone>=0).map(b=>physicsModel.solver.bones[b.bone].name));
  assert.ok(ANIMASA_MAPPING.every(b=>!dynamic.has(b.target)));
  assert.equal(physicsModel.solver.bones.filter(b=>b.append).length,8,'Keep eye and twist grants active');
  const {api} = await loadAmmoNode(), initial = PhysicsWorld.allocations;
  const physics = new LiveMMDPhysics(root,api,false,true);
  const secondary = {hair:0,skirt:0};
  for(let i=0;i<120;i++) {
    const pose = {root:soma.stance.root.clone().add(new Vector3(Math.sin(i/15)*0.2,0,0)),
      rotations:soma.stance.rotations.map(q=>new Quaternion().setFromAxisAngle(new Vector3(0,1,0),i/100).multiply(q))};
    retarget.apply(pose);
    const raw = new Map([...retarget.byName].map(([name,b])=>[name,b.quaternion.clone()]));
    physics.update(1/60);
    for(const [name,bone] of retarget.byName) {
      const angle = bone.quaternion.angleTo(raw.get(name)!);
      if(name.includes('髪')) secondary.hair = Math.max(secondary.hair,angle);
      if(name.includes('ｽｶｰﾄ')) secondary.skirt = Math.max(secondary.skirt,angle);
      assert.ok([...bone.position.toArray(),...bone.quaternion.toArray()].every(Number.isFinite));
    }
  }
  assert.equal(physics.steps,240);
  assert.ok(secondary.hair>0.02 && secondary.skirt>0.02,JSON.stringify(secondary));
  physics.dispose(); assert.equal(PhysicsWorld.allocations,initial);
  retarget.apply(soma.stance); physics.update(1/60,false);
  assert.equal(PhysicsWorld.allocations,initial);
  physics.dispose();
});
