import { Quaternion, Vector3 } from 'three';
import { clonePose, heading, positions, type Pose, type Rig } from './motion';
import { jointIndex, PoseIK, rotateBranch, type PoseConstraint } from './pose-ik';
import { boundedCorrection, PoseResponse, responseProblem } from './pose-response';

export const PUSH_JOINTS = ['Hips','Chest','LeftShoulder','RightShoulder'] as const;
export type PushJoint = typeof PUSH_JOINTS[number];
export type BalancePhase = 'stable' | 'pushing' | 'recovering';
const feet = ['LeftFoot','RightFoot'] as const;
const up = new Vector3(0,1,0);
const horizontal = (v: Vector3) => v.clone().setY(0);

/** Segment-mass proxy, not a dynamics solver or calibrated human COM. */
export function centerOfMass(pose: Pose, rig: Rig): Vector3 {
  const p = positions(pose,rig), com = new Vector3();
  const segments = [[0,3,.43],[4,6,.08],[22,23,.1],[26,27,.1],[23,24,.06],[27,28,.06],
    [11,12,.04],[17,18,.04],[12,13,.025],[18,19,.025],[24,25,.02],[28,29,.02]];
  for (const [a,b,w] of segments) com.addScaledVector(p[a].clone().lerp(p[b],.5),w);
  return com;
}

function hull(points: Vector3[]): Vector3[] {
  const p = points.map(horizontal).sort((a,b)=>a.x-b.x || a.z-b.z);
  const cross = (a: Vector3,b: Vector3,c: Vector3) => (b.x-a.x)*(c.z-a.z)-(b.z-a.z)*(c.x-a.x);
  const half = (list: Vector3[]) => {
    const result: Vector3[] = [];
    for (const v of list) {while(result.length>1 && cross(result.at(-2)!,result.at(-1)!,v)<=0) result.pop();result.push(v);}
    return result;
  };
  return [...half(p).slice(0,-1),...half([...p].reverse()).slice(0,-1)];
}
export function supportPolygon(anchors: Vector3[], yaw: number): Vector3[] {
  return hull(anchors.flatMap(p => [-.055,.055].flatMap(x=>[-.11,.11].map(z=>
    new Vector3(x,0,z).applyAxisAngle(up,yaw).add(horizontal(p))))));
}
/** Signed distance to the closest support edge; positive means inside. */
export function supportMargin(point: Vector3, polygon: Vector3[]): number {
  if (polygon.length < 3) return -1;
  return Math.min(...polygon.map((a,i) => {
    const b = polygon[(i+1)%polygon.length], dx = b.x-a.x, dz = b.z-a.z;
    return (dx*(point.z-a.z)-dz*(point.x-a.x))/Math.hypot(dx,dz);
  }));
}
export function torsoTilt(pose: Pose, rig: Rig) {
  const p = positions(pose,rig);
  return Math.acos(Math.max(-1,Math.min(1,p[3].clone().sub(p[0]).normalize().dot(up))));
}
export interface Contact {joint: typeof feet[number]; anchor: Vector3; planted: boolean; releases: number; replants: number}

/** Contact inference follows generated foot motion. It never authors a swing.
 * Hysteresis permits lift-off and touchdown; drift beyond a small correction
 * budget also releases contact instead of pinning an incompatible prediction. */
export class FootContacts {
  contacts: Contact[];
  private previous: Vector3[];
  constructor(pose: Pose, readonly rig: Rig, readonly floor: number[]) {
    const p = positions(pose,rig);
    this.contacts = feet.map((joint,i)=> {
      const anchor=p[jointIndex(joint)].clone(), planted=Math.abs(anchor.y-floor[i])<.035;
      if(planted) anchor.y=floor[i];
      return {joint,anchor,planted,releases:0,replants:0};
    });
    this.previous = this.contacts.map(c=>c.anchor.clone());
  }
  snapshot() {
    return {contacts:this.contacts.map(c=>({...c,anchor:c.anchor.clone()})),previous:this.previous.map(p=>p.clone())};
  }
  restore(state: ReturnType<FootContacts['snapshot']>) {
    this.contacts=state.contacts;this.previous=state.previous;
  }
  update(pose: Pose, dt: number) {
    if (dt<=0) return;
    const p = positions(pose,this.rig);
    this.contacts.forEach((c,i)=> {
      const point = p[jointIndex(c.joint)], speed = point.distanceTo(this.previous[i])/dt;
      const height = point.y-this.floor[i], drift = horizontal(point).distanceTo(horizontal(c.anchor));
      if (c.planted && (height>.045 || drift>.065)) {c.planted=false;c.releases++;}
      else if (!c.planted && height<.018 && height>-.025 && speed<.12) {
        c.planted=true;c.replants++;c.anchor.copy(point);c.anchor.y=this.floor[i];
      }
      this.previous[i].copy(point);
    });
  }
  get constraints(): PoseConstraint[] {return this.contacts.filter(c=>c.planted).map(c=>({joint:c.joint,target:c.anchor.clone()}));}
  polygon(yaw: number) {return supportPolygon(this.contacts.filter(c=>c.planted).map(c=>c.anchor),yaw);}
}

