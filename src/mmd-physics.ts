import { Quaternion, Vector3, type Object3D } from 'three';
import { getPhysicsModel, PhysicsWorld } from 'mmd-gltf/packages/three-mmd-physics';
import type { AmmoAPI } from 'mmd-gltf/packages/three-mmd-physics/ammo';
import type { RestBone } from 'mmd-gltf/packages/mmd-vpd';
import { physicsDiagnostics } from 'mmd-gltf/packages/mmd-physics';
import { solvePose } from 'mmd-gltf/packages/mmd-solver';

/** The source extension stays untouched. Fixed-axis twist evaluation is not in
 * the upstream executor; these four undriven twist bones keep local bind TRS.
 * Sleeve IK follows the retargeted arms; leg/toe IK is selected after comparison. */
export function mmdPhysicsModel(root: Object3D, footIK = false, animasa = false) {
  const model = getPhysicsModel(root);
  if (!model) throw new Error('MMD asset has no MMD_physics extension');
  for (const b of model.solver.bones) {
    if (b.fixedAxis) {
      if (!['左腕捩','左手捩','右腕捩','右手捩'].includes(b.name))
        throw new Error(`Unsupported MMD fixed axis: ${b.name}`);
      delete b.fixedAxis; b.flags &= ~0x400;
    }
  }
  const dynamic = new Set(model.profile.bodies.filter(b=>b.mode !== 0).map(b=>b.bone));
  if (animasa) for (const b of model.solver.bones) {
    // Physics owns the necktie and both hair chains. Even a disabled IK record
    // is rejected by the upstream physics capability validator. Remove it only
    // in this cloned runtime solver; retain all seven chains in the GLB.
    if (b.ik?.links.some(l=>dynamic.has(l.index))) {delete b.ik; b.flags &= ~0x20;}
  }
  if (animasa) {
    // PMD has no deformation layers. Its eye controller follows the eyes in
    // source index order; order runtime evaluation by hierarchy/grant dependency.
    const layers = new Map<number,number>();
    const layer = (index: number): number => {
      if (index < 0) return -1;
      if (layers.has(index)) return layers.get(index)!;
      const b = model.solver.bones[index];
      const result = 1 + Math.max(layer(b.parentIndex),b.append ? layer(b.append.source) : -1,
        ...(b.ik ? [layer(b.ik.effector),...b.ik.links.map(l=>layer(l.index))] : []));
      layers.set(index,result); return result;
    };
    for (const b of model.solver.bones) b.layer = layer(b.index);
  }
  const controls = new Map(model.solver.bones.filter(b => b.ik)
    .map(b => [b.index, animasa
      ? (b.name.includes('足ＩＫ') || b.name.includes('つま先ＩＫ') ? footIK
        : !b.ik!.links.some(l=>dynamic.has(l.index)))
      : b.name.includes('袖') || footIK]));
  const diagnostics = physicsDiagnostics(model.profile, model.solver);
  if (diagnostics.length) throw new Error(`MMD physics unavailable: ${diagnostics.map(d => d.message).join('; ')}`);
  return {...model, controls};
}

/** A persistent Bullet world, advanced once per fixed tick. PhysicsRig's seek
 * timeline replays from zero; live generated motion instead needs incremental
 * stepping with the newest retargeted input and bounded catch-up. */
export class LiveMMDPhysics {
  private world?: PhysicsWorld;
  private accumulator = 0;
  private previous?: RestBone[];
  private model;
  steps = 0;
  maximumSecondaryAngle = 0;
  constructor(root: Object3D, private api: AmmoAPI, footIK = false, animasa = false) {
    this.model = mmdPhysicsModel(root, footIK, animasa);
  }
  private read(): RestBone[] {
    return this.model.solver.bones.map(b => {
      const node = this.model.nodes.get(b.index)!;
      return {...b, translation:node.position.toArray(), rotation:node.quaternion.toArray()};
    });
  }
  reset(): void {this.world?.dispose(); this.world = undefined; this.accumulator = 0; this.steps = 0; this.previous = undefined; this.maximumSecondaryAngle = 0;}
  update(delta: number, enabled = true): void {
    if (!Number.isFinite(delta) || delta < 0) throw new Error('Invalid MMD frame delta');
    const raw = this.read(), {profile, solver, controls} = this.model;
    if (enabled) this.world ??= new PhysicsWorld(this.api, profile, solver, raw, controls);
    const elapsed = Math.min(delta, 0.05), before = this.accumulator;
    this.accumulator += enabled ? elapsed : 0;
    let resolved: RestBone[] | undefined;
    let tick = 0;
    while (this.accumulator + 1e-10 >= profile.fixedStep) {
      const t = elapsed ? Math.min(1, (profile.fixedStep - before + tick++ * profile.fixedStep) / elapsed) : 1;
      const input = this.previous ? raw.map((b,i) => ({...b,
        translation:new Vector3().fromArray(this.previous![i].translation).lerp(new Vector3().fromArray(b.translation),t).toArray(),
        rotation:new Quaternion().fromArray(this.previous![i].rotation).slerp(new Quaternion().fromArray(b.rotation),t).toArray(),
      })) : raw;
      resolved = this.world!.resolve(input, controls); this.steps++;
      this.accumulator -= profile.fixedStep;
    }
    resolved ??= enabled ? this.world!.resolve(raw, controls, false) : solvePose(solver, raw, controls);
    this.previous = raw;
    for (const b of resolved) {
      const node = this.model.nodes.get(b.index)!;
      node.position.fromArray(b.translation); node.quaternion.fromArray(b.rotation);
    }
    for (const b of profile.bodies) if (b.mode !== 0 && b.bone >= 0) {
      const original = raw.find(r => r.index === b.bone)!;
      this.maximumSecondaryAngle = Math.max(this.maximumSecondaryAngle,
        this.model.nodes.get(b.bone)!.quaternion.angleTo(new Quaternion().fromArray(original.rotation)));
    }
    for (const node of this.model.nodes.values()) if (node.parent && !node.parent.userData.pmxBone) node.parent.updateMatrixWorld(true);
  }
  get allocations() {return PhysicsWorld.allocations;}
  dispose(): void {this.reset();}
}
