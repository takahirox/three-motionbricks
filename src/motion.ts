// Pose encoding/decoding adapted from NVIDIA MotionBricks v0.2.0, Apache-2.0.
// See THIRD_PARTY_NOTICES.md for source revision and license.
import { Matrix4, Quaternion, Vector3 } from 'three';

export const JOINTS = ['Hips', 'Spine1', 'Spine2', 'Chest', 'Neck1', 'Neck2', 'Head', 'Jaw',
  'LeftEye', 'RightEye', 'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand',
  'LeftHandThumbEnd', 'LeftHandMiddleEnd', 'RightShoulder', 'RightArm', 'RightForeArm',
  'RightHand', 'RightHandThumbEnd', 'RightHandMiddleEnd', 'LeftLeg', 'LeftShin',
  'LeftFoot', 'LeftToeBase', 'RightLeg', 'RightShin', 'RightFoot', 'RightToeBase'] as const;
export const FPS = 30;
const UP = new Vector3(0, 1, 0);
export interface Pose { root: Vector3; rotations: Quaternion[] }
export interface Rig { parents: number[]; offsets: Vector3[] }
export interface Intent { x: number; z: number; speed: number }
export interface Features {
  global_root_values: Float32Array;
  local_root_values: Float32Array;
  local_poses: Float32Array;
  has_global_root_values: Int32Array;
  has_local_root_values: Int32Array;
  has_local_poses: Int32Array;
  allowed_pred_num_tokens: Int32Array;
}
export interface Placement { origin: Vector3; rotation: Quaternion }
export const clonePose = (p: Pose): Pose => ({root: p.root.clone(), rotations: p.rotations.map(q => q.clone())});
export const blendPose = (a: Pose, b: Pose, t: number): Pose => ({
  root: a.root.clone().lerp(b.root, t), rotations: a.rotations.map((q, i) => q.clone().slerp(b.rotations[i], t)),
});

export function positions(pose: Pose, rig: Rig): Vector3[] {
  const result: Vector3[] = [];
  for (let i = 0; i < JOINTS.length; i++) {
    const parent = rig.parents[i];
    result.push(parent < 0 ? pose.root.clone() : rig.offsets[i].clone()
      .applyQuaternion(pose.rotations[parent]).add(result[parent]));
  }
  return result;
}

export function heading(points: Vector3[]): number {
  const across = points[26].clone().sub(points[22]).setY(0);
  if (across.lengthSq() < 1e-12) return 0;
  const forward = UP.clone().cross(across.normalize());
  return Math.atan2(forward.x, forward.z);
}

/** Remove last context ground position/heading, facing +X as in the official engine. */
export function encode(context: Pose[], targets: Pose[], rig: Rig): {features: Features; placement: Placement} {
  if (context.length !== 4 || targets.length !== 4) throw new Error('Exactly four context and target poses are required.');
  const last = context[3];
  const placement = { origin: last.root.clone().setY(0),
    rotation: new Quaternion().setFromAxisAngle(UP, heading(positions(last, rig)) - Math.PI / 2) };
  const inverse = placement.rotation.clone().invert();
  const poses = [...context, ...targets];
  const worldPoints = poses.map(p => positions(p, rig).map(v => v.sub(placement.origin).applyQuaternion(inverse)));
  const headings = worldPoints.map(heading);
  const features: Features = {
    global_root_values: new Float32Array(40), local_root_values: new Float32Array(32), local_poses: new Float32Array(2136),
    has_global_root_values: new Int32Array(8).fill(1), has_local_root_values: new Int32Array(8).fill(1),
    has_local_poses: new Int32Array(8).fill(1),
    allowed_pred_num_tokens: new Int32Array(11).fill(1),
  };
  for (let f = 0; f < 8; f++) {
    const next = f === 3 || f === 7 ? f : f + 1;
    const root = worldPoints[f][0], nextRoot = worldPoints[next][0];
    const delta = Math.atan2(Math.sin(headings[next] - headings[f]), Math.cos(headings[next] - headings[f]));
    features.global_root_values.set([root.x, root.y, root.z, Math.cos(headings[f]), Math.sin(headings[f])], f * 5);
    features.local_root_values.set([delta * FPS, (nextRoot.x - root.x) * FPS, (nextRoot.z - root.z) * FPS, root.y], f * 4);
    for (let j = 0; j < JOINTS.length; j++) {
      if (j > 0) {
        const point = worldPoints[f][j].clone().sub(root.clone().setY(0));
        features.local_poses.set(point.toArray(), f * 267 + (j - 1) * 3);
      }
      const q = inverse.clone().multiply(poses[f].rotations[j]);
      const x = new Vector3(1, 0, 0).applyQuaternion(q), y = UP.clone().applyQuaternion(q);
      features.local_poses.set([...x.toArray(), ...y.toArray()], f * 267 + 87 + j * 6);
    }
  }
  return {features, placement};
}