/** Deterministic disturbance only. Foot IK has authority here, before inference.
 * Pelvis displacement, angular tilt and arm counter-rotation are bounded and
 * explicitly reported as controller contributions, never model generation. */
export function disturbedPose(base: Pose, displacement: Vector3, rig: Rig, ik: PoseIK, planted?: PoseConstraint[]): Pose {
  const d = horizontal(displacement).clampLength(0,.38), magnitude = d.length();
  if (magnitude < 1e-8) return clonePose(base);
  const axis = up.clone().cross(d).normalize(), pose = clonePose(base);
  pose.root.addScaledVector(d,.32); pose.root.y -= Math.min(.15,magnitude*.4);
  rotateBranch(pose,rig,0,new Quaternion().setFromAxisAngle(axis,magnitude*.65));
  rotateBranch(pose,rig,1,new Quaternion().setFromAxisAngle(axis,magnitude*.7));
  // Immediate angular counter-response; ONNX subsequently owns these joints.
  for (const j of [11,17]) rotateBranch(pose,rig,j,new Quaternion().setFromAxisAngle(axis,-magnitude*2.1));
  const p = positions(base,rig), constraints = planted ?? feet.map(joint=>({joint,target:p[jointIndex(joint)]}));
  // Seed flexion away from the straight-leg CCD singularity before planting.
  const lateral=p[22].clone().sub(p[26]).normalize();
  for(const c of constraints) rotateBranch(pose,rig,jointIndex(c.joint)-1,new Quaternion().setFromAxisAngle(lateral,.7+magnitude));
  let result = pose;
  for(let pass=0;pass<3;pass++) for (const c of constraints) result = ik.solve(result,c,constraints,false);
  for(const c of constraints) {
    const j=jointIndex(c.joint);
    rotateBranch(result,rig,j,base.rotations[j].clone().multiply(result.rotations[j].clone().invert()));
  }
  return result;
}

/** Upright, settled full-body conditioning, including a prospective landing.
 * These poses are never enqueued for playback. A step intention is not evidence
 * of a generated step. Keep heading and the actual support origin. */
export function recoveryTargets(stance: Pose, anchor: Pose, direction: Vector3, needsStep: boolean,
  rig: Rig, ik: PoseIK, supports: PoseConstraint[], lift = false, settling = false): Pose[] {
  const yaw = heading(positions(anchor,rig))-heading(positions(stance,rig));
  const goal = clonePose(stance), turn = new Quaternion().setFromAxisAngle(up,yaw);
  goal.rotations = goal.rotations.map(q=>turn.clone().multiply(q));
  const p = positions(anchor,rig), center = supports.length
    ? supports.reduce((sum,c)=>sum.add(c.target),new Vector3()).multiplyScalar(1/supports.length)
    : p[24].clone().lerp(p[28],.5);
  const restCenter = positions(goal,rig)[24].lerp(positions(goal,rig)[28],.5);
  goal.root.add(horizontal(center).sub(horizontal(restCenter)));
  const d = horizontal(direction).clampLength(0,.38);
  const intended = feet.map(joint=>({joint,target:(supports.find(c=>c.joint===joint)?.target ?? p[jointIndex(joint)]).clone()}));
  if (needsStep && d.lengthSq()>1e-8) {
    const swing = horizontal(p[24].clone().sub(p[28])).dot(d)>=0 ? 0 : 1;
    const step = d.clone().normalize().multiplyScalar(Math.max(.18,d.length()));
    intended[swing].target.add(step);
    if(lift) intended[swing].target.y+=.075;
    goal.root.addScaledVector(step,.5); goal.root.y-=.025;
  }
  const lateral=positions(goal,rig)[22].sub(positions(goal,rig)[26]).normalize();
  if(settling) goal.root.y-=.025;
  if(needsStep || settling) for(const j of [23,27]) rotateBranch(goal,rig,j,new Quaternion().setFromAxisAngle(lateral,.7));
  let solved = goal;
  for (const c of intended) solved = ik.solve(solved,c,intended,false);
  for(const c of intended) {
    const j=jointIndex(c.joint);
    rotateBranch(solved,rig,j,turn.clone().multiply(stance.rotations[j]).multiply(solved.rotations[j].clone().invert()));
  }
  return Array.from({length:4},()=>clonePose(solved));
}

