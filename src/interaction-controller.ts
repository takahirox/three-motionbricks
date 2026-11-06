import { Quaternion, Vector3 } from 'three';
import { clonePose, decode, heading, positions, type Pose, type Rig } from './motion';
import { encodeInteraction, type InteractionResponse } from './interaction';
import { jointIndex } from './pose-ik';
import { responseProblem } from './pose-response';
import type { InferenceResult } from './inference';

type Request = ReturnType<InteractionResponse['request']>;
type Encoded = ReturnType<typeof encodeInteraction>;
const angle = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a-b),Math.cos(a-b)));

const local=(p: Pose,j: number,rig: Rig) => rig.parents[j]<0 ? p.rotations[j].clone() : p.rotations[rig.parents[j]].clone().invert().multiply(p.rotations[j]);

function directJoints(request: Request, rig: Rig) {
  const owned=new Set<number>(), c=request.control;
  if(!c) return owned;
  const selected=jointIndex(c.joint);owned.add(selected);
  let j=rig.parents[selected];
  for(let n=0;j>0 && n<(c.joint.includes('Hand') ? 3 : 2);n++,j=rig.parents[j]) owned.add(j);
  if(selected===0) for(const j of [22,23,24,26,27,28]) owned.add(j);
  return owned;
}

function desiredControl(request: Request, encoded: Encoded, i: number) {
  const c=request.control, target=encoded.trajectory[Math.min(3,Math.max(0,i-15))];
  return {
    position:target?.position ? (i<15 && c?.position ? c.position.clone().lerp(new Vector3().fromArray(target.position),i/15) : new Vector3().fromArray(target.position)) : undefined,
    rotation:target?.rotation ? (i<15 && c?.rotation ? c.rotation.clone().slerp(new Quaternion().fromArray(target.rotation),i/15) : new Quaternion().fromArray(target.rotation)) : undefined
  };
}

/** Matched counterfactual: same history, checkpoint and neutral future frames,
 * without the imposed future features. Reconstruct ONLY for attribution: keep
 * baseline root/direct-chain locals and substitute model-owned candidate locals.
 * This diagnostic pose is never displayed or supplied to ONNX. Root translation,
 * heading, direct-chain motion and unrelated limb activity cannot earn credit.
 * Reward bounded reduction of the trajectory residual: reach/orientation help,
 * or (for pelvis) less imposed translation of chest/head. This is a conservative
 * geometric suitability test, not a universal naturalness/causality guarantee. */
export function responseCredit(segment: Pose[], baseline: Pose[], request: Request, rig: Rig, encoded: Encoded) {
  const c=request.control;
  if(!c || segment.length!==baseline.length) return 0;
  const selected=jointIndex(c.joint), owned=directJoints(request,rig), anchor=request.context[3];
  const origin=positions(anchor,rig)[selected];let improvement=0;
  for(let i=0;i<segment.length;i++) {
    const base=baseline[i], isolated=clonePose(base), desired=desiredControl(request,encoded,i);
    for(let j=1;j<rig.parents.length;j++) {
      const q=local(owned.has(j) ? base : segment[i],j,rig);
      isolated.rotations[j]=isolated.rotations[rig.parents[j]].clone().multiply(q);
    }
    const bp=positions(base,rig), ip=positions(isolated,rig);
    if(desired.position) {
      const demand=desired.position.clone().sub(origin);
      const landmarks=selected===0 ? [3,6] : [selected];
      if(selected===0) demand.negate();
      for(const j of landmarks) {
        const effect=ip[j].clone().sub(bp[j]);
        improvement+=Math.max(-.04,Math.min(.04,demand.length()-effect.distanceTo(demand)))/landmarks.length;
      }
    }
    if(desired.rotation && selected!==0) {
      const demand=desired.rotation.clone().multiply(anchor.rotations[selected].clone().invert()).multiply(base.rotations[selected]);
      improvement+=.1*Math.max(-.1,Math.min(.1,base.rotations[selected].angleTo(demand)-isolated.rotations[selected].angleTo(demand)));
    }
  }
  return Math.max(0,Math.min(.04,improvement/segment.length));
}

/** Raw-only costs; credit requires an actual matched no-control ONNX segment.
 * No IK, contact correction, seam, retargeting or physics enters selection. */
