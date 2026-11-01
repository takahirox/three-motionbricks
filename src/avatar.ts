import { Bone, Group, Quaternion, SkinnedMesh, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { JOINTS, type Pose, type Rig } from './motion';

export class SomaAvatar {
  private constructor(readonly object: Group, readonly bones: Bone[], readonly rig: Rig, readonly stance: Pose,
    readonly bind: Pose, readonly bindPoints: Vector3[]) {}
  static async load(url: string): Promise<SomaAvatar> {
    const {scene} = await new GLTFLoader().loadAsync(url);
    const byName = new Map<string, Bone>();
    let skinned = false;
    scene.traverse(object => {
      if (object instanceof Bone) byName.set(object.name, object);
      if (object instanceof SkinnedMesh) {skinned = true; object.frustumCulled = false;}
    });
    if (!skinned) throw new Error('SOMA asset has no skinned mesh. Re-run scripts/convert-soma.py.');
    const bones = JOINTS.map(name => {
      const bone = byName.get(name);
      if (!bone) throw new Error(`SOMA asset is missing ${name}.`);
      return bone;
    });
    scene.updateMatrixWorld(true);
    const bind = {root: bones[0].getWorldPosition(new Vector3()), rotations: bones.map(b => b.getWorldQuaternion(new Quaternion()))};
    const bindPoints = bones.map(b => b.getWorldPosition(new Vector3()));
    // Author a relaxed seed stance from the native T-pose, without using sample clips.
    for (const [name, angle] of [['LeftArm', -1.35], ['RightArm', 1.35]] as const) {
      const arm = byName.get(name)!;
      const desired = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), angle)
        .multiply(arm.getWorldQuaternion(new Quaternion()));
      arm.quaternion.copy(arm.parent!.getWorldQuaternion(new Quaternion()).invert()).multiply(desired);
      scene.updateMatrixWorld(true);
    }
    const points = bones.map(b => b.getWorldPosition(new Vector3()));
    const rotations = bones.map(b => b.getWorldQuaternion(new Quaternion()));
    const parents = bones.map(b => {
      let p = b.parent;
      while (p && !bones.includes(p as Bone)) p = p.parent;
      return bones.indexOf(p as Bone);
    });
    const offsets = points.map((p, i) => parents[i] < 0 ? new Vector3() : p.clone().sub(points[parents[i]])
      .applyQuaternion(rotations[parents[i]].clone().invert()));
    return new SomaAvatar(scene, bones, {parents, offsets}, {root: points[0], rotations}, bind, bindPoints);
  }
  apply(pose: Pose): void {
    for (let i = 0; i < this.bones.length; i++) {
      const bone = this.bones[i], parent = bone.parent!;
      parent.updateWorldMatrix(true, false);
      if (i === 0) bone.position.copy(parent.worldToLocal(pose.root.clone()));
      bone.quaternion.copy(parent.getWorldQuaternion(new Quaternion()).invert()).multiply(pose.rotations[i]);
      bone.updateMatrixWorld(true);
    }
  }
}