/** Ground the observed landing, rather than repeatedly asking for the original
 * step endpoint. Any measured ankle-height bias is conditioning only, capped at
 * 1 cm; it never changes contact thresholds or edits decoded/model playback. */
export function settlingTargets(stance: Pose, anchor: Pose, raw: Pose, rig: Rig, ik: PoseIK,
  contacts: FootContacts): Pose[] {
  const p=positions(anchor,rig), predicted=positions(raw,rig);
  const supports=contacts.contacts.map((c,i)=>({joint:c.joint,
    target:(c.planted ? c.anchor : p[jointIndex(c.joint)]).clone()
      .setY(contacts.floor[i]-Math.min(.01,Math.max(0,predicted[jointIndex(c.joint)].y-contacts.floor[i])))}));
  return recoveryTargets(stance,anchor,new Vector3(),false,rig,ik,supports,false,true);
}

export function motionMetrics(pose: Pose, rig: Rig, contacts: FootContacts, velocity = new Vector3()) {
  const com = centerOfMass(pose,rig), polygon = contacts.polygon(heading(positions(pose,rig)));
  const p=positions(pose,rig);
  const capture = com.clone().addScaledVector(horizontal(velocity).clampLength(0,1.5),Math.sqrt(Math.max(.1,com.y)/9.81));
  return {com:com.toArray(),capture: capture.toArray(),support:polygon.map(p=>p.toArray()),
    margin:supportMargin(com,polygon),captureMargin:supportMargin(capture,polygon),tilt:torsoTilt(pose,rig),
    minimumJointHeight:Math.min(...p.map(v=>v.y)),
    contactDrift:contacts.contacts.map(c=>c.planted ? p[jointIndex(c.joint)].distanceTo(c.anchor) : null),
    contacts:contacts.contacts.map(c=>({joint:c.joint,planted:c.planted,anchor:c.anchor.toArray(),releases:c.releases,replants:c.replants}))};
}

