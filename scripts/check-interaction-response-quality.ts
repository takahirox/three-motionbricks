// Recompute saved real-proposal inputs, output and scores at the current source.
// No inference, network, diagnostics hook or synthetic model output.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {Quaternion,Vector3} from 'three';
import {type Pose} from '../src/motion';
import {type PartControl} from '../src/interaction';
import {encodeProposal,proposalQuality} from '../src/interaction-controller';
import {somaFixture} from '../tests/mmd-fixture';
const read=async (path:string)=>readFile(new URL(path,import.meta.url));
const summary=JSON.parse((await read('../docs/interaction-response-quality-validation.json')).toString());
const traceBytes=await read('../docs/interaction-response-quality-traces.json.gz');
const traces=JSON.parse(gunzipSync(traceBytes).toString());
const runtimeSourceSha256:Record<string,string>={};
for(const [name,hash] of Object.entries(summary.runtimeSourceSha256)) {
  runtimeSourceSha256[name]=createHash('sha256').update(await read(`../src/${name}`)).digest('hex');
  // Only scoring changed. Preserve the actual original capture and its hashes;
  // do not relabel historical inference/timing as a fresh current-source run.
  if(name!=='interaction-controller.ts') assert.equal(runtimeSourceSha256[name],hash,`Captured source unchanged: ${name}`);
}
const {rig}=somaFixture();
const pose=(p:any):Pose=>({root:new Vector3().fromArray(p.root),rotations:p.rotations.map((q:number[])=>new Quaternion().fromArray(q))});
const vector=(v:any)=>v ? new Vector3(v.x,v.y,v.z) : undefined;
const quaternion=(q:any)=>!q ? undefined : Array.isArray(q) ? new Quaternion().fromArray(q) : new Quaternion(q._x,q._y,q._z,q._w);
const control=(c:any):PartControl|undefined=>!c ? undefined : {...c,position:vector(c.position),rotation:quaternion(c.rotation),
  velocity:vector(c.velocity)!,angularVelocity:quaternion(c.angularVelocity)!};
