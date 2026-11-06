import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {gzipSync,gunzipSync} from 'node:zlib';
import {Quaternion,Vector3} from 'three';
import {blendPose,heading,positions,JOINTS,type Pose} from '../src/motion';
import {jointChanges} from '../src/interaction';
import {somaFixture} from '../tests/mmd-fixture';
const read=async (s:string)=>JSON.parse(await readFile(new URL(s,import.meta.url),'utf8'));
const experiment=JSON.parse(gunzipSync(await readFile(new URL('../.artifacts/interaction-response-quality/traces.json.gz',import.meta.url))).toString());
const {rig}=somaFixture();
const pose=(p:any):Pose=>({root:new Vector3().fromArray(p.root),rotations:p.rotations.map((q:number[])=>new Quaternion().fromArray(q))});
const mean=(a:number[])=>a.reduce((s,v)=>s+v,0)/Math.max(1,a.length);
const max=(a:number[])=>Math.max(0,...a);
const times=(a:number[])=>{const sorted=[...a].sort((a,b)=>a-b);return {min:sorted[0],median:sorted[Math.floor(sorted.length/2)],max:sorted.at(-1)};};
const selected=(r:any)=>r.sequences.flatMap((s:any)=>s.candidates.find((c:any)=>c.index===s.selected)?.rawMotion ?? []);
const comparisons=[];
for(const joint of ['LeftHand','Hips']) for(const strategy of ['single','selection']) for(const other of ['no-drag','down']) {
  const find=(trajectory:string)=>experiment.rollouts.find((r:any)=>r.joint===joint && r.strategy===strategy && r.trajectory===trajectory);
  const a=selected(find('up')),b=selected(find(other));
  comparisons.push({joint,strategy,comparison:`up vs ${other}`,perJoint:JOINTS.map((joint,j)=> {
    const ds=a.map((p:any,i:number)=>jointChanges(pose(p),pose(b[Math.min(i,b.length-1)]),rig)[j]);
    const aligned=a.map((p:any,i:number)=> {
      const pa=pose(p),pb=pose(b[Math.min(i,b.length-1)]),ap=positions(pa,rig),bp=positions(pb,rig);
      return ap[j].sub(pa.root).applyAxisAngle(new Vector3(0,1,0),heading(bp)-heading(ap)).distanceTo(bp[j].sub(pb.root));
    });
    return {joint,meters:mean(ds.map((d:any)=>d.meters)),rootRelativeMeters:mean(ds.map((d:any)=>d.rootRelativeMeters)),
      headingAlignedMeters:mean(aligned),radians:mean(ds.map((d:any)=>d.radians)),localRadians:mean(ds.map((d:any)=>d.localRadians))};
  })});
}
const rollouts=experiment.rollouts.map((r:any)=> {
  const poses=r.displayed.map((s:any)=>pose(s.pose)),initial=poses[0];
  const perJoint=JOINTS.map((joint,j)=> {
    const direct=r.displayed.map((s:any)=>s.directCorrection[j]);
    const raw=r.sequences.flatMap((s:any)=> {
      const c=s.candidates.find((c:any)=>c.index===s.selected);if(!c) return [];
      return [jointChanges(pose(c.rawMotion[0]),pose(c.rawMotion.at(-1)),rig)[j]];
    });
    return {joint,maxDirectMeters:max(direct.map((c:any)=>c.meters)),maxDirectRadians:max(direct.map((c:any)=>c.radians)),
      meanRawSegmentMeters:mean(raw.map((c:any)=>c.meters)),meanRawLocalRadians:mean(raw.map((c:any)=>c.localRadians))};
  });
  return {joint:r.joint,strategy:r.strategy,trajectory:r.trajectory,generations:r.sequences.length,
    selectedSecond:r.sequences.filter((s:any)=>s.selected===1).length,rejected:r.sequences.filter((s:any)=>s.selected===undefined).length,
    maxControlError:max(r.displayed.map((s:any)=>s.controlError)),
    maxHeadingDeviation:max(poses.map((p:Pose)=>{const d=heading(positions(p,rig))-heading(positions(initial,rig));return Math.abs(Math.atan2(Math.sin(d),Math.cos(d)));})),
    maxRootDistance:max(poses.map((p:Pose)=>p.root.distanceTo(initial.root))),
    maxRootStep:max(poses.slice(1).map((p:Pose,i:number)=>p.root.distanceTo(poses[i].root))),
    rawQuality:r.sequences.map((s:any)=>s.candidates.find((c:any)=>c.index===s.selected)?.quality),perJoint};
});
const timing=['single','selection'].map(strategy=> {
  const ss=experiment.rollouts.filter((r:any)=>r.strategy===strategy).flatMap((r:any)=>r.sequences);
  return {strategy,batch:times(ss.map((s:any)=>s.milliseconds)),inference:times(ss.flatMap((s:any)=>s.candidates.map((c:any)=>c.inferenceMilliseconds))),
    selectionOverhead:times(ss.map((s:any)=>s.milliseconds-s.candidates.reduce((n:number,c:any)=>n+c.deliveryMilliseconds,0))),
    candidateCounts:ss.map((s:any)=>s.candidates.length),queued:0};
});
// Preserve per-update matched causal evidence, in addition to the continuous
// no-drag rollouts (whose histories diverge after accepting different output).
const matched=experiment.rollouts.filter((r:any)=>r.strategy==='selection').map((r:any)=>({
  joint:r.joint,trajectory:r.trajectory,sequences:r.sequences.map((s:any)=> {
    const controlled=s.candidates.find((c:any)=>c.index===0),base=s.candidates.find((c:any)=>c.index===1);
    return {requestedAt:s.requestedAt,selected:s.selected,available:!!base,
      responseCredit:controlled.quality.response,baselineCredit:base?.quality.response,
      perJoint:base ? JOINTS.map((joint,j)=> {
        const changes=controlled.rawMotion.map((p:any,i:number)=>jointChanges(pose(base.rawMotion[i]),pose(p),rig)[j]);
        return {joint,meanMeters:mean(changes.map((c:any)=>c.meters)),meanLocalRadians:mean(changes.map((c:any)=>c.localRadians))};
      }) : []};
  })
}));
const browser=await read('../.artifacts/interaction/browser-summary.json'),traces=[];
for(const character of ['soma','animasa','mmd']) for(const joint of ['LeftHand','Hips']) {
  const r=await read(`../.artifacts/interaction/${character}-${joint}.json`),samples=r.displayedInteraction;
  const summary=browser.cases.find((c:any)=>c.character===r.character && c.joint===joint);
  summary.proposalTiming=times(r.interactionSequences.map((s:any)=>s.selection.milliseconds));
  summary.selectionOverhead=times(r.interactionSequences.map((s:any)=>s.selection.selectionMilliseconds));
  summary.candidateCounts=r.interactionSequences.map((s:any)=>s.selection.candidates.length);
  summary.perJointCorrections=JOINTS.map((joint,j)=> {
    const direct=samples.flatMap((s:any)=>s.directCorrection.filter((c:any)=>c.joint===joint));
    const seams=samples.flatMap((s:any)=> {
      const sequence=r.interactionSequences.find((g:any)=>g.generation===s.generation);
      if(!sequence || !s.player || s.generatedFrame<0) return [];
      const frames=sequence.rawMotion,frame=Math.min(frames.length-1,Math.max(0,s.generatedFrame)),i=Math.floor(frame);
      const raw=blendPose(pose(frames[i]),pose(frames[Math.min(i+1,frames.length-1)]),frame-i);
      return [jointChanges(raw,pose(s.player),rig)[j]];
    });
    return {joint,maxDirectMeters:max(direct.map((c:any)=>c.meters)),maxDirectRadians:max(direct.map((c:any)=>c.radians)),
      meanSeamMeters:mean(seams.map((c:any)=>c.meters)),maxSeamMeters:max(seams.map((c:any)=>c.meters)),maxSeamRadians:max(seams.map((c:any)=>c.radians))};
  });
  traces.push({character:r.character,joint,rig,interactionSequences:r.interactionSequences,displayedInteraction:samples,mmd:r.mmd});
}
const runtimeSourceSha256=Object.fromEntries(await Promise.all([
  'interaction-controller.ts','interaction.ts','pose-main.ts','pose-ik.ts','pose-response.ts','player.ts','motion.ts','inference.ts','inference.worker.ts','mmd.ts'
].map(async name=>[name,createHash('sha256').update(await readFile(new URL(`../src/${name}`,import.meta.url))).digest('hex')])));
const sevenCriterionMatrix=[
  {criterion:1,status:'partial',evidence:'Continuous actual proposals while held/released; convincing uncontrolled response unestablished.'},
  {criterion:2,status:'partial',evidence:'Hand-first paired trial plus pelvis and three-character pointer windows; natural whole-body quality unestablished.'},
  {criterion:3,status:'partial',evidence:'Full inputs/raw/displayed/IK-only/no-drag traces, matched same-history actual proposals and trajectory-grounded response credit; substantive appropriate reaction remains unestablished.'},
  {criterion:4,status:'partial',evidence:'Direct correction bounds pass and opposite hand IK is numerical zero; seams remain material. Canonical evidence excludes retargeting/secondary physics.'},
  {criterion:5,status:'partial',evidence:'Held/reversed/released/cancelled/stale/delayed pointer tests pass; natural settling and contact quality remain unproven.'},
  {criterion:6,status:'partial',evidence:'SOMA/Animasa/Uka pointer, ordinary pose, keyboard and specialist balance regressions pass; full reaction quality remains unestablished.'},
  {criterion:7,status:'partial',evidence:'See current report for executed checks; optional external-source conversion skipped. Full feature acceptance incomplete; merged Pages/public origin remains future post-merge work.'}
];
const summary={hypothesis:experiment.hypothesis,loadMilliseconds:experiment.loadMilliseconds,matched,runtimeSourceSha256,sevenCriterionMatrix,capturedAt:experiment.capturedAt,model:experiment.model,runtime:experiment.runtime,timing,rollouts,comparisons,browser};
await writeFile(new URL('../docs/interaction-response-quality-validation.json',import.meta.url),JSON.stringify(summary,null,2)+'\n');
await writeFile(new URL('../docs/interaction-response-quality-traces.json.gz',import.meta.url),gzipSync(JSON.stringify({experiment,traces}),{level:9}));
console.log(JSON.stringify({timing,comparisons:comparisons.map((c:any)=>({...c,perJoint:c.perJoint.filter((j:any)=>['RightHand','Chest'].includes(j.joint))})),rollouts:rollouts.map(({perJoint,rawQuality,...r}:any)=>r)},null,2));