export function proposalQuality(segment: Pose[], request: Request, rig: Rig, encoded: Encoded, baseline?: Pose[]) {
  const anchor=request.context[3], origin=positions(anchor,rig), facing=heading(origin), c=request.control;
  let problem=responseProblem(segment,rig), tracking=0, rotation=0, root=0, turning=0, slip=0;
  const selected=c ? jointIndex(c.joint) : -1;
  for(let i=0;i<segment.length;i++) {
    const p=segment[i], points=positions(p,rig);
    if(![...p.root.toArray(),...p.rotations.flatMap(q=>q.toArray())].every(Number.isFinite)) problem='Non-finite generated pose';
    turning=Math.max(turning,angle(heading(points),facing));
    root=Math.max(root,p.root.distanceTo(anchor.root));
    if(c) {
      const desired=desiredControl(request,encoded,i);
      if(desired.position) tracking+=points[selected].distanceTo(desired.position);
      if(desired.rotation) rotation+=p.rotations[selected].angleTo(desired.rotation);
    }
    for(const foot of [24,28]) if(foot!==selected && origin[foot].y<.12 && points[foot].y<.12)
      slip+=points[foot].clone().sub(origin[foot]).setY(0).length()/2;
  }
  tracking/=segment.length;rotation/=segment.length;slip/=segment.length;
  const response=baseline ? responseCredit(segment,baseline,request,rig,encoded) : 0;
  // Engineering guards, not universal motion acceptance thresholds. Pelvis
  // translation is imposed control and is scored separately from body reaction.
  const imposed=c?.joint==='Hips' && c.position ? c.position.distanceTo(anchor.root) : 0;
  if(turning>.65) problem='Generated heading exceeded trial bound';
  if(root>.25+imposed) problem='Generated root exceeded trial bound';
  const score=tracking*8+rotation*.25+turning*.5+Math.max(0,root-imposed)*2+slip*3-response*.5;
  return {problem,score,tracking,rotation,root,turning,slip,response,matchedBaseline:!!baseline};
}

/** Two actual proposals: imposed future and matched neutral future. Both retain
 * identical displayed history and legitimate full-frame presence masks. The
 * neutral proposal is also selectable, but scored against the SAME trajectory. */
export function encodeProposal(request: Request, rig: Rig, strength: number, index: number) {
  if(index!==0 && index!==1) throw new Error('Only two proposal variants are configured (absolute cap: 3).');
  return encodeInteraction(index===0 ? request : {...request,control:undefined,controls:[]},rig,strength);
}

export class InteractionController {
  // All controller instances share the same exclusion boundary. No wait list:
  // callers coalesce to the latest displayed history after the active batch.
  private static busy=false;
  private slow=false;
  private fast=0;
  private retryAt=0;
  ready(now: number) {return now>=this.retryAt;}
  async select(request: Request, rig: Rig, strength: number,
    run: (features: Encoded['features'])=>Promise<InferenceResult>, current: ()=>boolean,
    options: {single?: boolean; clock?: ()=>number}={}) {
    if(InteractionController.busy) return undefined;
    InteractionController.busy=true;
    const clock=options.clock ?? (()=>performance.now()), started=clock();
    const candidates=[];
    try {
      const count=options.single || this.slow ? 1 : 2;
      for(let index=0;index<Math.min(3,count);index++) {
        if(!current()) return undefined;
        const encoded=encodeProposal(request,rig,strength,index), began=clock();
        const result=await run(encoded.features), returned=clock();
        if(!current()) return undefined;
        const segment=decode(result.data,result.tokens,encoded.placement);
        const quality=proposalQuality(segment,request,rig,encoded);
        candidates.push({index,variant:index===0 ? 'four-target' : 'matched-no-control',encoded,result,segment,quality,
          deliveryMilliseconds:returned-began});
        // A cold compilation/delayed delivery must not trigger another expensive
        // call. Continue the best available proposal, then lower quality frequency.
        if(returned-started>150) break;
      }
      // Compare the same imposed trajectory for both proposals. Without a
      // completed valid counterfactual (single/slow/cancel), grant no credit.
      const baseline=candidates.find(c=>c.index===1 && !c.quality.problem)?.segment;
      for(const candidate of candidates) candidate.quality=proposalQuality(candidate.segment,request,rig,candidates[0].encoded,baseline);
      const elapsed=clock()-started;
      if(elapsed>150) {this.slow=true;this.fast=0;this.retryAt=clock()+Math.min(300,elapsed/2);}
      else if(this.slow && ++this.fast>=3) {this.slow=false;this.fast=0;this.retryAt=0;}
      const selected=candidates.filter(c=>!c.quality.problem).sort((a,b)=>a.quality.score-b.quality.score)[0];
      if(!selected) this.retryAt=Math.max(this.retryAt,clock()+300);
      return {selected,candidates,milliseconds:elapsed,proposalLimit:count,degraded:this.slow,
        // No queued jobs; request age is reported separately by the caller.
        queued:0,selectionMilliseconds:clock()-started-candidates.reduce((sum,c)=>sum+c.deliveryMilliseconds,0)};
    } finally {InteractionController.busy=false;}
  }
}
