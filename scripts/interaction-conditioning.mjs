// Opt-in real ONNX causal comparison. Dev origin supplies runtime TS modules;
// measurements are canonical SOMA, before retargeting, contact physics or seams.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {verifiedModelCache} from './model-cache.mjs';
import model from '../model-source.json' with {type:'json'};
const output=new URL('../.artifacts/interaction/',import.meta.url);
await mkdir(output,{recursive:true});
const cache=await verifiedModelCache(process.env.MODEL_CACHE || new URL('../public/assets/mmm_v6_soma_fp32.onnx',import.meta.url),model);
const browser=await chromium.launch({executablePath:process.env.CHROME_BIN || undefined,headless:true,args:['--enable-unsafe-webgpu']});
try {
  const page=await browser.newPage();
  page.on('pageerror',e=>console.error(e.message));
  await page.goto(new URL('pose.html',process.env.DEMO_URL || 'http://127.0.0.1:5173/').href);
  console.log('Loading real ONNX conditioning test');
  const result=await page.evaluate(async ({url,model})=> {
    const [{SomaAvatar},{Inference},m,{PoseIK},interaction]=await Promise.all([
      import('/src/avatar.ts'),import('/src/inference.ts'),import('/src/motion.ts'),import('/src/pose-ik.ts'),import('/src/interaction.ts')]);
    const {InteractionResponse,encodeInteraction,jointChanges,serializePose}=interaction;
    const avatar=await SomaAvatar.load('/assets/soma.glb'), inference=new Inference();
    const runtime=await inference.load(url), {rig,stance}=avatar, ik=new PoseIK(rig,stance), points=m.positions(stance,rig), cases=[];
    const run=async (name,joint,offset,velocity,strategy='sparse',frames=4,leadSeconds=.5)=> {
      const response=new InteractionResponse(stance);
      if(joint) {
        const target=points[m.JOINTS.indexOf(joint)].clone().fromArray(offset).add(points[m.JOINTS.indexOf(joint)]);
        const previous=target.clone().addScaledVector(target.clone().fromArray(velocity),-.1);
        response.begin(joint,previous,undefined,0);response.update(target,undefined,100);
      }
      const request=response.request(1);
      let encoded=encodeInteraction(request,rig,1,frames,leadSeconds);
      if(strategy==='static IK-completed') {
        const goal=ik.solve(stance,{joint,target:response.control.position});
        encoded=m.encode(request.context,Array.from({length:4},()=>m.clonePose(goal)),rig);
        encoded.features.allowed_pred_num_tokens.fill(0);encoded.features.allowed_pred_num_tokens[0]=1;
      }
      const generated=await inference.run(encoded.features), raw=m.decode(generated.data,generated.tokens,encoded.placement);
      const corrected=raw.map(p=>response.control ? ik.direct(p,{joint,target:response.control.position},joint==='Hips'
        ? [{joint:'LeftFoot',target:points[24]},{joint:'RightFoot',target:points[28]}] : []) : m.clonePose(p));
      const c={name,joint,strategy,frames,leadSeconds,context:request.context.map(serializePose),neutralTargets:request.targets.map(serializePose),
        control:response.control,features:Object.fromEntries(Object.entries(encoded.features).map(([k,v])=>[k,Array.from(v)])),
        rawMotion:raw.map(serializePose),perJointRawChange:jointChanges(raw[0],raw.at(-1),rig),
        rootTravel:raw[0].root.distanceTo(raw.at(-1).root),milliseconds:generated.milliseconds,tokens:generated.tokens,
        // This unbounded direct-solver comparison measures ownership. The actual
        // display additionally caps each correction at .45 rad / .08 m.
        perFrameDirectCorrection:raw.map((p,i)=>jointChanges(p,corrected[i],rig)),
        rawControlError:joint ? raw.map(p=>m.positions(p,rig)[m.JOINTS.indexOf(joint)].distanceTo(response.control.position)) : [],
        ikOnly:response.control ? serializePose(ik.direct(stance,{joint,target:response.control.position})) : serializePose(stance)};
      cases.push(c);
      return raw;
    };
    try {
      const baseline=await run('no-drag');
      const repeat=await run('no-drag-repeat');
      const up=await run('hand-up','LeftHand',[.03,.10,-.06],[0,.5,-.2]);
      const reversed=await run('hand-reversed','LeftHand',[.03,.10,-.06],[0,-.5,.2]);
      const down=await run('hand-down','LeftHand',[-.03,-.10,.06],[0,-.5,.2]);
      const staticIK=await run('hand-static-IK','LeftHand',[.03,.10,-.06],[0,0,0],'static IK-completed');
      const near=await run('hand-near-horizon','LeftHand',[.03,.10,-.06],[0,.5,-.2],'sparse',4,1/30);
      const maskOne=await run('hand-one-target-frame','LeftHand',[.03,.10,-.06],[0,.5,-.2],'sparse',1);
      const left=await run('pelvis-left','Hips',[-.10,-.03,0],[-.5,0,0]);
      const right=await run('pelvis-right','Hips',[.10,-.03,0],[.5,0,0]);
      const compare=(name,a,b)=>({name,perJointMeanDifference:m.JOINTS.map((joint,j)=> {
        const differences=a.map((p,i)=>jointChanges(p,b[Math.min(i,b.length-1)],rig)[j]);
        return {joint,meters:differences.reduce((s,d)=>s+d.meters,0)/a.length,radians:differences.reduce((s,d)=>s+d.radians,0)/a.length,
          rootRelativeMeters:differences.reduce((s,d)=>s+d.rootRelativeMeters,0)/a.length,localRadians:differences.reduce((s,d)=>s+d.localRadians,0)/a.length};
      })});
      return {model,runtime,cases,comparisons:[compare('repeat noise',baseline,repeat),compare('hand up vs no drag',up,baseline),
        compare('same endpoint reversed velocity',up,reversed),compare('hand up vs down',up,down),compare('sparse vs static IK',up,staticIK),
        compare('target timing .5s vs .033s',up,near),compare('four vs one target frames',up,maskOne),compare('pelvis left vs right',left,right)]};
    } finally {inference.dispose();avatar.dispose();}
  },{url:cache.url,model});
  assert.equal(result.cases.length,10);
  const comparison=name=>result.comparisons.find(c=>c.name===name).perJointMeanDifference;
  assert.ok(comparison('repeat noise').every(j=>j.meters<1e-4),'No-drag repeat must bound numerical noise');
  assert.ok(comparison('hand up vs down').find(j=>j.joint==='RightHand').rootRelativeMeters>.005,'Distinct hand trajectories must affect the uncontrolled arm above repeat noise');
  assert.ok(comparison('pelvis left vs right').find(j=>j.joint==='RightHand').rootRelativeMeters>.01,'Pelvis influence must exceed rigid translation');
  await writeFile(new URL('conditioning.json',output),JSON.stringify(result));
  const summary={runtime:result.runtime,cases:result.cases.map(({name,milliseconds,tokens,rootTravel,perJointRawChange,rawControlError})=>
    ({name,milliseconds,tokens,rootTravel,perJointRawChange,rawControlError})),comparisons:result.comparisons};
  await writeFile(new URL('conditioning-summary.json',output),JSON.stringify(summary,null,2));
  console.log(JSON.stringify({cases:summary.cases.map(c=>({name:c.name,milliseconds:c.milliseconds,rootTravel:c.rootTravel})),
    comparisons:summary.comparisons.map(c=>({name:c.name,otherArm:c.perJointMeanDifference.find(j=>j.joint==='RightHand'),chest:c.perJointMeanDifference.find(j=>j.joint==='Chest')}))},null,2));
} catch(error) {
  await writeFile(new URL('conditioning-summary.json',output),JSON.stringify({result:'fail',error:String(error)}));throw error;
} finally {await browser.close();await new Promise(r=>cache.server.close(r));}
