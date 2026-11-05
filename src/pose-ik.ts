import { Quaternion, Vector3 } from 'three';
import { clonePose, JOINTS, positions, type Pose, type Rig } from './motion';

export const EFFECTORS = ['LeftHand', 'RightHand', 'LeftFoot', 'RightFoot', 'Head', 'Hips', 'Chest', 'LeftShoulder', 'RightShoulder'] as const;
export type Effector = typeof EFFECTORS[number];
export interface PoseConstraint {joint: Effector; target: Vector3}
export const jointIndex = (name: Effector) => JOINTS.indexOf(name);
const identity = new Quaternion();
const limits: Record<string, number> = {Spine1:0.3, Spine2:0.3, Chest:0.4, Neck1:0.4, Neck2:0.4,
  Head:0.8, LeftShoulder:0.6, RightShoulder:0.6, LeftArm:2.7, RightArm:2.7,
  LeftLeg:1.9, RightLeg:1.9, LeftFoot:0.7, RightFoot:0.7, LeftHand:1.2, RightHand:1.2};

/** World rotations in Pose are absolute. Rotate descendants together to retain
 * their local transforms; translations/segment lengths are never edited. */
export function rotateBranch(pose: Pose, rig: Rig, joint: number, delta: Quaternion) {
  const affected = new Set([joint]);
  for (let i = joint; i < JOINTS.length; i++) if (affected.has(i) || affected.has(rig.parents[i])) {
    affected.add(i); pose.rotations[i].premultiply(delta).normalize();
  }
}

export class PoseIK {
  private lateral: Vector3;
  constructor(readonly rig: Rig, readonly rest: Pose) {
    const p = positions(rest, rig);
    this.lateral = p[22].clone().sub(p[26]).normalize();
  }
  private hinge(j: number) {return /Shin|ForeArm/.test(JOINTS[j]);}
  private hingeAxis(j: number) {
    return this.lateral.clone().applyQuaternion(this.rest.rotations[this.rig.parents[j]].clone().invert());
  }
  /** Limit in parent space relative to the authored stance, including signed
   * knee/elbow hinges. This prevents reverse knees and cumulative CCD twisting. */
  limit(pose: Pose, j: number) {
    const parent = this.rig.parents[j];
    const parentQ = parent < 0 ? identity : pose.rotations[parent];
    const restParent = parent < 0 ? identity : this.rest.rotations[parent];
    const restLocal = restParent.clone().invert().multiply(this.rest.rotations[j]);
    const local = parentQ.clone().invert().multiply(pose.rotations[j]);
    const delta = local.multiply(restLocal.clone().invert()).normalize();
    if (delta.w < 0) delta.set(-delta.x,-delta.y,-delta.z,-delta.w);
    if (this.hinge(j)) {
      const axis = this.hingeAxis(j);
      const angle = 2 * Math.atan2(new Vector3(delta.x,delta.y,delta.z).dot(axis),delta.w);
      const elbow = JOINTS[j].includes('ForeArm');
      delta.setFromAxisAngle(axis, Math.max(elbow ? -2.7 : 0, Math.min(elbow ? 0 : 2.65, angle)));
    } else {
      const angle = identity.angleTo(delta), max = limits[JOINTS[j]] ?? Math.PI;
      if (angle > max) delta.slerp(identity, 1 - max / angle);
    }
    const desired = parentQ.clone().multiply(delta).multiply(restLocal);
    rotateBranch(pose, this.rig, j, desired.multiply(pose.rotations[j].clone().invert()));
  }
  rotate(input: Pose, joint: Effector, delta: Quaternion): Pose {
    const pose = clonePose(input), j = jointIndex(joint);
    rotateBranch(pose,this.rig,j,delta); this.limit(pose,j); return pose;
  }
  private chain(j: number): number[] {
    const result: number[] = [];
    for (let p = this.rig.parents[j]; p > 0; p = this.rig.parents[p]) result.push(p);
    return result;
  }
  private step(pose: Pose, c: PoseConstraint) {
    const end = jointIndex(c.joint);
    for (const j of this.chain(end)) {
      const points = positions(pose,this.rig), from = points[end].clone().sub(points[j]);
      const to = c.target.clone().sub(points[j]);
      if (from.lengthSq() < 1e-10 || to.lengthSq() < 1e-10) continue;
      let delta: Quaternion;
      if (this.hinge(j)) {
        const axis = this.hingeAxis(j).applyQuaternion(pose.rotations[this.rig.parents[j]]);
        from.addScaledVector(axis,-from.dot(axis)); to.addScaledVector(axis,-to.dot(axis));
        if (from.lengthSq() < 1e-10 || to.lengthSq() < 1e-10) continue;
        from.normalize(); to.normalize();
        const angle = Math.atan2(axis.dot(from.clone().cross(to)),from.dot(to));
        delta = new Quaternion().setFromAxisAngle(axis,Math.max(-0.25,Math.min(0.25,angle)));
      } else {
        delta = new Quaternion().setFromUnitVectors(from.normalize(),to.normalize());
        const angle = identity.angleTo(delta), maxStep = j <= 3 ? 0.035 : 0.22;
        if (angle > maxStep) delta.slerp(identity,1 - maxStep / angle);
      }
      rotateBranch(pose,this.rig,j,delta); this.limit(pose,j);
    }
  }
  solve(input: Pose, constraint: PoseConstraint, planted: PoseConstraint[] = [], bodyFollow = true): Pose {
    const pose = clonePose(input), target = constraint.target;
    if (!target.toArray().every(Number.isFinite)) return pose;
    const j = jointIndex(constraint.joint), points = positions(pose,this.rig);
    if (j === 0) {pose.root.copy(target); return pose;}
    if (bodyFollow && constraint.joint.includes('Foot')) {
      const shift = target.clone().sub(points[j]).multiplyScalar(0.35).clampLength(0,0.25);
      pose.root.add(shift); pose.root.y = Math.max(0.45,pose.root.y);
      // A planted leg cannot grow to follow an upward pelvis. Keep its hip
      // inside the leg's reach sphere before the rotational solve.
      for (const support of planted) {
        const foot = jointIndex(support.joint);
        if (foot !== 24 && foot !== 28) continue;
        const hip = positions(pose,this.rig)[foot-2];
        const reach = (this.rig.offsets[foot-1].length()+this.rig.offsets[foot].length())*0.995;
        const toward = support.target.clone().sub(hip), distance = toward.length();
        if (distance > reach) pose.root.addScaledVector(toward,(distance-reach)/distance);
      }
    }
    for (let n = 0; n < 24; n++) {
      this.step(pose,constraint);
      for (const support of planted) if (support.joint !== constraint.joint) this.step(pose,support);
    }
    return pose;
  }
}
