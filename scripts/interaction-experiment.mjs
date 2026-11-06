// Bounded exploration of the pinned checkpoint's existing frame/feature masks.
// This is raw inference evidence, not a replacement for real pointer validation.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import {chromium} from 'playwright';
import {verifiedModelCache} from './model-cache.mjs';
import model from '../model-source.json' with {type:'json'};

const output=new URL('../.artifacts/interaction-experiment/',import.meta.url);
await mkdir(output,{recursive:true});
const cache=await verifiedModelCache(process.env.MODEL_CACHE || new URL('../public/assets/mmm_v6_soma_fp32.onnx',import.meta.url),model);
const browser=await chromium.launch({executablePath:process.env.CHROME_BIN || undefined,headless:true,args:['--enable-unsafe-webgpu']});
const errors=[];
try {
  const page=await browser.newPage();
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(new URL('pose.html',process.env.DEMO_URL || 'http://127.0.0.1:5173/').href);
  console.log('Loading verified ONNX for bounded conditioning experiment');
  const result=await page.evaluate(async ({url,model})=> {
    const [{SomaAvatar},{Inference},m,{PoseIK},it,{responseProblem,boundedCorrection}]=await Promise.all([
      import('/src/avatar.ts'),import('/src/inference.ts'),import('/src/motion.ts'),import('/src/pose-ik.ts'),
      import('/src/interaction.ts'),import('/src/pose-response.ts')]);
    const avatar=await SomaAvatar.load('/assets/soma.glb'), inference=new Inference();
    const {stance,rig}=avatar, ik=new PoseIK(rig,stance), points=m.positions(stance,rig), cases=[],comparisons=[];
    const {InteractionResponse,encodeInteraction,serializePose,jointChanges}=it;
    const runtime=await inference.load(url);
    const variants=[
      {name:'standing-context',observed:false},
      {name:'observed-context',observed:true},
      {name:'one-target',observed:true,frames:1},
      {name:'free-root',observed:true,root:false},
      {name:'no-pose-target',observed:true,pose:false},
      {name:'context-only',observed:true,pose:false,root:false},
      {name:'longer-segment',observed:true,tokens:10},
      {name:'jitter-fit',observed:true,jitter:true},
      {name:'jitter-event',observed:true,jitter:true,eventVelocity:true},
    ];
    const compare=(name,a,b)=>({name,perJointMeanDifference:m.JOINTS.map((joint,j)=> {
      const d=a.map((p,i)=>jointChanges(p,b[Math.min(i,b.length-1)],rig)[j]);
      return {joint,...Object.fromEntries(['meters','rootRelativeMeters','radians','localRadians'].map(k=>[k,d.reduce((s,c)=>s+c[k],0)/d.length]))};
    })});
    try {
      const byVariant=new Map();
      for(const variant of variants) {
        const outputs=[];
        for(const [name,sign] of [['no-drag',0],['hand-up',1],['hand-down',-1]]) {
          const response=new InteractionResponse(stance);
          if(sign) {
            response.begin('LeftHand',points[13],undefined,0);
            // Actual minimal hand-chain IK history, with four distinct 30 Hz
            // samples. No unselected-body goals or authored reaction poses.
            for(let frame=1;frame<=4;frame++) {
              const target=points[13].clone().add(points[13].clone().set(.03,.10,-.06).multiplyScalar(sign*frame/4));
              response.update(target,undefined,frame*1000/30);
              if(variant.observed) response.pose=ik.direct(stance,{joint:'LeftHand',target});
              response.advance(1/30,false);
            }
            if(variant.jitter) response.update(response.control.position.clone().add(points[13].clone().set(0,-sign*.001,0)),undefined,4000/30+1);
          }
          const request=response.request(1), tokens=variant.tokens ?? 6;
          if(variant.eventVelocity) request.controls=[];
          const encoded=encodeInteraction(request,rig,1,variant.frames ?? 4,(tokens*4-9)/30);
          if(variant.pose===false) encoded.features.has_local_poses.fill(0,4);
          if(variant.root===false) {
            encoded.features.has_global_root_values.fill(0,4);
            encoded.features.has_local_root_values.fill(0,4);
          }
          encoded.features.allowed_pred_num_tokens.fill(0);encoded.features.allowed_pred_num_tokens[tokens-6]=1;
          const generated=await inference.run(encoded.features), raw=m.decode(generated.data,generated.tokens,encoded.placement);
          const corrected=raw.map(p=>sign ? ik.direct(p,{joint:'LeftHand',target:response.control.position}) : m.clonePose(p));
          cases.push({name:`${variant.name}/${name}`,variant,trajectory:name,milliseconds:generated.milliseconds,tokens:generated.tokens,
            context:request.context.map(serializePose),neutralTargets:request.targets.map(serializePose),control:response.control,controls:request.controls,
            features:Object.fromEntries(Object.entries(encoded.features).map(([k,v])=>[k,Array.from(v)])),
            rawMotion:raw.map(serializePose),problem:responseProblem(raw,rig),
            perJointRawChange:jointChanges(raw[0],raw.at(-1),rig),rootTravel:raw[0].root.distanceTo(raw.at(-1).root),
            rawControlError:sign ? raw.map(p=>m.positions(p,rig)[13].distanceTo(response.control.position)) : [],
            perFrameDirectCorrection:raw.map((p,i)=>jointChanges(p,corrected[i],rig))});
          outputs.push(raw);
        }
        comparisons.push(compare(`${variant.name}: up vs no-drag`,outputs[1],outputs[0]),
          compare(`${variant.name}: up vs down`,outputs[1],outputs[2]));
        byVariant.set(variant.name,outputs);
      }
      comparisons.push(compare('same jitter: fitted vs event velocity',byVariant.get('jitter-fit')[1],byVariant.get('jitter-event')[1]));
      const rollouts=[];
      for(const strategy of ['current','free-root','context-only','context-only-arm-allowance','one-target-free-root','alternating-target','no-pose-target']) {
        const outputs=[];
        for(const [name,sign] of [['no-drag',0],['hand-up',1],['hand-down',-1]]) {
          const response=new InteractionResponse(stance), sequences=[],displayed=[],ikOnly=[],rawOutput=[];
          let target=points[13].clone(), generationFrame=-1;
          if(sign) response.begin('LeftHand',target,undefined,0);
          let maxError=0,problem;
          for(let frame=0;frame<150;frame++) {
            const now=frame*1000/30,t=frame/30;
            if(sign && frame<90) {
              target=points[13].clone().add(points[13].clone().set(.06*Math.sin(t*2*Math.PI/3),.15*Math.sin(t*Math.PI/1.5),-.12*Math.sin(t*2*Math.PI/3)).multiplyScalar(sign));
              response.update(target,undefined,now);
            }
            if(sign && frame===90) response.release(now);
            const constrain=p=>sign && response.control ? m.blendPose(p,boundedCorrection(p,ik.direct(p,{joint:'LeftHand',target}),strategy==='context-only-arm-allowance' ? .9 : .45,.08),response.correctionWeight) : p;
            if(frame<90) response.pose=constrain(response.pose);
            if(response.remaining<.12) {
              const request=response.request(1), encoded=encodeInteraction(request,rig,1,strategy==='one-target-free-root' ? 1 : 4);
              if(strategy!=='current' && strategy!=='no-pose-target') {
                encoded.features.has_global_root_values.fill(0,4);encoded.features.has_local_root_values.fill(0,4);
              }
              if(strategy.startsWith('context-only') || strategy==='no-pose-target' || strategy==='alternating-target' && sequences.length%2===0)
                encoded.features.has_local_poses.fill(0,4);
              const generated=await inference.run(encoded.features), raw=m.decode(generated.data,generated.tokens,encoded.placement);
              rawOutput.push(...raw);
              problem=responseProblem(raw,rig);
              sequences.push({requestedAt:now,control:request.control,controls:request.controls,context:request.context.map(serializePose),
                neutralTargets:request.targets.map(serializePose),features:Object.fromEntries(Object.entries(encoded.features).map(([k,v])=>[k,Array.from(v)])),
                rawMotion:raw.map(serializePose),milliseconds:generated.milliseconds,tokens:generated.tokens,problem});
              if(problem) break;
              response.accept(raw,request.revision);generationFrame=0;
            }
            // The experiment holds simulated 30 Hz time during real inference;
            // latency/stale delivery is tested by actual browser pointer tests.
            response.advance(1/30,true,constrain);generationFrame++;
            const p=m.clonePose(response.pose);
            displayed.push({frame,generation:sequences.length,generatedFrame:generationFrame,pose:serializePose(p),held:frame<90 && !!sign,
              controlError:sign && frame<90 ? m.positions(p,rig)[13].distanceTo(target) : 0});
            ikOnly.push(serializePose(sign && frame<90 ? ik.direct(stance,{joint:'LeftHand',target}) : stance));
            if(sign && frame<90) maxError=Math.max(maxError,m.positions(p,rig)[13].distanceTo(target));
          }
          outputs.push(rawOutput);
          rollouts.push({strategy,trajectory:name,sequences,displayed,ikOnly,maxError,problem});
        }
        comparisons.push(compare(`${strategy} continuous: raw up vs no-drag`,outputs[1],outputs[0]),
          compare(`${strategy} continuous: raw up vs down`,outputs[1],outputs[2]));
      }
      return {capturedAt:new Date().toISOString(),source:'Real pinned ONNX; isolated conditioning plus fixed-step continuous experiments; not rendered pointer or latency evidence',model,runtime,cases,comparisons,rollouts};
    } finally {inference.dispose();avatar.dispose();}
  },{url:cache.url,model});
  assert.deepEqual(errors,[]);
  assert.equal(result.cases.length,27);
  assert.equal(result.rollouts.length,21);
  assert.ok(result.rollouts.every(r=>r.displayed.length===150 && !r.problem),'Each bounded rollout must finish; inspect any rejected raw output');
  await writeFile(new URL('traces.json.gz',output),gzipSync(JSON.stringify(result),{level:9}));
  const {cases,rollouts,...rest}=result;
  const summary={...rest,cases:cases.map(({context,neutralTargets,control,controls,features,rawMotion,perFrameDirectCorrection,...c})=>c),
    rollouts:rollouts.map(({sequences,displayed,ikOnly,...c})=>({...c,generations:sequences.length,frames:displayed.length,
      maxRootStep:Math.max(0,...displayed.slice(1).map((s,i)=>Math.hypot(...s.pose.root.map((v,j)=>v-displayed[i].pose.root[j]))))}))};
  await writeFile(new URL('summary.json',output),JSON.stringify(summary,null,2)+'\n');
  console.log(JSON.stringify({cases:summary.cases.map(({name,tokens,milliseconds,rootTravel,problem})=>({name,tokens,milliseconds,rootTravel,problem})),
    comparisons:summary.comparisons.map(c=>({name:c.name,rightHand:c.perJointMeanDifference.find(j=>j.joint==='RightHand'),chest:c.perJointMeanDifference.find(j=>j.joint==='Chest')}))},null,2));
} finally {await browser.close();await new Promise(r=>cache.server.close(r));}
