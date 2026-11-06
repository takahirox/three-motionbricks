// Preserve the fresh experiment and pointer evidence independently of the
// historical report. Replay identical raw segments to isolate seam changes.
import {readFile,writeFile} from 'node:fs/promises';
import {gzipSync,gunzipSync} from 'node:zlib';
import {Quaternion,Vector3} from 'three';
import {blendPose,heading,positions,type Pose} from '../src/motion';
import {jointChanges} from '../src/interaction';
import {MotionPlayer} from '../src/player';
import {somaFixture} from '../tests/mmd-fixture';

const read=async (name:string)=>JSON.parse(await readFile(new URL(name,import.meta.url),'utf8'));
const experiment=JSON.parse(gunzipSync(await readFile(new URL('../.artifacts/interaction-experiment/traces.json.gz',import.meta.url))).toString());
const {rig}=somaFixture();
const pose=(p:any):Pose=>({root:new Vector3().fromArray(p.root),rotations:p.rotations.map((q:number[])=>new Quaternion().fromArray(q))});
const replays=[];
for(const c of experiment.cases) {
  const raw=c.rawMotion.map(pose), anchor=pose(c.context[3]);
  const variants=['fixed','adaptive'].map(seam=> {
    const player=new MotionPlayer(anchor,seam as 'fixed'|'adaptive');player.accept(raw,0);
    const samples=raw.map((p:Pose,i:number)=> {
      if(i) player.advance(1/30);
      return {pose:player.pose,corrections:jointChanges(p,player.pose,rig)};
    });
    return {seam,perJoint:rig.parents.map((_,j)=> {
      const differences=samples.map((s:any)=>s.corrections[j]);
      const steps=samples.slice(1).map((s:any,i:number)=>jointChanges(samples[i].pose,s.pose,rig)[j]);
      return {joint:differences[0].joint,
        meanSeamMeters:differences.reduce((s:number,d:any)=>s+d.meters,0)/differences.length,
        maxSeamMeters:Math.max(...differences.map((d:any)=>d.meters)),
        meanSeamRadians:differences.reduce((s:number,d:any)=>s+d.radians,0)/differences.length,
        maxStepMeters:Math.max(...steps.map((d:any)=>d.meters)),maxStepRadians:Math.max(...steps.map((d:any)=>d.radians))};
    })};
  });
  replays.push({name:c.name,variants});
}
const browser=await read('../.artifacts/interaction/browser-summary.json'),traces=[];
for(const character of ['soma','animasa','mmd']) for(const joint of ['LeftHand','Hips']) {
  const r=await read(`../.artifacts/interaction/${character}-${joint}.json`), samples=r.displayedInteraction;
  const summary=browser.cases.find((c:any)=>c.character===r.character && c.joint===joint);
  summary.perJointCorrections=rig.parents.map((_,j)=> {
    const direct=samples.flatMap((s:any)=>s.directCorrection.filter((c:any)=>c.joint===experiment.cases[0].perJointRawChange[j].joint));
    const seam=samples.flatMap((s:any)=> {
      const sequence=r.interactionSequences.find((g:any)=>g.generation===s.generation);
      if(!sequence || !s.player || s.generatedFrame<0) return [];
      const frames=sequence.rawMotion, frame=Math.min(frames.length-1,Math.max(0,s.generatedFrame)),i=Math.floor(frame);
      const raw=blendPose(pose(frames[i]),pose(frames[Math.min(i+1,frames.length-1)]),frame-i);
      return [jointChanges(raw,pose(s.player),rig)[j]];
    });
    return {joint:experiment.cases[0].perJointRawChange[j].joint,
      maxDirectMeters:Math.max(0,...direct.map((c:any)=>c.meters)),maxDirectRadians:Math.max(0,...direct.map((c:any)=>c.radians)),
      meanSeamMeters:seam.reduce((s:number,c:any)=>s+c.meters,0)/Math.max(1,seam.length),
      maxSeamMeters:Math.max(0,...seam.map((c:any)=>c.meters)),maxSeamRadians:Math.max(0,...seam.map((c:any)=>c.radians))};
  });
  traces.push({character:r.character,joint,rig,interactionSequences:r.interactionSequences,displayedInteraction:samples,mmd:r.mmd});
}
await writeFile(new URL('../docs/interaction-continuation-traces.json.gz',import.meta.url),gzipSync(JSON.stringify({experiment,traces}),{level:9}));
const summary=await read('../.artifacts/interaction-experiment/summary.json');
// Removing root translation alone still counts a rigid change in facing as
// limb response. Also align heading, and retain local rotation differences.
for(const comparison of summary.comparisons) {
  let a:any[],b:any[];
  if(comparison.name==='same jitter: fitted vs event velocity') {
    a=experiment.cases.find((c:any)=>c.name==='jitter-fit/hand-up').rawMotion;
    b=experiment.cases.find((c:any)=>c.name==='jitter-event/hand-up').rawMotion;
  } else {
    const [prefix,suffix]=comparison.name.split(': '), continuous=prefix.endsWith(' continuous');
    const variant=prefix.replace(' continuous',''), other=suffix.endsWith('no-drag') ? 'no-drag' : 'hand-down';
    const frames=(trajectory:string)=>continuous
      ? experiment.rollouts.find((r:any)=>r.strategy===variant && r.trajectory===trajectory).sequences.flatMap((s:any)=>s.rawMotion)
      : experiment.cases.find((c:any)=>c.name===`${variant}/${trajectory}`).rawMotion;
    a=frames('hand-up');b=frames(other);
  }
  const differences=a.map((p:any,i:number)=> {
    const pa=pose(p),pb=pose(b[Math.min(i,b.length-1)]),ap=positions(pa,rig),bp=positions(pb,rig);
    const angle=heading(bp)-heading(ap);
    return ap.map((point,j)=>point.sub(pa.root).applyAxisAngle(new Vector3(0,1,0),angle).distanceTo(bp[j].sub(pb.root)));
  });
  comparison.perJointMeanDifference.forEach((j:any,i:number)=> {
    j.rootHeadingAlignedMeters=differences.reduce((s:number,d:number[])=>s+d[i],0)/differences.length;
  });
}
for(const rollout of summary.rollouts) {
  const r=experiment.rollouts.find((r:any)=>r.strategy===rollout.strategy && r.trajectory===rollout.trajectory);
  const poses=r.displayed.map((s:any)=>pose(s.pose)),initial=heading(positions(poses[0],rig));
  rollout.maxHeadingDeviationRadians=Math.max(...poses.map((p:Pose)=> {
    const d=heading(positions(p,rig))-initial;return Math.abs(Math.atan2(Math.sin(d),Math.cos(d)));
  }));
  rollout.maxRootDistanceMeters=Math.max(...poses.map((p:Pose)=>p.root.distanceTo(poses[0].root)));
}
const report={experiment:summary,replays,browser};
await writeFile(new URL('../docs/interaction-continuation-validation.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({browser:browser.cases,replays:replays.filter(r=>r.name==='observed-context/hand-up')},null,2));
