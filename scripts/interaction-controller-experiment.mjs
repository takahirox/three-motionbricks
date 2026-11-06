// Paired bounded controller trial; same trajectories/history clock as the prior
// continuation. All proposals come from one SHA-verified real ONNX session.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import {chromium} from 'playwright';
import {verifiedModelCache} from './model-cache.mjs';
import model from '../model-source.json' with {type:'json'};
const output=new URL('../.artifacts/interaction-response-quality/',import.meta.url);
await mkdir(output,{recursive:true});
const cache=await verifiedModelCache(process.env.MODEL_CACHE || new URL('../public/assets/mmm_v6_soma_fp32.onnx',import.meta.url),model);
const browser=await chromium.launch({executablePath:process.env.CHROME_BIN || undefined,headless:true,args:['--enable-unsafe-webgpu']});
const errors=[];
try {
  const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(new URL('pose.html',process.env.DEMO_URL || 'http://127.0.0.1:5173/').href);
  console.log('Loading verified checkpoint for paired controller trial');
  const result=await page.evaluate(async ({url,model})=> {
    const [{SomaAvatar},{Inference},m,{PoseIK},it,{InteractionController},{boundedCorrection}]=await Promise.all([
      import('/src/avatar.ts'),import('/src/inference.ts'),import('/src/motion.ts'),import('/src/pose-ik.ts'),
      import('/src/interaction.ts'),import('/src/interaction-controller.ts'),import('/src/pose-response.ts')]);
    const avatar=await SomaAvatar.load('/assets/soma.glb'), inference=new Inference();
    const loadStarted=performance.now(),runtime=await inference.load(url),loadMilliseconds=performance.now()-loadStarted,{stance,rig}=avatar,ik=new PoseIK(rig,stance),points=m.positions(stance,rig),rollouts=[];
    const {InteractionResponse,serializePose,jointChanges}=it;
    try {
      for(const joint of ['LeftHand','Hips']) for(const strategy of ['single','selection']) for(const [trajectory,sign] of [['no-drag',0],['up',1],['down',-1]]) {
        const response=new InteractionResponse(stance),controller=new InteractionController(),sequences=[],displayed=[],ikOnly=[];
        const index=m.JOINTS.indexOf(joint);let target=points[index].clone();
        if(sign) response.begin(joint,target,undefined,0);
        const support=joint==='Hips' ? [{joint:'LeftFoot',target:points[24]},{joint:'RightFoot',target:points[28]}] : [];
        for(let frame=0;frame<150;frame++) {
          const t=frame/30,now=frame*1000/30;
          if(sign && frame<90) {
            const offset=joint==='LeftHand' ? [.06*Math.sin(t*2*Math.PI/3),.15*Math.sin(t*Math.PI/1.5),-.12*Math.sin(t*2*Math.PI/3)]
              : [.10*Math.sin(t*2*Math.PI/3),-.03*Math.sin(t*Math.PI/3),.03*Math.sin(t*2*Math.PI/3)];
            target=points[index].clone().add(points[index].clone().fromArray(offset).multiplyScalar(sign));response.update(target,undefined,now);
          }
          if(sign && frame===90) response.release(now);
          const direct=p=>boundedCorrection(p,ik.direct(p,{joint,target},support),.45,.08);
          const constrain=p=>sign && response.control ? m.blendPose(p,direct(p),response.correctionWeight) : p;
          if(frame<90) response.pose=constrain(response.pose);
          if(response.remaining<.12) {
            const request=response.request(1),batch=await controller.select(request,rig,1,f=>inference.run(f),()=>true,{single:strategy==='single'});
            sequences.push({requestedAt:now,context:request.context.map(serializePose),neutralTargets:request.targets.map(serializePose),control:request.control,controls:request.controls,
              milliseconds:batch.milliseconds,selectionMilliseconds:batch.selectionMilliseconds,degraded:batch.degraded,selected:batch.selected?.index,
              candidates:batch.candidates.map(c=>({index:c.index,variant:c.variant,quality:c.quality,inferenceMilliseconds:c.result.milliseconds,deliveryMilliseconds:c.deliveryMilliseconds,
                features:Object.fromEntries(Object.entries(c.encoded.features).map(([k,v])=>[k,Array.from(v)])),rawMotion:c.segment.map(serializePose),
                contacts:c.segment.map((_,i)=>Array.from(c.result.data.subarray((i+3)*366+362,(i+4)*366)))}))});
            if(batch.selected) response.accept(batch.selected.segment,request.revision);
          }
          const playerBefore=response.pose;
          let beforeCorrection;
          response.advance(1/30,true,p=>{beforeCorrection=m.clonePose(p);return constrain(p);});
          displayed.push({frame,pose:serializePose(response.pose),player:serializePose(beforeCorrection ?? playerBefore),held:frame<90 && !!sign,
            controlError:sign && frame<90 ? m.positions(response.pose,rig)[index].distanceTo(target) : 0,
            directCorrection:jointChanges(beforeCorrection ?? playerBefore,response.pose,rig)});
          ikOnly.push(serializePose(sign && frame<90 ? direct(stance) : stance));
        }
        rollouts.push({joint,strategy,trajectory,sequences,displayed,ikOnly});
      }
      return {hypothesis:'Matched no-control proposal and model-owned trajectory residual reduction, no activity reward',loadMilliseconds,capturedAt:new Date().toISOString(),model,runtime,rig:{parents:rig.parents,offsets:rig.offsets.map(v=>v.toArray())},rollouts};
    } finally {inference.dispose();avatar.dispose();}
  },{url:cache.url,model});
  assert.deepEqual(errors,[]);assert.equal(result.rollouts.length,12);
  assert.ok(result.rollouts.every(r=>r.displayed.length===150));
  await writeFile(new URL('traces.json.gz',output),gzipSync(JSON.stringify(result),{level:9}));
  console.log(JSON.stringify({rollouts:result.rollouts.map(r=>({joint:r.joint,strategy:r.strategy,trajectory:r.trajectory,
    generations:r.sequences.length,selectedSecond:r.sequences.filter(s=>s.selected===1).length,
    maxError:Math.max(...r.displayed.map(s=>s.controlError)),rejected:r.sequences.filter(s=>s.selected===undefined).length}))},null,2));
} finally {await browser.close();await new Promise(r=>cache.server.close(r));}
