// Actual pointer trajectories and real WebGPU inference in the main workflow.
// Keep causal conditioning comparisons in interaction-conditioning.mjs.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {verifiedModelCache} from './model-cache.mjs';
import model from '../model-source.json' with {type:'json'};
const output=new URL('../.artifacts/interaction/',import.meta.url);
await mkdir(output,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROME_BIN || undefined,headless:true,args:['--enable-unsafe-webgpu']});
const errors=[], cases=[];
const cache=process.env.MODEL_CACHE ? await verifiedModelCache(process.env.MODEL_CACHE,model) : undefined;
try {
  const page=await browser.newPage({viewport:{width:1280,height:850}});
  page.on('pageerror',e=>errors.push(e.message));
  const url=new URL('pose.html',process.env.DEMO_URL || 'http://127.0.0.1:5173/');url.searchParams.set('captureMotion','1');
  if(cache) {
    if(url.protocol==='https:') await page.context().grantPermissions(['local-network-access'],{origin:url.origin});
    await page.route(/mmm_v6_soma_fp32\.onnx$/,r=>r.fulfill({status:302,headers:{location:cache.url,'Access-Control-Allow-Origin':'*'}}));
  }
  // Test-only delayed delivery of genuine worker results works on both dev and
  // built origins. No runtime hooks or replacement inference data are needed.
  await page.addInitScript(()=> {
    const NativeWorker=window.Worker;
    window.Worker=class extends NativeWorker {
      constructor(url,options) {
        super(url,options);
        this.addEventListener('message',event=> {
          if(event.isTrusted && event.data.type==='result' && window.__motionTestDelay) {
            event.stopImmediatePropagation();window.__motionTestDelayedResults=(window.__motionTestDelayedResults || 0)+1;
            setTimeout(()=>this.dispatchEvent(new MessageEvent('message',{data:event.data})),window.__motionTestDelay);
          }
        },true);
      }
    };
  });
  await page.goto(url.href);
  const report=()=>page.locator('#diagnostics').textContent().then(JSON.parse);
  await page.waitForFunction(()=>document.querySelector('#diagnostics').textContent.includes('handles'));
  assert.equal((await report()).mode,'move','Direct Move is primary');
  await page.locator('#load').click();console.log('Loading real ONNX pointer test');
  await page.waitForFunction(()=>JSON.parse(document.querySelector('#diagnostics').textContent).generations>0,{},{timeout:900000});
  const runtime=await report();
  for(const [character,label] of [['soma','SOMA'],['animasa','Animasa Miku'],['mmd','CG-CA Uka']]) {
    await page.selectOption('#character',character);
    await page.waitForFunction(label=>JSON.parse(document.querySelector('#diagnostics').textContent).character===label,label);
    for(const joint of ['LeftHand','Hips']) {
      await page.locator('#reset').click();await page.waitForTimeout(300);
      const before=await report(), [x,y]=before.handles[joint].screen;
      await page.mouse.move(x,y);await page.mouse.down();await page.waitForTimeout(300);
      assert.equal((await report()).active,true);assert.equal((await report()).control.joint,joint,'Pick the requested joint');
      const started=(await report()).generations;
      // Forty updates with at least 75 ms spacing, including reversal. A
      // debounce/revision-on-every-move implementation would never accept here.
      for(let i=0;i<40;i++) {
        const t=i/39, amount=Math.sin(t*Math.PI*2);
        await page.mouse.move(x+amount*(joint==='Hips' ? 16 : 24),y-Math.sin(t*Math.PI)*16);
        await page.waitForTimeout(75);
      }
      const held=await report();
      assert.ok(held.generations>started+1,`${label} ${joint}: generation must continue during movement`);
      assert.equal(held.orbitEnabled,false);assert.equal(held.rejectedReason,undefined);
      await page.screenshot({path:new URL(`${character}-${joint}-held.png`,output).pathname});
      if(joint==='Hips') {await page.keyboard.press('Escape');await page.mouse.up();}
      else await page.mouse.up();
      await page.waitForTimeout(1300);
      const result=await report();
      assert.equal(result.active,false);assert.equal(result.orbitEnabled,true);
      assert.ok(result.generations>held.generations,'Generation continues on release');
      assert.equal(result.error,undefined);assert.equal(result.rejectedReason,undefined);
      const samples=result.displayedInteraction;
      const distance=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
      const maxStep=Math.max(...samples.slice(1).map((s,i)=>distance(s.displayed.root,samples[i].displayed.root)));
      assert.ok(maxStep<.12,`Root jump ${maxStep}`);
      const corrections=samples.flatMap(s=>s.directCorrection);
      assert.ok(corrections.every(c=>c.radians<=.45+1e-6),'Angular correction bound');
      // Opposite arm is never changed by hand direct IK. Pelvis contacts own legs.
      if(joint==='LeftHand') assert.ok(corrections.filter(c=>['Chest','RightHand','RightArm','Hips'].includes(c.joint)).every(c=>c.radians<1e-6));
      const summary={character:label,joint,generationsDuringMovement:held.generations-started,generationsAfterRelease:result.generations-held.generations,
        maxRootStep:maxStep,maxControlError:Math.max(...samples.filter(s=>s.held).map(s=>s.controlError)),
        maximumCorrectionRadians:Math.max(...corrections.map(c=>c.radians)),mmd:result.mmd};
      cases.push(summary);console.log(JSON.stringify(summary));
      await writeFile(new URL(`${character}-${joint}.json`,output),JSON.stringify(result));
    }
  }
  // A real inference result is delayed in this test only, to exercise underrun,
  // coalescing and reset while work is in flight without inventing model data.
  await page.selectOption('#character','soma');
  await page.waitForFunction(()=>JSON.parse(document.querySelector('#diagnostics').textContent).character==='SOMA');
  await page.locator('#reset').click();await page.waitForTimeout(300);
  await page.evaluate(()=>{window.__motionTestDelay=700;});
  const delayedBefore=await report(), [dx,dy]=delayedBefore.handles.LeftHand.screen;
  await page.mouse.move(dx,dy);await page.mouse.down();
  for(let i=0;i<35;i++) {await page.mouse.move(dx+Math.sin(i/8)*15,dy-10);await page.waitForTimeout(80);}
  const delayed=await report();assert.ok(delayed.generations>delayedBefore.generations);
  assert.ok(await page.evaluate(()=>window.__motionTestDelayedResults>0),'Real worker delivery was delayed');
  assert.equal(delayed.active,true);await page.mouse.up();
  // Wait until a fresh genuine result is explicitly held before delivery, then
  // reset inside that interval. This makes the stale-result assertion non-vacuous.
  const queued=await page.evaluate(()=>{window.__motionTestDelay=1500;return window.__motionTestDelayedResults;});
  await page.waitForFunction(n=>window.__motionTestDelayedResults>n,queued);
  const staleBefore=await report();
  await page.locator('#reset').click();await page.waitForTimeout(1700);
  const reset=await report();
  assert.ok(reset.discarded>staleBefore.discarded,'An actual old-revision result must be discarded after reset');
  assert.ok(reset.interactionSequences.every(s=>s.revision===reset.revision),'Stale inference cannot cross reset');
  cases.push({name:'700 ms delayed real inference',generationsDuringMovement:delayed.generations-delayedBefore.generations,
    staleResultDelayMs:1500,discardedAcrossReset:reset.discarded-staleBefore.discarded});
  await page.evaluate(()=>{window.__motionTestDelay=700;});
  // Rotation, pause, reset and stale work use the same gesture epoch boundary.
  await page.locator('#rotate').click();await page.locator('#reset').click();await page.waitForTimeout(300);
  const [x,y]=(await report()).handles.LeftHand.screen;
  await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+25,y-8,{steps:12});await page.waitForTimeout(800);
  assert.ok((await report()).control.rotation);await page.keyboard.press('Escape');await page.mouse.up();
  await page.locator('#pause').click();await page.waitForTimeout(400);
  const paused=(await report()).root;await page.waitForTimeout(400);assert.deepEqual((await report()).root,paused);
  await page.locator('#reset').click();await page.waitForTimeout(300);
  const fresh=await report();assert.equal(fresh.control,undefined);
  assert.deepEqual(errors,[]);
  await writeFile(new URL('browser-summary.json',output),JSON.stringify({result:'pass',origin:url.origin,onnxDelivery:cache ? 'SHA-256 verified local streaming cache' : 'application model URL',runtime:{runtime:runtime.runtime,gpu:runtime.gpu,loadMs:runtime.loadMs},cases,errors},null,2));
} catch(error) {
  await writeFile(new URL('browser-summary.json',output),JSON.stringify({result:'fail',cases,errors,failure:String(error)},null,2));throw error;
} finally {await browser.close();if(cache) await new Promise(r=>cache.server.close(r));}
