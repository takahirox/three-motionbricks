// Run against dev or production preview. --model exercises real ONNX, never a
// fabricated segment. Reports/screenshots remain in ignored .artifacts/pose/.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
const origin = process.env.DEMO_URL || 'http://127.0.0.1:5173/';
const realModel = process.argv.includes('--model');
if (realModel) {await import('./interaction-smoke.mjs');process.exit(0);}
const output = new URL('../.artifacts/pose/',import.meta.url);
await mkdir(output,{recursive:true});
const browser = await chromium.launch({executablePath:process.env.CHROME_BIN || undefined,headless:true,args:['--enable-unsafe-webgpu']});
const errors = [], reports = [];
let passed = false;
try {
  const page = await browser.newPage({viewport:{width:1280,height:850}});
  page.on('pageerror',error=>errors.push(error.message));
  const requests = []; page.on('request',r=>requests.push(r.url()));
  const url = new URL('pose.html',origin); if(realModel) url.searchParams.set('captureMotion','1');
  await page.goto(url.href);
  const report = () => page.locator('#diagnostics').textContent().then(JSON.parse);
  await page.waitForFunction(()=>document.querySelector('#interaction').textContent.includes('Rest pose'));
  await page.waitForFunction(()=>document.querySelector('#diagnostics').textContent.includes('handles'));
  assert.ok(!requests.some(url=>url.includes('.onnx')),'Posing must not request ONNX');
  await page.locator('#move').click();
  await page.locator('canvas').focus(); await page.keyboard.press('ArrowUp');
  await page.waitForFunction(()=>JSON.parse(document.querySelector('#diagnostics').textContent).edits>0);
  const keyboardRotations = (await report()).rotations;
  await page.keyboard.press('Shift+ArrowRight'); await page.waitForTimeout(300);
  assert.ok((await report()).rotations[13].some((v,i)=>Math.abs(v-keyboardRotations[13][i])>0.001),'Keyboard rotation works from the scene');
  await page.locator('#reset').click(); await page.waitForTimeout(300);
  const distance = (a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
  const drag = async (joint,dx,dy,cancel=false) => {
    const before = await report(), [x,y] = before.handles[joint].screen;
    await page.mouse.move(x,y); await page.mouse.down();
    await page.waitForFunction(()=>JSON.parse(document.querySelector('#diagnostics').textContent).active);
    assert.equal((await report()).orbitEnabled,false);
    await page.mouse.move(x+dx,y+dy,{steps:12});
    if(cancel) await page.keyboard.press('Escape'); else await page.mouse.up();
    await page.waitForFunction(()=>!JSON.parse(document.querySelector('#diagnostics').textContent).active);
    assert.equal((await report()).orbitEnabled,true); if(cancel) await page.mouse.up();
    await page.waitForTimeout(300); return before;
  };
  for (const [value,label] of [['soma','SOMA'],['animasa','Animasa Miku'],['mmd','CG-CA Uka']]) {
    await page.selectOption('#character',value);
    await page.waitForFunction(label=>JSON.parse(document.querySelector('#diagnostics').textContent).character===label,label);
    await page.locator('#reset').click(); await page.waitForTimeout(300);
    const initial = await report();
    await drag('LeftHand',35,-35); const reached = await report();
    assert.ok(distance(initial.handles.LeftHand.world,reached.handles.LeftHand.world)>0.1);
    assert.ok(reached.targetErrorMeters < 0.06,`${label} hand error ${reached.targetErrorMeters}`);
    assert.ok(distance(initial.rotations[3],reached.rotations[3])<0.001,'Direct hand IK leaves torso model-owned');
    await page.waitForTimeout(500);
    assert.ok(distance((await report()).handles.LeftHand.world,reached.handles.LeftHand.world)<0.001,'Release retains pose');
    await page.locator('#rotate').click(); const preRotate = await report();
    await drag('LeftHand',30,12,true); const rotated = await report();
    assert.ok(distance(preRotate.rotations[13],rotated.rotations[13])>0.03,'Rotate changes hand orientation');
    assert.equal(await page.locator('#rotate').getAttribute('aria-pressed'),'true');
    await page.locator('#move').click(); await page.locator('#reset').click(); await page.waitForTimeout(300);
    const preFoot = await report();
    await drag('LeftFoot',12,-25); const foot = await report();
    assert.ok(distance(foot.root,preFoot.root)<0.001,'Direct foot IK leaves root model-owned');
    assert.ok(distance(foot.handles.RightFoot.world,preFoot.handles.RightFoot.world)<0.045,'Other foot stays planted');
    await page.locator('#reset').click(); await page.waitForTimeout(300);
    const preHips = await report(); await drag('Hips',25,0); const hips = await report();
    const shift = hips.root.map((v,i)=>v-preHips.root[i]);
    assert.ok(distance(hips.root,preHips.root)>0.03);
    assert.ok(distance(hips.handles.LeftFoot.world.map((v,i)=>v-preHips.handles.LeftFoot.world[i]),shift)>0.02,`${label} pelvis contact compensation`);
    if(value!=='soma') {
      assert.ok(hips.mmd.steps>0); assert.ok(hips.mmd.allocations>0); assert.ok(hips.mmd.maximumSecondaryAngle>0.02);
      await page.locator('#mmd-physics').uncheck(); await page.waitForTimeout(300);
      assert.equal((await report()).mmd.allocations,0);
      await page.locator('#mmd-physics').check();
    }
    reports.push({label,handError:reached.targetErrorMeters,footError:foot.targetErrorMeters,mmd:hips.mmd});
    await page.screenshot({path:new URL(`${value}.png`,output).pathname});
    await page.locator('#reset').click(); await page.waitForTimeout(300);
    assert.ok(distance((await report()).root,initial.root)<1e-6);
  }
  // Overlapping loads cannot win a newer SOMA selection.
  await page.selectOption('#character','animasa'); await page.selectOption('#character','soma'); await page.waitForTimeout(1000);
  assert.equal((await report()).character,'SOMA');
  const cameraBefore = (await report()).camera;
  await page.mouse.move(1000,500); await page.mouse.down(); await page.mouse.move(1100,500,{steps:5}); await page.mouse.up();
  await page.waitForTimeout(300);
  assert.ok(distance(cameraBefore,(await report()).camera)>0.1,'Camera orbit works after release');
  await page.setViewportSize({width:390,height:844}); await page.waitForTimeout(300);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  const mobile = await report();
  for(const handle of Object.entries(mobile.handles).filter(([joint])=>!['Chest','LeftShoulder','RightShoulder'].includes(joint)).map(([,h])=>h)) assert.ok(handle.screen[1] < 844*0.58,'Handles remain above mobile controls');
  await page.screenshot({path:new URL('mobile.png',output).pathname});
  await page.setViewportSize({width:1280,height:850});
  await page.locator('#generation-controls').evaluate(details=>{details.open=true;});
  await page.route(/mmm_v6_soma_fp32\.onnx$/,r=>r.fulfill({status:404,body:'Missing weights'}));
  await page.locator('#load').click();
  await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('HTTP 404'));
  assert.equal((await report()).generations,0); assert.ok(await page.locator('#load').isEnabled());
  await page.locator('#reach').click(); assert.ok((await report()).generations===0);
  const noGPU = await browser.newPage();
  await noGPU.addInitScript(()=>Object.defineProperty(navigator,'gpu',{get:()=>undefined}));
  await noGPU.goto(url.href); await noGPU.waitForFunction(()=>document.querySelector('#interaction').textContent.includes('Rest pose'));
  await noGPU.locator('#move').click(); await noGPU.locator('#reach').click(); await noGPU.locator('#generation-controls').evaluate(details=>{details.open=true;}); await noGPU.locator('#load').click();
  await noGPU.waitForFunction(()=>document.querySelector('#status').textContent.includes('WebGPU is unavailable'));
  await noGPU.waitForFunction(()=>{const text=document.querySelector('#diagnostics').textContent;return text && JSON.parse(text).edits>0;});
  const fallback = JSON.parse(await noGPU.locator('#diagnostics').textContent());
  assert.equal(fallback.generations,0); assert.equal(fallback.renderer,'WebGLBackend'); await noGPU.close();

  // Verify both directions of the production-prefixed page navigation.
  await page.getByRole('link',{name:'← Keyboard locomotion'}).click();
  await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('SOMA ready'));
  await page.getByRole('link',{name:'Interactive pose demo →'}).click();
  await page.waitForFunction(()=>document.querySelector('#interaction').textContent.includes('Rest pose'));
  await page.goBack(); await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('SOMA ready'));
  await page.goForward(); await page.waitForFunction(()=>document.querySelector('#interaction').textContent.includes('Rest pose'));
  await page.waitForFunction(()=>document.querySelector('#diagnostics').textContent.includes('handles'));
  assert.equal(await page.locator('canvas').count(),1,'History navigation retains a live renderer');
  assert.deepEqual(errors,[]); passed = true; console.log(JSON.stringify({result:'pass',realModel,reports:reports.map(r=>r.example
    ? {example:r.example,generations:r.report.generations,targetErrorMeters:r.report.targetErrorMeters}
    : {label:r.label,handError:r.handError,footError:r.footError,physicsAllocations:r.mmd?.allocations})},null,2));
} finally {
  await writeFile(new URL('report.json',output),JSON.stringify({result:passed ? 'pass' : 'fail',realModel,reports,errors},null,2));
  await browser.close();
}