export class BalanceRecovery {
  phase: BalancePhase = 'stable';
  readonly response: PoseResponse;
  contacts: FootContacts;
  displacement = new Vector3();
  velocity = new Vector3();
  needsStep = false;
  problem?: string;
  attempts = 0;
  generated = false;
  displayedTrace: (ReturnType<typeof recoveryTrace>[number] & {generation:number;generatedFrame:number;source:string;correction:{angle:number;root:number}})[] = [];
  private segmentLength = 0;
  private correction = {angle:0,root:0};
  private traceTime = 0;
  private base: Pose;
  private lastTime = 0;
  private lastCom: Vector3;
  private settledFor = 0;
  private idleFor = 0;
  private eventContext?: Pose[];
  private goal: Pose[];
  private landingGoal?: Pose[];
  private lastRaw?: Pose;
  readonly floor: number[];
  constructor(readonly stance: Pose, readonly rig: Rig, readonly ik: PoseIK) {
    this.response = new PoseResponse(stance); this.base=clonePose(stance);
    this.lastCom=centerOfMass(stance,rig);this.goal=Array.from({length:4},()=>clonePose(stance));
    this.floor=feet.map(j=>positions(stance,rig)[jointIndex(j)].y);
    this.contacts = new FootContacts(stance,rig,this.floor);
  }
  get pose() {return this.response.pose;}
  begin(now: number) {
    this.base=clonePose(this.pose);this.response.edit(this.pose,now);this.phase='pushing';
    this.displacement.set(0,0,0);this.velocity.set(0,0,0);this.lastTime=now;this.settledFor=0;
    this.attempts=0;this.generated=false;this.problem=undefined;this.needsStep=false;this.eventContext=undefined;this.idleFor=0;this.landingGoal=undefined;
    this.displayedTrace=[];this.traceTime=0;
    this.lastRaw=undefined;
    // Interrupt playback without re-anchoring a released foot or losing its history.
  }
  push(displacement: Vector3, now: number) {
    if (this.phase!=='pushing' || !displacement.toArray().every(Number.isFinite)) return;
    const d=horizontal(displacement).clampLength(0,.38), dt=Math.max(1/120,(now-this.lastTime)/1000);
    const candidate=disturbedPose(this.base,d,this.rig,this.ik,this.contacts.constraints);
    // Each new push starts at the displayed pose, so per-event displacement
    // limits alone cannot bound accumulated tilt or pelvis lowering.
    const problem=this.boundsProblem([candidate],'Disturbance');
    if(problem) {this.problem=problem;return;}
    this.problem=undefined;
    this.velocity.copy(d).sub(this.displacement).divideScalar(dt).clampLength(0,1.5);
    this.displacement.copy(d);this.lastTime=now;
    this.response.edit(candidate,now);
    const m=this.metrics();this.needsStep ||= m.captureMargin<-.025 || d.length()>.2;
  }
  release(now: number) {
    if(this.phase!=='pushing') return;
    this.eventContext=this.response.observedContext();
    this.response.edit(this.pose,now);this.phase='recovering';
    this.goal=recoveryTargets(this.stance,this.base,this.displacement,this.needsStep,this.rig,this.ik,this.contacts.constraints);
    if(this.needsStep) {
      this.landingGoal=this.goal;
      this.goal=recoveryTargets(this.stance,this.base,this.displacement,true,this.rig,this.ik,this.contacts.constraints,true);
    }
    this.lastCom=centerOfMass(this.pose,this.rig);this.velocity.set(0,0,0);
  }
  reset(now: number, pose = this.stance) {
    this.response.reset(pose,now);this.base=clonePose(pose);this.phase='stable';this.problem=undefined;
    this.attempts=0;this.generated=false;this.needsStep=false;this.settledFor=0;this.eventContext=undefined;this.idleFor=0;this.landingGoal=undefined;
    this.displayedTrace=[];this.traceTime=0;
    this.lastRaw=undefined;
    this.displacement.set(0,0,0);this.velocity.set(0,0,0);this.lastCom=centerOfMass(pose,this.rig);
    this.contacts=new FootContacts(pose,this.rig,this.floor);
    const m=this.metrics(), p=positions(pose,this.rig);
    if(m.tilt>.1 || m.margin<=0 || feet.some((j,i)=>Math.abs(p[jointIndex(j)].y-this.floor[i])>.035)) {
      this.phase='recovering';
      this.goal=recoveryTargets(this.stance,pose,new Vector3(),false,this.rig,this.ik,this.contacts.constraints);
    }
  }
  invalidate(now: number) {this.response.edit(this.pose,now);}
  ready(now: number) {return this.phase==='recovering' && !this.problem && this.attempts<6 && this.settledFor<.4
    && this.response.ready(now) && this.response.remaining<.12;}
  request() {
    if(this.needsStep && this.attempts>=2 && this.lastRaw)
      this.goal=settlingTargets(this.stance,this.pose,this.lastRaw,this.rig,this.ik,this.contacts);
    return {revision:this.response.revision,context:(this.eventContext ?? this.response.observedContext()).map(clonePose),targets:this.goal.map(clonePose)};
  }
  accept(segment: Pose[], revision: number, now: number) {
    if(revision!==this.response.revision || this.phase!=='recovering') {
      this.response.discarded++;return false;
    }
    this.attempts++;
    const problem = responseProblem(segment,this.rig) ?? this.boundsProblem(segment);
    if(problem) {this.problem=problem;return false;}
    this.generated=this.response.accept(segment,revision);this.eventContext=undefined;
    this.lastRaw=clonePose(segment.at(-1)!);
    this.segmentLength=segment.length;
    if(this.landingGoal) {this.goal=this.landingGoal;this.landingGoal=undefined;}
    this.lastTime=now;return this.generated;
  }
  boundsProblem(segment: Pose[], source = 'Raw ONNX') {
    for (const pose of segment) {
      const p=positions(pose,this.rig);
      if (Math.min(...p.map(v=>v.y))<-.025) return `${source} body penetrates the floor; reset or push again.`;
      if (pose.root.distanceTo(this.base.root)>.95 || torsoTilt(pose,this.rig)>.8)
        return `${source} exceeds body safety bounds; reset or push again.`;
    }
  }
  /** Only small contact/nonpenetration corrections; never upright torso/arm IK. */
  correct(pose: Pose): Pose {
    let corrected=clonePose(pose);
    const constraints=this.contacts.constraints;
    for(const c of constraints) corrected=this.ik.solve(corrected,c,constraints,false);
    const points=positions(corrected,this.rig), minY=Math.min(...points.map(p=>p.y));
    if(minY<0) corrected.root.y+=Math.min(.025,-minY);
    return boundedCorrection(pose,corrected,.18,.025);
  }
  advance(dt: number, running: boolean) {
    const playing = running && this.phase==='recovering' && !this.problem && this.response.remaining>0;
    // PoseResponse replaces its pose before invoking the correction callback.
    // Keep the displayed pose and contact history together if playback is rejected.
    const safePose=this.pose, safeContacts=playing ? this.contacts.snapshot() : undefined, safeCorrection=this.correction;
    this.response.advance(dt,playing,playing ? pose=> {
      this.contacts.update(pose,dt);
      const corrected=this.correct(pose), problem=this.boundsProblem([corrected]);
      this.correction={angle:Math.max(...pose.rotations.map((q,j)=>q.angleTo(corrected.rotations[j]))),root:pose.root.distanceTo(corrected.root)};
      if(problem) {
        this.problem=`Playback safety stop: ${problem}`;
        this.contacts.restore(safeContacts!);this.correction=safeCorrection;
        return clonePose(safePose);
      }
      return corrected;
    } : undefined);
    const com=centerOfMass(this.pose,this.rig);
    if(dt>0 && this.phase!=='pushing') this.velocity.copy(com).sub(this.lastCom).divideScalar(dt).clampLength(0,1.5);
    this.lastCom.copy(com);
    const m=this.metrics();
    this.traceTime+=dt;
    if(this.traceTime>=1/30 && this.phase!=='stable') {
      this.traceTime%=1/30;
      this.displayedTrace.push({frame:this.displayedTrace.length,root:this.pose.root.toArray(),
        joints:positions(this.pose,this.rig).map(p=>p.toArray()),...m,generation:this.attempts,
        generatedFrame:this.generated ? this.segmentLength-1-this.response.remaining*30 : -1,
        source:this.phase==='pushing' ? 'Deterministic disturbance IK' : this.generated ? 'ONNX + seam + bounded contacts' : 'Disturbance held; waiting for ONNX',
        correction:this.correction});
      if(this.displayedTrace.length>900) this.displayedTrace.shift();
    }
    if(this.phase==='recovering' && this.generated && !this.problem && m.margin>.005 && m.tilt<.1
      && this.velocity.length()<.07 && this.contacts.contacts.every(c=>c.planted)) this.settledFor+=dt;
    else this.settledFor=0;
    if(this.settledFor>.4 && this.response.remaining===0) this.phase='stable';
    this.idleFor=this.response.remaining===0 ? this.idleFor+dt : 0;
    if(this.phase==='recovering' && this.attempts>=6 && this.idleFor>.5 && !this.problem)
      this.problem='Six ONNX sequences without stable recovery. Checkpoint capability is unverified; reset or push again.';
  }
  metrics() {return {...motionMetrics(this.pose,this.rig,this.contacts,this.velocity),phase:this.phase,
    displacement:this.displacement.toArray(),velocity:this.velocity.toArray(),needsStep:this.needsStep,attempts:this.attempts,
    generated:this.generated,problem:this.problem};}
}

/** Raw and corrected traces share frame indices. No success label is inferred
 * merely from conditioning intentions or accepting a model tensor. */
export function recoveryTrace(segment: Pose[], rig: Rig, initial: Pose, floor: number[]) {
  const contacts=new FootContacts(initial,rig,floor);
  let previous=centerOfMass(initial,rig);
  return segment.map((pose,frame)=> {
    contacts.update(pose,1/30);
    const com=centerOfMass(pose,rig), velocity=com.clone().sub(previous).multiplyScalar(30);previous=com;
    return {frame,root:pose.root.toArray(),joints:positions(pose,rig).map(p=>p.toArray()),
      ...motionMetrics(pose,rig,contacts,velocity)};
  });
}
