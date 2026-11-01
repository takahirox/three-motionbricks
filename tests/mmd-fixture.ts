import { readFileSync } from 'node:fs';
import { Bone, Group, Quaternion, Vector3 } from 'three';
import { MMDPhysicsPlugin } from 'mmd-gltf/packages/three-mmd-physics';
import { JOINTS, type Pose } from '../src/motion.ts';

export function glbJSON(path: string) {
  const bytes = readFileSync(new URL(path, import.meta.url));
  return JSON.parse(bytes.subarray(20, 20+bytes.readUInt32LE(12)).toString());
}
/** Read actual retained glTF joint TRS without decoding textures/rendering. */
export function skeleton(json: any) {
  const joints = new Set<number>(json.skins.flatMap((s: any) => s.joints));
  const nodes = json.nodes.map((n: any,i: number) => {
    const o = joints.has(i) ? new Bone() : new Group(); o.name = n.name ?? '';
    if (n.matrix) {o.matrix.fromArray(n.matrix); o.matrix.decompose(o.position,o.quaternion,o.scale);}
    if (n.translation) o.position.fromArray(n.translation);
    if (n.rotation) o.quaternion.fromArray(n.rotation);
    if (n.scale) o.scale.fromArray(n.scale);
    o.userData = n.extras ?? {}; return o;
  });
  json.nodes.forEach((n: any,i: number) => n.children?.forEach((j: number) => nodes[i].add(nodes[j])));
  const root = new Group(); for (const i of json.scenes[json.scene ?? 0].nodes) root.add(nodes[i]);
  root.updateMatrixWorld(true); return {root,nodes};
}
export function somaFixture() {
  const {root} = skeleton(glbJSON('../public/assets/soma.glb'));
  const bones = JOINTS.map(n => root.getObjectByName(n)!);
  const points = bones.map(b => b.getWorldPosition(new Vector3()));
  const bind: Pose = {root:points[0].clone(),rotations:bones.map(b => b.getWorldQuaternion(new Quaternion()))};
  // Match the existing runtime's original authored relaxed seed.
  for (const [index,angle] of [[11,-1.35],[17,1.35]]) {
    const desired = new Quaternion().setFromAxisAngle(new Vector3(0,0,1),angle).multiply(bind.rotations[index]);
    bones[index].quaternion.copy(bones[index].parent!.getWorldQuaternion(new Quaternion()).invert()).multiply(desired);
    root.updateMatrixWorld(true);
  }
  const stance = {root:bind.root.clone(),rotations:bones.map(b => b.getWorldQuaternion(new Quaternion()))};
  const standingPoints = bones.map(b => b.getWorldPosition(new Vector3()));
  const parents = bones.map(b => {let p = b.parent; while(p && !bones.includes(p)) p=p.parent; return bones.indexOf(p!);});
  const offsets = standingPoints.map((p,i) => parents[i]<0 ? new Vector3() : p.clone().sub(standingPoints[parents[i]])
    .applyQuaternion(stance.rotations[parents[i]].clone().invert()));
  return {bind,points,stance,rig:{parents,offsets}};
}
export async function ukaFixture() {
  return mmdFixture(glbJSON('../public/assets/uka/model.glb'));
}
export async function mmdFixture(json: any) {
  const {root,nodes} = skeleton(json);
  const parser = {json,getDependency: async (_kind: string,index: number) => nodes[index]};
  const plugin = new MMDPhysicsPlugin(parser as any); plugin.beforeRoot();
  await plugin.afterRoot({scene:root} as any);
  return {root,json};
}
