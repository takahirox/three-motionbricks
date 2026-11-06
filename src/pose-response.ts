import { blendPose, clonePose, FPS, positions, type Pose, type Rig } from './motion';
import { MotionPlayer } from './player';

/** Four feasible full-body targets at 30 Hz, approaching the solved intent.
 * These are conditioning only; the queue receives exclusively decoded ONNX. */
export function poseTargets(anchor: Pose, goal: Pose, strength: number): Pose[] {
  const t = Math.max(0,Math.min(1,strength));
  return Array.from({length:4},(_,i) => blendPose(anchor,goal,t * (0.7 + i * 0.1)));
}

/** Reject collapsed/teleporting standing responses without relabeling IK as
 * generated motion. This is a feasibility guard, not a model capability claim. */
export function responseProblem(segment: Pose[], rig: Rig): string | undefined {
  for (let i=0;i<segment.length;i++) {
    const p = segment[i], head = positions(p,rig)[6];
    if (p.root.y < 0.35 || p.root.y > 2.3 || head.y-p.root.y < 0.25)
      return 'Generated body left the standing pose bounds';
    if (i && p.root.distanceTo(segment[i-1].root) > 0.35)
      return 'Generated root moved too far in one frame';
  }
}

/** Bound the correction, retaining unmodified generated joints and root motion.
 * A one-radian chain allowance covers the demonstrated modest reaches while
 * still refusing arbitrary replacement of an incompatible model response. */
export function boundedCorrection(input: Pose, corrected: Pose, maxAngle = 1, maxRoot = 0.08): Pose {
  let weight = 1;
  for (let j=0;j<input.rotations.length;j++) {
    const angle = input.rotations[j].angleTo(corrected.rotations[j]);
    if (angle > maxAngle) weight = Math.min(weight,maxAngle/angle);
  }
  const distance = input.root.distanceTo(corrected.root);
  if (distance > maxRoot) weight = Math.min(weight,maxRoot/distance);
  return blendPose(input,corrected,weight);
}

/** Keeps displayed 30 Hz history, coalesces edits, rejects delayed generations,
 * and hands the current displayed pose to the existing seam-corrected player. */
export class PoseResponse {
  pose: Pose;
  goal: Pose;
  revision = 0;
  generations = 0;
  discarded = 0;
  protected history: Pose[];
  private player: MotionPlayer;
  private accumulator = 0;
  private editedAt = -Infinity;
  private intentContext?: Pose[];
  protected seam: 'fixed' | 'adaptive' = 'fixed';
  constructor(stance: Pose) {
    this.pose = clonePose(stance); this.goal = clonePose(stance);
    this.history = Array.from({length:4},() => clonePose(stance));
    this.player = new MotionPlayer(stance);
  }
  edit(pose: Pose, now: number) {
    // Keep the observed approach to this edit. The debounce/inference delay
    // must not replace the trajectory with four copies of the held goal.
    this.intentContext = this.history.map(clonePose);
    this.pose = clonePose(pose); this.goal = clonePose(pose);
    this.revision++; this.editedAt = now; this.player = new MotionPlayer(pose,this.seam);
  }
  reset(pose: Pose, now: number) {
    this.edit(pose,now); this.history = Array.from({length:4},() => clonePose(pose)); this.accumulator = 0;
    this.intentContext = undefined;
  }
  get remaining() {return this.player.remaining;}
  /** Resume from an IK-only preview without clearing observed history or control. */
  reanchorPlayback() {this.player = new MotionPlayer(this.pose,this.seam);}
  /** Discard motion computed with old settings without ending the active drag
   * or clearing its observed trajectory and release fade. */
  invalidatePlayback() {this.revision++; this.reanchorPlayback();}
  /** The latest displayed 30 Hz samples, including the current disturbance. */
  observedContext() {return [...this.history.slice(1),this.pose].map(clonePose);}
  ready(now: number) {return now - this.editedAt >= 180;}
  request(strength: number) {
    const context = (this.intentContext ?? this.history).map(clonePose);
    return {revision:this.revision,context,targets:poseTargets(context[3],this.goal,strength)};
  }
  accept(segment: Pose[], revision: number) {
    if (revision !== this.revision) {this.discarded++; return false;}
    // A request can take seconds: start at the actually displayed pose/history,
    // rather than an obsolete queued endpoint.
    this.player = new MotionPlayer(this.pose,this.seam);
    this.player.accept(segment,this.player.revision); this.intentContext = undefined; this.generations++; return true;
  }
  advance(delta: number, running: boolean, constrain?: (pose: Pose) => Pose) {
    if (running) {this.player.advance(delta); this.pose = this.player.pose;}
    if (constrain) this.pose = constrain(this.pose);
    this.accumulator += delta;
    while (this.accumulator >= 1 / FPS) {
      this.history.push(clonePose(this.pose)); this.history.shift(); this.accumulator -= 1 / FPS;
    }
  }
}
