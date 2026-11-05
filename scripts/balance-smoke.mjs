// Push interaction checks; --model measures the actual pinned ONNX checkpoint.
// A failed capability experiment is recorded as limited, never a fake success.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import model from '../model-source.json' with {type:'json'};
const origin=process.env.DEMO_URL || 'http://127.0.0.1:5173/';
const realModel=process.argv.includes('--model');
const output=new URL('../.artifacts/balance/',import.meta.url);await mkdir(output,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROME_BIN || undefined,headless:true,args:['--enable-unsafe-webgpu']});
const cases=[], errors=[], loading=[];let passed=false;
const distance=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
function capability(r) {
  const raw=r.recoverySequences.flatMap(s=>s.rawTrace), first=raw[0], last=raw.at(-1);
  const floor=.072029;
  const maxFootLift=Math.max(...raw.flatMap(f=>[24,28].map(j=>f.joints[j][1]-floor)));
  const footTravel=[24,28].map(j=>Math.hypot(last.joints[j][0]-first.joints[j][0],last.joints[j][2]-first.joints[j][2]));
  const jointTravel=Object.fromEntries([['chest',3],['leftHand',13],['rightHand',19],['hips',0]].map(([name,j])=>[
    name,Math.max(...raw.map(f=>distance(f.joints[j],first.joints[j])))]));
  const settled=r.balance.phase==='stable' && last.tilt<.1 && last.margin>0 && last.contacts.every(c=>c.planted);
  return {settled,rawFrames:raw.length,firstTiltDegrees:first.tilt*180/Math.PI,lastTiltDegrees:last.tilt*180/Math.PI,
    maxFootLift,footTravel,jointTravel,minimumRawJointHeight:Math.min(...raw.flatMap(f=>f.joints.map(p=>p[1]))),
    rawFinalMargin:last.margin,displayFinalMargin:r.balance.margin,
    generatedStep:settled && maxFootLift>.035 && Math.max(...footTravel)>.12,
    maxContactCorrectionRadians:Math.max(0,...r.displayedRecoveryTrace.map(f=>f.correction.angle)),
    maxContactRootCorrectionMeters:Math.max(0,...r.displayedRecoveryTrace.map(f=>f.correction.root))};
}
try {
  const page=await browser.newPage({viewport:{width:1280,height:900}});
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(new URL('pose.html?captureMotion=1',origin).href);
  const report=()=>page.locator('#diagnostics').textContent().then(JSON.parse);
  await page.waitForFunction(()=>document.querySelector('#diagnostics').textContent.includes('handles'));
  assert.equal((await report()).mode,'push');
  await page.selectOption('#push-size','0.07');const initial=await report();
  await page.locator('#push-left').click();
  await page.waitForFunction(()=>JSON.parse(document.querySelector('#diagnostics').textContent).balance.phase==='recovering');
  const disturbed=await report();
  assert.equal(disturbed.generations,0);assert.equal(disturbed.balance.generated,false);
  assert.ok(disturbed.balance.tilt>initial.balance.tilt+.02);
  for(const joint of ['LeftFoot','RightFoot']) assert.ok(distance(initial.handles[joint].world,disturbed.handles[joint].world)<.015);
  await page.waitForTimeout(500);assert.equal((await report()).balance.phase,'recovering','No model means no claimed recovery');
  await page.locator('#reset').click();await page.waitForTimeout(300);
  // Hold and cancel a real torso grab, then reset before any old result can land.
  const [x,y]=(await report()).handles.Chest.screen;
  await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+45,y,{steps:10});
  await page.waitForFunction(()=>JSON.parse(document.querySelector('#diagnostics').textContent).balance.phase==='pushing');
  assert.equal((await report()).orbitEnabled,false);
  await page.screenshot({path:new URL('mouse-push.png',output).pathname});
  await page.keyboard.press('Escape');await page.mouse.up();
  await page.waitForFunction(()=>JSON.parse(document.querySelector('#diagnostics').textContent).balance.phase==='recovering');
  assert.equal((await report()).orbitEnabled,true);
  await page.locator('#reset').click();
  await page.locator('#generation-controls').evaluate(details=>{details.open=true;});
  if(realModel) {
    await page.locator('#load').click();let previous='',lastProgress=Date.now(),lastLog=0;
    for(;;) {
      const status=await page.locator('#status').textContent(),now=Date.now();
      if(status!==previous) {lastProgress=now;previous=status;loading.push({elapsed:now,status});}
      if(now-lastLog>30000){console.log(status);lastLog=now;}
      assert.ok(!(await report()).error,status);assert.ok(now-lastProgress<930000,`Stalled: ${status}`);
      if(status.includes('Model loaded')) break;
      await page.waitForTimeout(500);
    }
    // Cases exercise distinct perturbation sizes and directions, plus retargets.
    for(const [name,size,button,character] of [
      ['small-left','0.07','push-left','soma'],['medium-right','0.18','push-right','soma'],
      ['large-right','0.34','push-right','soma'],['large-forward','0.34','push-forward','soma'],
      ['animasa-small','0.07','push-left','animasa'],['animasa-large','0.34','push-right','animasa'],
      ['uka-small','0.07','push-left','mmd'],['uka-large','0.34','push-right','mmd'],['uka-back','0.34','push-back','mmd']]) {
      await page.selectOption('#character',character);
      await page.waitForFunction(value=>document.querySelector('#character-status').textContent!=='Loading character…' &&
        JSON.parse(document.querySelector('#diagnostics').textContent).character===value,
        character==='soma' ? 'SOMA' : character==='animasa' ? 'Animasa Miku' : 'CG-CA Uka');
      await page.locator('#reset').click();
      await page.waitForFunction(()=>{const r=JSON.parse(document.querySelector('#diagnostics').textContent);return r.balance.phase==='stable' && !r.lastRecovery;});
      await page.selectOption('#push-size',size);
      await page.locator(`#${button}`).click();
      await page.waitForFunction(()=>JSON.parse(document.querySelector('#diagnostics').textContent).balance.phase==='recovering');
      await page.waitForFunction(()=>JSON.parse(document.querySelector('#diagnostics').textContent).lastRecovery,{timeout:180000});
      if(!(await report()).balance.problem) {
        await page.waitForFunction(()=>{const r=JSON.parse(document.querySelector('#diagnostics').textContent), f=r.displayedRecoveryTrace.at(-1);
          return r.balance.problem || r.balance.attempts>1 || f?.generatedFrame>r.lastRecovery.rawTrace.length*.65;},{},{timeout:10000});
        await page.screenshot({path:new URL(`${name}-generated.png`,output).pathname});
      }
      const deadline=Date.now()+180000;
      for(;;) {
        const r=await report();assert.equal(r.error,undefined);
        if(r.lastRecovery && (r.balance.problem || r.balance.phase==='stable')) break;
        assert.ok(Date.now()<deadline,`${name} did not finish bounded feasibility attempt`);
        await page.waitForTimeout(150);
      }
      const result=await report();
      assert.ok(result.recoverySequences.length>0);assert.ok(result.lastRecovery.rawTrace.length>=18);
      assert.equal(result.lastRecovery.modelRevision.sha256,model.sha256);
      assert.ok(result.recoverySequences.every(s=>s.rawTrace.every(f=>f.root.every(Number.isFinite))));
      if(character!=='soma'){assert.ok(result.mmd.steps>0);assert.ok(result.mmd.allocations>0);}
      // Capture evidence even when raw motion is rejected; rejection is a model
      // feasibility finding, not a browser integration failure.
      cases.push({name,capability:capability(result),report:result});
      await writeFile(new URL(`${name}.json`,output),JSON.stringify(result,(_key,v)=>typeof v==='number' ? Math.round(v*1e6)/1e6 : v,2));
      await page.screenshot({path:new URL(`${name}.png`,output).pathname});
      console.log(JSON.stringify({name,phase:result.balance.phase,problem:result.balance.problem,
        attempts:result.balance.attempts,rawFrames:result.lastRecovery.rawTrace.length,displayedFrames:result.displayedRecoveryTrace.length}));
    }
    assert.ok(cases.some(c=>c.name==='small-left' && c.capability.settled),'No raw small-push recovery was verified');
    assert.ok(cases.some(c=>c.name.startsWith('large-') && c.capability.generatedStep),'No raw generated step and settling was verified');
    // Repeat a push during inference/playback, then switch/reset: obsolete work
    // must not resume generation in a stable new character session.
    await page.locator('#reset').click();await page.locator('#push-left').click();await page.waitForTimeout(500);
    await page.locator('#push-right').click();await page.waitForTimeout(300);await page.selectOption('#character','soma');
    await page.locator('#reset').click();await page.waitForTimeout(1000);
    assert.equal((await report()).balance.phase,'stable');assert.equal((await report()).balance.generated,false);
    await page.locator('#pause').click();
  } else {
    for(const [character,label] of [['animasa','Animasa Miku'],['mmd','CG-CA Uka']]) {
      await page.selectOption('#character',character);
      await page.waitForFunction(label=>JSON.parse(document.querySelector('#diagnostics').textContent).character===label,label);
      await page.locator('#reset').click();await page.waitForTimeout(300);const before=await report();
      await page.selectOption('#push-size','0.34');await page.locator('#push-right').click();
      await page.waitForFunction(()=>JSON.parse(document.querySelector('#diagnostics').textContent).balance.phase==='recovering');
      const after=await report();assert.ok(distance(before.handles.Chest.world,after.handles.Chest.world)>.08);
      assert.equal(after.balance.needsStep,true);assert.equal(after.generations,0);
      assert.ok(after.mmd.steps>0);cases.push({name:character,report:after});
    }
    await page.selectOption('#character','soma');await page.waitForTimeout(500);
    await page.route(/mmm_v6_soma_fp32\.onnx$/,route=>route.fulfill({status:404,body:'Missing weights'}));
    await page.locator('#load').click();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('HTTP 404'));
    assert.ok(await page.locator('#load').isEnabled());
  }
  await page.locator('#reset').click();
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(300);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.ok(await page.locator('#push-right').isVisible());
  await page.screenshot({path:new URL('mobile.png',output).pathname});
  assert.deepEqual(errors,[]);passed=true;
} finally {
  await writeFile(new URL(realModel ? 'model-report.json' : 'smoke-report.json',output),JSON.stringify({
    result:passed ? 'pass' : 'fail',realModel,model,cases,errors,loading},null,2));
  await browser.close();
}
