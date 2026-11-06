import { Quaternion, Vector3 } from 'three';
import { clonePose, encode, FPS, JOINTS, positions, type Pose, type Rig } from './motion';
import { jointIndex, type Effector } from './pose-ik';
import { PoseResponse } from './pose-response';

export interface PartControl {
  joint: Effector;
  position?: Vector3;
  rotation?: Quaternion;
  velocity: Vector3;
  angularVelocity: Quaternion;
  updatedAt: number;
  held: boolean;
}
const copyControl = (c: PartControl): PartControl => ({...c,position:c.position?.clone(),rotation:c.rotation?.clone(),
  velocity:c.velocity.clone(),angularVelocity:c.angularVelocity.clone()});

/** Separate gesture identity from pointer revisions. Coalesced movement and
 * release do not starve in-flight inference; new grabs/reset/pause invalidate it.
 * Only displayed poses enter the 30 Hz context, including during underruns. */
export class InteractionResponse extends PoseResponse {
  control?: PartControl;
  samples: (PartControl & {sampledAt:number})[] = [];
  private now = 0;
  private releasedAt = -Infinity;
  private sampleTime = 0;
  begin(joint: Effector, position: Vector3 | undefined, rotation: Quaternion | undefined, now: number) {
    this.edit(this.pose,now);
    this.control = {joint,position:position?.clone(),rotation:rotation?.clone(),velocity:new Vector3(),
      angularVelocity:new Quaternion(),updatedAt:now,held:true};
    this.now = now; this.samples = []; this.sampleTime = 0;
  }
  update(position: Vector3 | undefined, rotation: Quaternion | undefined, now: number) {
    const c = this.control; if (!c) return;
    const dt = Math.max(1/120,(now-c.updatedAt)/1000);
    c.velocity = position && c.position ? position.clone().sub(c.position).divideScalar(dt).clampLength(0,2) : new Vector3();
    // Angular velocity is a one-second world-space delta, capped at 3 rad/s.
    const delta = rotation && c.rotation ? rotation.clone().multiply(c.rotation.clone().invert()) : new Quaternion();
    const angle = new Quaternion().angleTo(delta);
    c.angularVelocity = new Quaternion().slerp(delta,angle ? Math.min(1/dt,3/angle) : 0);
    c.position = position?.clone(); c.rotation = rotation?.clone(); c.updatedAt = now; this.now = now;
  }
  release(now: number) {
    if (this.control) {this.control.held = false; this.control.velocity.set(0,0,0); this.control.angularVelocity.identity();}
    this.releasedAt = now; this.now = now;
  }
  get correctionWeight() {return !this.control ? 0 : this.control.held ? 1 : Math.max(0,1-(this.now-this.releasedAt)/350);}
  override edit(pose: Pose, now: number) {
    super.edit(pose,now); this.control = undefined; this.samples = []; this.now = now;
  }
  override ready(_now: number) {return true;}
  override request(_strength: number) {
    const context = this.history.map(clonePose), anchor = context[3];
    return {revision:this.revision,context,targets:Array.from({length:4},()=>clonePose(anchor)),
      control:this.control ? copyControl(this.control) : undefined,controls:this.samples.map(copyControl),now:this.now};
  }
  override advance(delta: number, running: boolean, constrain?: (pose: Pose) => Pose) {
    this.now += delta*1000;
    super.advance(delta,running,constrain);
    this.sampleTime += delta;
    while (this.sampleTime >= 1/FPS) {
      if (this.control) this.samples.push({...copyControl(this.control),sampledAt:this.now-this.sampleTime*1000+1000/FPS});
      if (this.samples.length>4) this.samples.shift();
      this.sampleTime -= 1/FPS;
    }
    if (this.control && !this.control.held && this.correctionWeight===0) this.control = undefined;
  }
}

/** Experimental sparse feature edits, NOT native partial-joint constraints.
 * All untouched features hold the latest plausible displayed pose. No completed
 * future IK pose is supplied. The checkpoint still sees full pose frames.
 * Presence masks enable entire frames only (upstream SOMA contract [1,8]). */
