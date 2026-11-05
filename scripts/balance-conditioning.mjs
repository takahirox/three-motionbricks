// Opt-in causal comparison using real ONNX and the runtime controller at fixed
// 30 Hz. This does not render/retarget the measured controller, or replace the
// separate demo/public-origin interaction and inference checks.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {verifiedModelCache} from './model-cache.mjs';
import model from '../model-source.json' with {type:'json'};
const output=new URL('../.artifacts/balance-followup/conditioning/',import.meta.url);
await mkdir(output,{recursive:true});
const cache=await verifiedModelCache(process.env.MODEL_CACHE || new URL('../public/assets/mmm_v6_soma_fp32.onnx',import.meta.url),model);
const browser=await chromium.launch({executablePath:process.env.CHROME_BIN || undefined,headless:true,args:['--enable-unsafe-webgpu']});
const errors=[];
try {
  const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.exposeFunction('recordConditioningCase',async c=> {
    await writeFile(new URL(`${c.name}-${c.strategy.replaceAll(' ','-')}.json`,output),JSON.stringify(c,null,2));
    console.log(JSON.stringify({name:c.name,strategy:c.strategy,phase:c.phase,attempts:c.attempts,
      rawSettled:c.rawSettled,rawFinalMargin:c.rawFinalMargin,rawFinalFootHeights:c.rawFinalFootHeights,problem:c.problem}));
  });
  // Dev origin is required for direct imports of the same runtime TS modules.
  await page.goto(new URL('pose.html',process.env.DEMO_URL || 'http://127.0.0.1:5173/').href);
  const result=await page.evaluate(async ({url,model})=> {
    const [{SomaAvatar},{Inference},{PoseIK},{BalanceRecovery,recoveryTrace},motion]=await Promise.all([
      import('/src/avatar.ts'),import('/src/inference.ts'),import('/src/pose-ik.ts'),
      import('/src/balance.ts'),import('/src/motion.ts')]);
    const avatar=await SomaAvatar.load('/assets/soma.glb'), inference=new Inference();
    const runtime=await inference.load(url), cases=[];
    const serialize=pose=>({root:pose.root.toArray(),rotations:pose.rotations.map(q=>q.toArray())});
    try {
      for(const [name,direction] of [['forward',[0,0,-.34]],['back',[0,0,.34]],['right',[.34,0,0]]]) {
        for(const strategy of ['fixed landing','observed landing']) {
          const balance=new BalanceRecovery(avatar.stance,avatar.rig,new PoseIK(avatar.rig,avatar.stance));
          let now=0,steps=0,fixedLanding;
          const sequences=[];
          balance.begin(now);
          for(let frame=1;frame<=8;frame++) {
            now=frame*1000/30;
            balance.push(avatar.stance.root.clone().fromArray(direction).multiplyScalar(frame/8),now);
            balance.advance(1/30,false);
          }
          balance.release(now);
          while(balance.phase==='recovering' && !balance.problem && steps++<900) {
            now+=1000/30;
            // Both variants drain playback before the next request and hold
            // controller time while awaiting inference. Context consists of
            // actual corrected controller frames, never goals or a synthetic
            // recovery. This isolates conditioning from wall-clock sampling.
            if(balance.response.remaining===0 && balance.ready(now)) {
              const request=balance.request();
              if(balance.attempts===1) fixedLanding=request.targets.map(motion.clonePose);
              if(strategy==='fixed landing' && balance.attempts>=2) request.targets=fixedLanding.map(motion.clonePose);
              const {features,placement}=motion.encode(request.context,request.targets,avatar.rig);
              const generated=await inference.run(features), segment=motion.decode(generated.data,generated.tokens,placement);
              const rawTrace=recoveryTrace(segment,avatar.rig,request.context[3],balance.floor);
              sequences.push({context:request.context.map(serialize),targets:request.targets.map(serialize),rawMotion:segment.map(serialize),rawTrace,
                predictedFootContacts:segment.map((_,i)=>Array.from(generated.data.subarray((i+3)*366+362,(i+4)*366))),
                milliseconds:generated.milliseconds,tokens:generated.tokens});
              balance.accept(segment,request.revision,now);
            }
            balance.advance(1/30,true);
          }
          const raw=sequences.flatMap(s=>s.rawTrace),tail=sequences.at(-1).rawTrace.slice(-12),last=raw.at(-1);
          const speed=Math.max(...tail.slice(1).map((f,i)=>Math.hypot(...f.com.map((v,j)=>v-tail[i].com[j]))*30));
          const rawSettled=tail.length===12 && speed<.07 && tail.every(f=>f.tilt<.1 && f.margin>.005 && f.contacts.every(c=>c.planted));
          cases.push({name,strategy,phase:balance.phase,problem:balance.problem,attempts:balance.attempts,rawSettled,
            rawFinalMargin:last.margin,rawTailMaximumSpeed:speed,rawFinalContacts:last.contacts,
            rawFinalFootHeights:[24,28].map((j,i)=>last.joints[j][1]-balance.floor[i]),
            maxRawFootLift:Math.max(...raw.flatMap(f=>[24,28].map((j,i)=>f.joints[j][1]-balance.floor[i]))),
            footTravel:[24,28].map(j=>Math.hypot(last.joints[j][0]-raw[0].joints[j][0],last.joints[j][2]-raw[0].joints[j][2])),
            corrected:balance.metrics(),sequences,controllerTrace:balance.displayedTrace});
          await window.recordConditioningCase(cases.at(-1));
        }
      }
      return {result:'experiment completed; inspect per-case capability',capturedAt:new Date().toISOString(),source:'Fresh real ONNX; fixed-step controller experiment; not rendered demo evidence',
        predictedFootContactOrder:['left heel','left toe','right heel','right toe'],
        model,runtime,cases};
    } finally {inference.dispose();avatar.dispose();}
  },{url:cache.url,model});
  await writeFile(new URL('report.json',output),JSON.stringify({...result,errors},null,2));
  assert.deepEqual(errors,[]);
  assert.equal(result.cases.length,6);
} finally {await browser.close();await new Promise(resolve=>cache.server.close(resolve));}
