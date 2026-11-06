// Reduce saved real-browser traces without dropping the compressed raw evidence.
import {readFile,writeFile} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import {Quaternion,Vector3} from 'three';
import {blendPose,type Pose} from '../src/motion';
import {jointChanges} from '../src/interaction';
import {somaFixture} from '../tests/mmd-fixture';
const root=new URL('../.artifacts/interaction/',import.meta.url);
const read=async (name:string)=>JSON.parse(await readFile(new URL(name,root),'utf8'));
const conditioning=await read('conditioning.json'), browser=await read('browser-summary.json'), {rig}=somaFixture();
const pose=(p:any):Pose=>({root:new Vector3().fromArray(p.root),rotations:p.rotations.map((q:number[])=>new Quaternion().fromArray(q))});
const traces=[];
for(const character of ['soma','animasa','mmd']) for(const joint of ['LeftHand','Hips']) {
  const r=await read(`${character}-${joint}.json`), samples=r.displayedInteraction;
  const perJoint=rig.parents.map((_,j)=> {
    const direct=samples.flatMap((s:any)=>s.directCorrection.filter((c:any)=>c.joint===conditioning.cases[0].perJointRawChange[j].joint));
    const seam=samples.flatMap((s:any)=> {
      const sequence=r.interactionSequences.find((g:any)=>g.generation===s.generation);
      if(!sequence || !s.player || s.generatedFrame<0) return [];
      const frames=sequence.rawMotion, frame=Math.min(frames.length-1,Math.max(0,s.generatedFrame)), i=Math.floor(frame);
      const raw=blendPose(pose(frames[i]),pose(frames[Math.min(i+1,frames.length-1)]),frame-i);
      return [jointChanges(raw,pose(s.player),rig)[j]];
    });
    return {joint:conditioning.cases[0].perJointRawChange[j].joint,
      maxDirectMeters:Math.max(0,...direct.map((c:any)=>c.meters)),maxDirectRadians:Math.max(0,...direct.map((c:any)=>c.radians)),
      maxSeamMeters:Math.max(0,...seam.map((c:any)=>c.meters)),maxSeamRadians:Math.max(0,...seam.map((c:any)=>c.radians))};
  });
  const summary=browser.cases.find((c:any)=>c.character===r.character && c.joint===joint);
  summary.perJointCorrections=perJoint;
  const held=samples.filter((s:any)=>s.held);
  summary.finalVisibleError=r.targetErrorMeters;
  summary.rawGenerationMilliseconds=r.interactionSequences.map((s:any)=>s.milliseconds);
  summary.maxHeldRootCorrection=Math.max(0,...held.flatMap((s:any)=>s.directCorrection.filter((c:any)=>c.joint==='Hips').map((c:any)=>c.meters)));
  traces.push({character:r.character,joint,rig,interactionSequences:r.interactionSequences,displayedInteraction:samples,mmd:r.mmd});
}
await writeFile(new URL('../docs/interaction-validation.json',import.meta.url),JSON.stringify({browser,conditioning:await read('conditioning-summary.json')},null,2)+'\n');
await writeFile(new URL('../docs/interaction-traces.json.gz',import.meta.url),gzipSync(JSON.stringify({conditioning,traces}),{level:9}));
console.log(JSON.stringify(browser.cases.map((c:any)=>({character:c.character,joint:c.joint,maxControlError:c.maxControlError,maxRootStep:c.maxRootStep,
  oppositeHand:c.perJointCorrections?.find((j:any)=>j.joint==='RightHand'),maxHeldRootCorrection:c.maxHeldRootCorrection})),null,2));