export function encodeInteraction(request: ReturnType<InteractionResponse['request']>, rig: Rig, strength = 1, targetFrames = 4, leadSeconds = .5) {
  if (!Number.isInteger(targetFrames) || targetFrames<1 || targetFrames>4) throw new Error('Target frame count must be 1..4.');
  const encoded = encode(request.context,request.targets,rig), {features,placement} = encoded;
  const c = request.control, inverse = placement.rotation.clone().invert();
  const anchor = request.context[3], points = positions(anchor,rig);
  const trajectory: {position?: number[];rotation?: number[]}[] = [];
  const weight = Math.max(0,Math.min(1,strength));
  for (let i=0;i<4;i++) {
    const f = i+4;
    // Legitimate whole-frame masking, never one mask value per joint.
    for (const name of ['has_local_poses','has_local_root_values','has_global_root_values'] as const)
      features[name][f] = i<targetFrames ? 1 : 0;
    if (!c) continue;
    const j = jointIndex(c.joint), horizon=leadSeconds+i/FPS;
    const recency = c.held ? Math.exp(-Math.max(0,request.now-c.updatedAt)/150) : 0;
    const target = c.position?.clone().add(c.velocity.clone().multiplyScalar(horizon*recency).clampLength(0,.12));
    const rotation = c.rotation ? new Quaternion().slerp(c.angularVelocity,horizon*recency).multiply(c.rotation) : undefined;
    trajectory.push({position:target?.toArray(),rotation:rotation?.toArray()});
    if (target) {
      target.lerp(points[j],1-weight).sub(placement.origin).applyQuaternion(inverse);
      if (j>0) {
        const root = anchor.root.clone().sub(placement.origin).applyQuaternion(inverse).setY(0);
        features.local_poses.set(target.sub(root).toArray(),f*267+(j-1)*3);
      } else {
        // Root input is explicit external control. Keep other joints' WORLD
        // position features neutral instead of translating their target points.
        const old = features.global_root_values.subarray(f*5,f*5+3);
        const dx=target.x-old[0], dz=target.z-old[2];
        for(let k=0;k<29;k++) {features.local_poses[f*267+k*3]-=dx;features.local_poses[f*267+k*3+2]-=dz;}
        features.global_root_values.set(target.toArray(),f*5);
        features.local_root_values[f*4+3]=target.y;
      }
    }
    if (rotation) {
      const q = inverse.clone().multiply(anchor.rotations[j].clone().slerp(rotation,weight));
      features.local_poses.set([...new Vector3(1,0,0).applyQuaternion(q).toArray(),...new Vector3(0,1,0).applyQuaternion(q).toArray()],f*267+87+j*6);
    }
  }
  if (c?.joint==='Hips' && c.position) for (let f=4;f<8;f++) {
    const next = f===7 ? f : f+1;
    features.local_root_values[f*4+1]=(features.global_root_values[next*5]-features.global_root_values[f*5])*FPS;
    features.local_root_values[f*4+2]=(features.global_root_values[next*5+2]-features.global_root_values[f*5+2])*FPS;
  }
  // Shortest supported segment: 6 tokens, 18 decoded frames (0.6 s).
  features.allowed_pred_num_tokens.fill(0); features.allowed_pred_num_tokens[0]=1;
  return {...encoded,trajectory};
}

export const serializePose = (p: Pose) => ({root:p.root.toArray(),rotations:p.rotations.map(q=>q.toArray())});
/** World motion and absolute rotations; callers distinguish raw temporal change,
 * seam blending and direct corrections rather than adding these causes together. */
export function jointChanges(a: Pose, b: Pose, rig: Rig) {
  const pa=positions(a,rig), pb=positions(b,rig);
  return JOINTS.map((joint,j)=>({joint,meters:pa[j].distanceTo(pb[j]),
    rootRelativeMeters:pa[j].clone().sub(a.root).distanceTo(pb[j].clone().sub(b.root)),
    radians:a.rotations[j].angleTo(b.rotations[j]),
    localRadians:(rig.parents[j]<0 ? a.rotations[j].clone() : a.rotations[rig.parents[j]].clone().invert().multiply(a.rotations[j]))
      .angleTo(rig.parents[j]<0 ? b.rotations[j] : b.rotations[rig.parents[j]].clone().invert().multiply(b.rotations[j]))}));
}
