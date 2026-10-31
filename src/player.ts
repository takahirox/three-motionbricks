import { Quaternion } from 'three';
import { blendPose, clonePose, FPS, type Pose } from './motion';

/** A single in-flight request appends at a fixed future handoff. Intent changes
 * invalidate pending work. An underrun holds the last pose and pauses model time.
 */
export class MotionPlayer {
  private frames: Pose[];
  private cursor = 3;
  revision = 0;
  generations = 0;
  constructor(stance: Pose) {this.frames = Array.from({length: 4}, () => clonePose(stance));}
  get pose(): Pose {
    const index = Math.floor(this.cursor);
    return blendPose(this.frames[index], this.frames[Math.min(index + 1, this.frames.length - 1)], this.cursor - index);
  }
  get remaining(): number {return (this.frames.length - 1 - this.cursor) / FPS;}
  get waiting(): boolean {return this.remaining <= 0;}
  advance(seconds: number): void {this.cursor = Math.min(this.cursor + seconds * FPS, this.frames.length - 1);}
  changeIntent(): void {
    // Keep history plus up to 0.2 s of the current path while a new request runs.
    const history = this.contextAt(this.cursor);
    const ahead = Math.min(6, Math.floor(this.frames.length - 1 - this.cursor));
    this.frames = [...history, ...Array.from({length: ahead}, (_, i) => this.sample(this.cursor + i + 1))];
    this.cursor = 3; this.revision++;
  }
  private sample(frame: number): Pose {
    const t = Math.max(0, Math.min(frame, this.frames.length - 1)), i = Math.floor(t);
    return blendPose(this.frames[i], this.frames[Math.min(i + 1, this.frames.length - 1)], t - i);
  }
  private contextAt(frame: number): Pose[] {return [3, 2, 1, 0].map(i => this.sample(frame - i));}
  request(): {context: Pose[]; revision: number} {
    return {context: this.contextAt(this.frames.length - 1), revision: this.revision};
  }
  accept(segment: Pose[], revision: number): boolean {
    if (revision !== this.revision) return false;
    if (segment.length < 2) throw new Error('Generated segment is too short.');
    const anchor = this.frames[this.frames.length - 1];
    const rootDelta = anchor.root.clone().sub(segment[0].root);
    const rotationDeltas = anchor.rotations.map((q, i) => q.clone().multiply(segment[0].rotations[i].clone().invert()));
    const identity = new Quaternion();
    // Endpoint correction preserves the displayed pose and fades over eight frames.
    const corrected = segment.map((pose, i) => {
      const weight = Math.max(0, 1 - i / 8);
      return {root: pose.root.clone().addScaledVector(rootDelta, weight),
        rotations: pose.rotations.map((q, j) => identity.clone().slerp(rotationDeltas[j], weight).multiply(q))};
    });
    this.frames.push(...corrected.slice(1));
    // Retain four history samples; bound memory over arbitrarily long sessions.
    const drop = Math.max(0, Math.floor(this.cursor) - 3);
    this.frames.splice(0, drop); this.cursor -= drop;
    this.generations++;
    return true;
  }
}