export function rotation6D(data: Float32Array, offset: number): Quaternion {
  const x = new Vector3().fromArray(data, offset), yRaw = new Vector3().fromArray(data, offset + 3);
  const z = x.clone().cross(yRaw);
  if (x.lengthSq() < 1e-12 || z.lengthSq() < 1e-12) throw new Error('Model returned a degenerate 6D rotation.');
  x.normalize(); z.normalize();
  return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x, z.clone().cross(x), z)).normalize();
}

/** Restore world placement and trim three boundary frames from each end. */
export function decode(data: Float32Array, tokens: number, placement: Placement): Pose[] {
  if (!Number.isInteger(tokens) || tokens < 6 || tokens > 16 || data.length !== 64 * 366)
    throw new Error(`Invalid SOMA output: ${tokens} tokens, ${data.length} values.`);
  if (!data.every(Number.isFinite)) throw new Error('Model returned non-finite motion values.');
  return Array.from({length: tokens * 4 - 6}, (_, i) => {
    const start = (i + 3) * 366;
    return {root: new Vector3().fromArray(data, start).applyQuaternion(placement.rotation).add(placement.origin),
      rotations: JOINTS.map((_, j) => placement.rotation.clone().multiply(rotation6D(data, start + 92 + j * 6)))};
  });
}

/** Place four root targets ahead at the requested speed, sampled at 30 Hz.
 * This ports Scene Preview's lead-distance/heading and within-token velocity logic.
 * Body targets are original authored stride poses, never played as animation.
 */
export function targetsFor(anchor: Pose, stance: Pose, intent: Intent, rig: Rig): Pose[] {
  const currentHeading = heading(positions(anchor, rig));
  const desired = intent.speed > 0.01 ? Math.atan2(intent.x, intent.z) : currentHeading;
  const stanceHeading = heading(positions(stance, rig));
  const turn = new Quaternion().setFromAxisAngle(UP, desired - stanceHeading);
  const lead = intent.speed > 0.01 ? intent.speed * 0.8 : 0;
  return Array.from({length: 4}, (_, i) => ({
    root: new Vector3(anchor.root.x + intent.x * (lead + intent.speed * i / FPS), stance.root.y,
      anchor.root.z + intent.z * (lead + intent.speed * i / FPS)),
    rotations: strideTarget(stance, rig, intent.speed, i).map(q => turn.clone().multiply(q)),
  }));
}

/** Author one four-frame conditioning window. Only ONNX output is played.
 * Rotate the native stance about its lateral axis, propagate each joint's
 * adjustment through the hierarchy, and keep the torso upright. These targets
 * replace Scene Preview's separately licensed clip samples.
 */
export function strideTarget(stance: Pose, rig: Rig, speed: number, frame: number): Quaternion[] {
  if (speed < 0.01) return stance.rotations.map(q => q.clone());
  const run = speed > 3;
  const phase = 0.6 + frame / FPS * Math.PI * 2 * (run ? 2.7 : 1.7);
  const swing = Math.sin(phase), stride = run ? 0.8 : 0.45, arm = run ? 0.6 : 0.3;
  const flexion: Partial<Record<typeof JOINTS[number], number>> = {
    Hips: run ? 0.08 : 0, Spine1: run ? 0.04 : 0,
    LeftLeg: -swing * stride, RightLeg: swing * stride,
    LeftShin: 0.12 + Math.max(0, -swing) * (run ? 1.1 : 0.6),
    RightShin: 0.12 + Math.max(0, swing) * (run ? 1.1 : 0.6),
    LeftArm: swing * arm, RightArm: -swing * arm,
    LeftForeArm: run ? -1.2 : -0.2, RightForeArm: run ? -1.2 : -0.2,
  };
  const lateral = new Vector3(1, 0, 0).applyAxisAngle(UP, heading(positions(stance, rig)));
  const result: Quaternion[] = [];
  for (let j = 0; j < JOINTS.length; j++) {
    const parent = rig.parents[j];
    const delta = new Quaternion().setFromAxisAngle(lateral, flexion[JOINTS[j]] ?? 0);
    const desired = delta.multiply(stance.rotations[j]);
    result.push(parent < 0 ? desired : result[parent].clone()
      .multiply(stance.rotations[parent].clone().invert()).multiply(desired));
  }
  return result;
}
