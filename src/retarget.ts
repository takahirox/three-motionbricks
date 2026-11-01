import { Bone, Object3D, Quaternion, Vector3 } from 'three';
import { JOINTS, type Pose } from './motion';

export interface BoneBinding {
  source: typeof JOINTS[number]; target: string;
  /** Anatomical next joint, used to align differing T/A bind poses. */
  sourceEnd?: typeof JOINTS[number]; targetEnd?: string;
}
export const UKA_MAPPING: readonly BoneBinding[] = [
  {source:'Hips', target:'下半身'},
  {source:'Spine1', target:'上半身'}, {source:'Spine2', target:'上半身M'},
  {source:'Chest', target:'上半身2'}, {source:'Neck2', target:'首'}, {source:'Head', target:'頭'},
  ...(['Left','Right'] as const).flatMap((side, i): BoneBinding[] => {
    const s = i ? '右' : '左';
    return [
      {source:`${side}Shoulder`, target:`${s}肩`},
      {source:`${side}Arm`, target:`${s}腕`, sourceEnd:`${side}ForeArm`, targetEnd:`${s}ひじ`},
      {source:`${side}ForeArm`, target:`${s}ひじ`, sourceEnd:`${side}Hand`, targetEnd:`${s}手首`},
      {source:`${side}Hand`, target:`${s}手首`, sourceEnd:`${side}HandMiddleEnd`, targetEnd:`${s}中指１`},
      {source:`${side}Leg`, target:`${s}足`, sourceEnd:`${side}Shin`, targetEnd:`${s}ひざ`},
      {source:`${side}Shin`, target:`${s}ひざ`, sourceEnd:`${side}Foot`, targetEnd:`${s}足首`},
      {source:`${side}Foot`, target:`${s}足首`, sourceEnd:`${side}ToeBase`, targetEnd:`${s}つま先`},
      {source:`${side}ToeBase`, target:`${s}つま先`},
    ];
  }),
];

// Animasa has one upper torso bone, not Uka's three. Keep its original identity
// and transfer Chest world rotation rather than requiring nonexistent spine bones.
export const ANIMASA_MAPPING: readonly BoneBinding[] = [
  ...UKA_MAPPING.filter(b => !['上半身','上半身M','上半身2'].includes(b.target)),
  // Independent torso branches share センター; 下半身 remains the hip/root anchor.
  {source:'Chest',target:'上半身'},
];

/** World-space rotation transfer with explicit bind-axis correction. No source
 * translations except the root are copied across unlike parent hierarchies. */
export class SomaRetargeter {
  private bindings: {bone: Bone; source: number; correction: Quaternion}[];
  private rest: {bone: Bone; position: Vector3; rotation: Quaternion}[] = [];
  private center: Bone;
  private hips: Bone;
  private hipOrigin: Vector3;
  readonly heightRatio: number;
  readonly byName = new Map<string, Bone>();
  constructor(readonly object: Object3D, readonly sourceBind: Pose, sourcePoints: Vector3[],
    mapping: readonly BoneBinding[] = UKA_MAPPING, rootName = 'センター', hipsName = '下半身') {
    object.updateMatrixWorld(true);
    object.traverse(o => {
      if (!(o instanceof Bone)) return;
      const name = o.userData.pmxBone?.name;
      if (typeof name !== 'string') return;
      if (this.byName.has(name)) throw new Error(`Ambiguous MMD source bone: ${name}`);
      this.byName.set(name, o);
      this.rest.push({bone:o, position:o.position.clone(), rotation:o.quaternion.clone()});
    });
    const required = (name: string) => {
      const b = this.byName.get(name); if (!b) throw new Error(`MMD asset is missing source bone ${name}`); return b;
    };
    this.center = required(rootName); this.hips = required(hipsName);
    this.hipOrigin = this.hips.getWorldPosition(new Vector3());
    this.heightRatio = this.hipOrigin.y / sourceBind.root.y;
    if (!Number.isFinite(this.heightRatio) || this.heightRatio <= 0) throw new Error('Invalid MMD/SOMA root scale');
    this.bindings = mapping.map(m => {
      const bone = required(m.target), source = JOINTS.indexOf(m.source);
      let alignment = new Quaternion();
      if (m.sourceEnd && m.targetEnd) {
        const from = required(m.targetEnd).getWorldPosition(new Vector3()).sub(bone.getWorldPosition(new Vector3()));
        const to = sourcePoints[JOINTS.indexOf(m.sourceEnd)].clone().sub(sourcePoints[source]);
        if (from.lengthSq() < 1e-10 || to.lengthSq() < 1e-10) throw new Error(`Zero-length retarget segment ${m.target}`);
        alignment.setFromUnitVectors(from.normalize(), to.normalize());
      }
      return {bone, source, correction:sourceBind.rotations[source].clone().invert()
        .multiply(alignment).multiply(bone.getWorldQuaternion(new Quaternion()))};
    });
    // Source IDs need not be hierarchy ordered. World-to-local writes must be.
    const depth = (o: Object3D): number => o.parent ? 1 + depth(o.parent) : 0;
    this.bindings.sort((a,b) => depth(a.bone)-depth(b.bone));
  }
  apply(pose: Pose): void {
    // Clear the previous solver/physics result before writing a new driving pose.
    for (const r of this.rest) {r.bone.position.copy(r.position); r.bone.quaternion.copy(r.rotation);}
    this.object.updateMatrixWorld(true);
    for (const {bone, source, correction} of this.bindings) {
      bone.parent!.updateWorldMatrix(true, false);
      bone.quaternion.copy(bone.parent!.getWorldQuaternion(new Quaternion()).invert())
        .multiply(pose.rotations[source]).multiply(correction).normalize();
      bone.updateMatrixWorld(true);
    }
    const desired = pose.root.clone().sub(this.sourceBind.root);
    desired.y *= this.heightRatio; desired.add(this.hipOrigin);
    const delta = desired.sub(this.hips.getWorldPosition(new Vector3()));
    const centerWorld = this.center.getWorldPosition(new Vector3()).add(delta);
    this.center.position.copy(this.center.parent!.worldToLocal(centerWorld));
    this.object.updateMatrixWorld(true);
  }
}