let sequences=0,proposals=0,samples=0;
const windows:any[]=[],rankingChanges:any[]=[];
const check=(s:any,batch:any,label:string,strength=1)=> {
  const request={revision:0,context:s.context.map(pose),targets:s.neutralTargets.map(pose),
    control:control(s.control),controls:s.controls.map((c:any)=>({...control(c)!,sampledAt:c.sampledAt})),now:s.requestedAt};
  const imposed=encodeProposal(request,rig,strength,0);
  const baseline=batch.candidates.find((c:any)=>c.index===1 && !c.quality.problem)?.rawMotion.map(pose);
  assert.ok(batch.candidates.length>=1 && batch.candidates.length<=2);
  const best=batch.candidates.find((c:any)=>c.index===batch.selected);
  assert.ok(best);
  const corrected=[];
  for(const c of batch.candidates) {
    const encoded=encodeProposal(request,rig,strength,c.index);
    for(const [name,values] of Object.entries(encoded.features)) {
      assert.equal(c.features[name].length,values.length);
      // Browser/Node trig and FK can round differently before Float32 storage.
      // Masks/token constraints remain exact; feature comparisons allow 1e-6.
      for(let i=0;i<values.length;i++) assert.ok(Math.abs(values[i]-c.features[name][i])<=(values instanceof Int32Array ? 0 : 1e-6),`Supported conditioning ${name}[${i}]`);
    }
    const quality=proposalQuality(c.rawMotion.map(pose),request,rig,imposed,baseline);
    for(const [key,value] of Object.entries(quality)) {
      if(key==='response' || key==='score') continue;
      if(typeof value==='number') assert.ok(Math.abs(value-c.quality[key])<1e-8,`Recomputed ${key}`);
      else assert.equal(c.quality[key],value);
    }
    assert.ok(quality.response<=.04+1e-12);
    if(!baseline || c.index===1 || !request.control) assert.ok(quality.response<1e-12,'No unsupported reaction credit');
    if(!c.quality.problem) assert.ok(best.quality.score<=c.quality.score+1e-12);
    corrected.push({index:c.index,originalScore:c.quality.score,originalResponse:c.quality.response,quality});
    proposals++;
  }
  const selected=corrected.filter(c=>!c.quality.problem).sort((a,b)=>a.quality.score-b.quality.score)[0]?.index;
  const window={label,requestedAt:s.requestedAt,recordedSelected:batch.selected,correctedSelected:selected,candidates:corrected};
  windows.push(window);
  if(selected!==batch.selected) rankingChanges.push({label,requestedAt:s.requestedAt,recorded:batch.selected,corrected:selected});
  sequences++;
};
for(const r of traces.experiment.rollouts) for(const s of r.sequences) check(s,s,`${r.joint}/${r.strategy}/${r.trajectory}`);
for(const r of traces.traces) {
  for(const s of r.interactionSequences) {
    check(s,s.selection,`${r.character}/${r.joint}`, .8); // Pointer suite leaves the default conditioning strength unchanged.
    const selected=s.selection.candidates.find((c:any)=>c.index===s.selection.selected);
    assert.deepEqual(s.rawMotion,selected.rawMotion);
    assert.equal(s.selection.queued,0);
  }
  for(const s of r.displayedInteraction) {
    assert.ok(s.directCorrection.every((c:any)=>c.radians<=.45+1e-6));
    if(r.joint==='LeftHand') assert.ok(s.directCorrection.filter((c:any)=>['Chest','RightHand','RightArm','Hips'].includes(c.joint)).every((c:any)=>c.radians<1e-6));
    samples++;
  }
}
const impact=traces.experiment.rollouts.filter((r:any)=>r.strategy==='selection').map((r:any)=> {
  const ws=windows.filter(w=>w.label===`${r.joint}/${r.strategy}/${r.trajectory}`);
  const credits=ws.map(w=>w.candidates.find((c:any)=>c.index===0));
  return {joint:r.joint,trajectory:r.trajectory,originalMaxCredit:Math.max(...credits.map(c=>c.originalResponse)),
    correctedMaxCredit:Math.max(...credits.map(c=>c.quality.response)),
    originalPositive:credits.filter(c=>c.originalResponse>1e-12).length,
    correctedPositive:credits.filter(c=>c.quality.response>1e-12).length};
});
const reviewRegression=windows.find(w=>w.label==='LeftHand/selection/down' && Math.abs(w.requestedAt-2333.3333333333335)<1e-6);
assert.ok(reviewRegression,'Retain the actual worsening-tracking window identified in review');
const reviewed=reviewRegression.candidates.find((c:any)=>c.index===0);
assert.ok(Math.abs(reviewed.originalResponse-.00017112784413080394)<1e-12);
assert.equal(reviewed.quality.response,0,'Worsening the absolute residual cannot earn assistance credit');
const sevenCriterionMatrix=summary.sevenCriterionMatrix.map((c:any)=>({...c,
  ...(c.criterion===3 ? {evidence:'Absolute residual scoring corrected and all 201 windows/318 actual proposals rescored with zero ranking changes; full original traces retained. Substantive appropriate response remains unestablished.'} : {}),
  ...(c.criterion===7 ? {evidence:'Residual regressions, saved-trace checker, unit tests, build and Pages artifact checks: see current report. No new browser inference/timing measured for this scoring fix. Full feature acceptance incomplete; merged deployment/public-origin remains future post-merge work.'} : {})
}));
const result={hypothesis:'Absolute trajectory residual reduction after matched baseline motion; root/direct-chain ownership and caps retained',
  provenance:{kind:'Offline rescoring of immutable actual ONNX traces; no new inference or timing measurement',
    traceFile:'interaction-response-quality-traces.json.gz',traceSha256:createHash('sha256').update(traceBytes).digest('hex'),
    capturedAt:summary.capturedAt,capturedRuntimeSourceSha256:summary.runtimeSourceSha256},
  runtimeSourceSha256,sevenCriterionMatrix,
  counts:{sequences,proposals,samples},rankingChanges,impact,reviewRegression,windows};
const resultPath=new URL('../docs/interaction-residual-validation.json',import.meta.url);
if(process.argv.includes('--write')) await writeFile(resultPath,JSON.stringify(result,null,2)+'\n');
else assert.ok(JSON.stringify(JSON.parse(await readFile(resultPath,'utf8')))===JSON.stringify(result),
  'Saved residual evidence matches current source and original traces');
console.log(JSON.stringify({sourceHashes:Object.keys(runtimeSourceSha256).length,sequences,proposals,samples,rankingChanges,impact},null,2));
