// Start npm run dev first. Optional real-model test: npm run test:browser -- --model
// CHROME_BIN selects a system Chrome; otherwise run npx playwright install chromium.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import model from '../model-source.json' with {type: 'json'};
import sharp from 'sharp';
const realModel = process.argv.includes('--model');
const mmdMode = process.argv.includes('--mmd');
const strictGpu = process.argv.includes('--strict-gpu');
const origin = process.env.DEMO_URL || 'http://127.0.0.1:5173/';
const browser = await chromium.launch({executablePath: process.env.CHROME_BIN || undefined,
  headless: true, args: ['--enable-unsafe-webgpu']});
const output = new URL('../.artifacts/', import.meta.url);
await mkdir(output, {recursive: true});

async function waitForModel(page) {
  const started = performance.now(), timeline = [];
  let previousStatus, lastProgress = started, lastLog = -Infinity;
  try {
    for (;;) {
      const state = await page.evaluate(() => ({
        status: document.querySelector('#status').textContent,
        generations: Number(document.querySelector('#generations').textContent),
      }));
      const now = performance.now();
      // The UI reports increasing downloaded MB, then compilation and generation.
      // Keep allowing active downloads; a fixed total timeout cuts off slow hosts.
      if (state.status !== previousStatus) {
        previousStatus = state.status; lastProgress = now;
      }
      if (now - lastLog >= 30000 || state.generations > 0 || state.status.startsWith('Blocked:')) {
        const entry = {elapsedSeconds: Math.round((now - started) / 1000), ...state};
        timeline.push(entry); console.log(JSON.stringify(entry)); lastLog = now;
      }
      if (state.status.startsWith('Blocked:') || state.generations > 0) return;
      // Allow the application's 15-minute idle watchdog to surface its own error.
      assert.ok(now - lastProgress < 930000, `Model loading stalled: ${state.status}`);
      await page.waitForTimeout(1000);
    }
  } finally {
    await writeFile(new URL('loading.json', output), JSON.stringify(timeline, null, 2));
  }
}

try {
  const page = await browser.newPage({viewport: {width: 1280, height: 850}});
  const errors = [];
  const initialHttpErrors = [];
  page.on('pageerror', error => errors.push(error.message));
  const checkResponse = response => {if (response.status() >= 400) initialHttpErrors.push(`${response.status()} ${response.url()}`);};
  page.on('response', checkResponse);
  const url = new URL(origin);
  if (strictGpu) url.searchParams.set('strictGpu','1');
  if (realModel && mmdMode) url.searchParams.set('captureMotion','1');
  await page.goto(url.href);
  await page.waitForFunction(() => document.querySelector('#status').textContent.includes('SOMA ready'), undefined, {timeout: 30000});
  assert.equal(await page.locator('canvas').count(), 1);
  page.off('response', checkResponse);
  assert.deepEqual(initialHttpErrors, []);
  const reportNow = () => page.locator('#diagnostics').textContent().then(JSON.parse);
  // Exercise the actual converted skin, shaders, Bullet runtime and switching
  // even in the fast browser suite, without downloading inference weights.
  await page.selectOption('#character','mmd');
  await page.waitForFunction(() => document.querySelector('#character-status').textContent.includes('physics on'),undefined,{timeout:30000});
  await page.waitForFunction(() => JSON.parse(document.querySelector('#diagnostics').textContent).mmd?.physicsSteps > 180);
  const mmdReady = await reportNow();
  assert.ok(mmdReady.mmd.maximumSecondaryAngle > 0.02);
  const capture = async name => {
    const bytes = await page.screenshot({clip:{x:450,y:180,width:450,height:520},path:new URL(name,output).pathname});
    return sharp(bytes).removeAlpha().raw().toBuffer();
  };
  const physicsOn = await capture('mmd-physics-on.png');
  await page.locator('#mmd-physics').uncheck();
  await page.waitForFunction(() => JSON.parse(document.querySelector('#diagnostics').textContent).mmd?.physicsEnabled === false);
  assert.equal((await reportNow()).mmd.nativeAllocations,0,'Physics off releases the Bullet world');
  const physicsOff = await capture('mmd-physics-off.png');
  let changed = 0;
  for(let i=0;i<physicsOn.length;i+=3) if(Math.max(...[0,1,2].map(j=>Math.abs(physicsOn[i+j]-physicsOff[i+j])))>12) changed++;
  assert.ok(changed>40,`Physics must visibly deform the character (${changed} changed pixels)`);
  await page.locator('#mmd-physics').check();
  // Rapid cancellation must not let a late MMD load replace SOMA.
  await page.selectOption('#character','soma');
  await page.selectOption('#character','mmd');
  await page.selectOption('#character','soma');
  await page.waitForTimeout(1500);
  assert.equal((await reportNow()).character,'SOMA');
  await page.selectOption('#character','mmd');
  await page.waitForFunction(() => JSON.parse(document.querySelector('#diagnostics').textContent).mmd?.physicsSteps > 30);
  assert.equal((await reportNow()).mmd.nativeAllocations,mmdReady.mmd.nativeAllocations,'Switching must not leak native worlds');
  if(!mmdMode) await page.selectOption('#character','soma');
  await writeFile(new URL('mmd-preview.json',output),JSON.stringify({report:mmdReady,changedPhysicsPixels:changed},null,2));
  if (new URL(origin).pathname === '/three-motionbricks/') {
    const initialReport = JSON.parse(await page.locator('#diagnostics').textContent());
    assert.equal(initialReport.model, model.url, 'Production must load the pinned remote weights');
    assert.match(await page.locator('#model-source').textContent(), /758 MB/);
  }
  await page.locator('canvas').click({position: {x: 800, y: 400}});
  await page.keyboard.down('KeyW');
  await page.waitForFunction(() => document.querySelector('#movement').textContent === 'Walk');
  await page.keyboard.down('Shift');
  await page.waitForFunction(() => document.querySelector('#movement').textContent === 'Run');
  // Window blur must clear held keys, including Shift.
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.waitForFunction(() => document.querySelector('#movement').textContent === 'Stop / idle');
  await page.keyboard.up('KeyW'); await page.keyboard.up('Shift');
  await page.setViewportSize({width: 390, height: 844});
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({path: new URL('mobile.png', output).pathname});
  await page.setViewportSize({width: 1280, height: 850});
  if (!realModel) await page.route(/mmm_v6_soma_fp32\.onnx$/, route => route.fulfill({status:404,body:'Missing model'}));
  await page.locator('#start').click();
  if (realModel) await waitForModel(page);
  else await page.waitForFunction(() => document.querySelector('#status').textContent.startsWith('Blocked:') || Number(document.querySelector('#generations').textContent) > 0,
    undefined, {timeout: 30000});
  const getReport = () => page.locator('#diagnostics').textContent().then(JSON.parse);
  let report = await getReport();
  if (!realModel || strictGpu) {
    assert.match(report.error, !realModel ? /HTTP 404/ : /CPU EP/);
    assert.equal(await page.locator('#start').isEnabled(), true);
    assert.equal(await page.locator('#generations').textContent(), '0');
    if (!realModel) {
      await page.unroute(/mmm_v6_soma_fp32\.onnx$/);
      await page.route(/mmm_v6_soma_fp32\.onnx$/, route => route.fulfill({body:'version https://git-lfs.github.com/spec/v1\n'}));
      await page.locator('#start').click();
      await page.waitForFunction(() => document.querySelector('#status').textContent.includes('Git LFS pointer'));
      assert.equal(await page.locator('#generations').textContent(), '0');
      await page.unroute(/mmm_v6_soma_fp32\.onnx$/);
      await page.route(/mmm_v6_soma_fp32\.onnx$/, route => route.abort('internetdisconnected'));
      await page.locator('#start').click();
      await page.waitForFunction(() => document.querySelector('#status').textContent.includes('Cannot reach the model host'));
      assert.equal(await page.locator('#start').isEnabled(), true);
      report = await getReport();
    }
  } else {
    assert.equal(report.error, undefined, JSON.stringify(report));
    assert.equal(report.renderer, 'WebGPUBackend');
    await page.evaluate(() => {
      window.__motionTrace = [];
      const record = () => {
        const values = document.querySelector('#position').textContent.replace(' m', '').split(',').map(Number);
        window.__motionTrace.push({time: performance.now(), values}); requestAnimationFrame(record);
      }; record();
    });
    const traces = [];
    const position = async () => (await page.locator('#position').textContent()).replace(' m','').split(',').map(Number);
    await page.locator('canvas').click({position: {x: 800, y: 400}});
    for (const step of [
      {keys:['KeyW'], label:'walk'},
      {keys:['KeyW','Shift'], label:'run'},
      {keys:['KeyD'], label:'turn'},
      {keys:[], label:'stop'},
    ]) {
      for (const key of ['KeyW','KeyD','Shift']) await page.keyboard.up(key);
      for (const key of step.keys) await page.keyboard.down(key);
      const before = await position(), generation = Number(await page.locator('#generations').textContent());
      await page.waitForFunction(n => Number(document.querySelector('#generations').textContent) >= n + 2 || document.querySelector('#status').textContent.startsWith('Blocked:'),
        generation, {timeout: 60000});
      await page.waitForTimeout(1000);
      report = await getReport(); assert.equal(report.error, undefined, JSON.stringify(report));
      assert.ok(report.minimumHeadAboveRootMeters > 0.25, `${step.label}: generated torso collapsed (${report.minimumHeadAboveRootMeters} m)`);
      const after = await position();
      if (step.keys.length) assert.ok(Math.hypot(after[0]-before[0],after[1]-before[1]) > 0.1, `${step.label}: root did not move`);
      if (step.label === 'walk' || step.label === 'run') assert.ok(after[1] < before[1] - 0.1, `${step.label}: expected travel toward -Z`);
      if (step.label === 'turn') assert.ok(after[0] > before[0] + 0.1, 'turn: expected travel toward +X');
      if(mmdMode) {
        assert.equal(report.character,'MMD (CG-CA Uka)');
        assert.equal(report.mmd.physicsEnabled,true);
        assert.ok(report.mmd.physicsSteps>0);
        assert.ok(report.mmd.maximumSecondaryAngle>0.02);
      }
      await page.screenshot({path: new URL(`${mmdMode?'mmd-':''}${step.label}.png`, output).pathname});
      traces.push({state: step.label, before, after, report});
    }
    const samples = await page.evaluate(() => window.__motionTrace);
    let maximumStep = 0;
    for (let i = 1; i < samples.length; i++) maximumStep = Math.max(maximumStep,
      Math.hypot(samples[i].values[0] - samples[i-1].values[0], samples[i].values[1] - samples[i-1].values[1]));
    assert.ok(maximumStep < 0.5, `Root jumped ${maximumStep} m in one displayed frame`);
    const last = samples.at(-1), lastSecond = samples.find(s => s.time >= last.time - 1000);
    const stoppedTravel = Math.hypot(last.values[0]-lastSecond.values[0], last.values[1]-lastSecond.values[1]);
    assert.ok(stoppedTravel < 0.25, `Stop continued moving ${stoppedTravel} m in the last second`);
    report.maximumDisplayedStepMeters = maximumStep; report.stoppedTravelMeters = stoppedTravel;
    await writeFile(new URL(`${mmdMode?'mmd-':''}movement.json`, output), JSON.stringify(traces, null, 2));
    if(mmdMode) {
      const generations=Number(await page.locator('#generations').textContent());
      await page.selectOption('#character','soma');
      await page.waitForFunction(n=>Number(document.querySelector('#generations').textContent)>n,generations,{timeout:60000});
      assert.equal((await getReport()).character,'SOMA','Switching preserves the same running player/worker');
      await page.selectOption('#character','mmd');
      await page.waitForFunction(()=>JSON.parse(document.querySelector('#diagnostics').textContent).mmd?.physicsSteps>30);
      assert.equal((await getReport()).mmd.nativeAllocations,mmdReady.mmd.nativeAllocations);
    }
  }
  await writeFile(new URL('report.json', output), JSON.stringify(report, null, 2));
  await page.screenshot({path: new URL('desktop.png', output).pathname});
  assert.deepEqual(errors, []);
  if (!realModel) {
    const missingMMD = await browser.newPage();
    await missingMMD.route('**/assets/uka/model.glb',r=>r.fulfill({status:404,body:'Missing Uka'}));
    await missingMMD.goto(origin);
    await missingMMD.waitForFunction(()=>!document.querySelector('#character').disabled);
    await missingMMD.selectOption('#character','mmd');
    await missingMMD.waitForFunction(()=>document.querySelector('#character-status').textContent.includes('could not load'));
    assert.equal(await missingMMD.locator('#character').inputValue(),'soma');
    assert.equal(await missingMMD.locator('#start').isEnabled(),true,'Character failure must not disable inference');
    await missingMMD.unroute('**/assets/uka/model.glb');
    await missingMMD.route('**/runtime/ammo.js',r=>r.fulfill({status:404,body:'Missing Ammo'}));
    await missingMMD.selectOption('#character','mmd');
    await missingMMD.waitForFunction(()=>document.querySelector('#character-status').textContent.includes('Ammo resource loading failed'));
    await missingMMD.unroute('**/runtime/ammo.js');
    await missingMMD.selectOption('#character','mmd');
    await missingMMD.waitForFunction(()=>document.querySelector('#character-status').textContent.includes('physics on'));
    await missingMMD.close();
    const missingBodyPage = await browser.newPage();
    await missingBodyPage.route('**/assets/soma.glb', route => route.fulfill({status: 404, body: 'Missing character'}));
    await missingBodyPage.goto(origin);
    await missingBodyPage.waitForFunction(() => document.querySelector('#status').textContent.startsWith('Blocked:'));
    assert.equal(await missingBodyPage.locator('#start').isDisabled(), true);
    await missingBodyPage.close();
    const noGpuPage = await browser.newPage();
    await noGpuPage.addInitScript(() => Object.defineProperty(navigator, 'gpu', {get: () => undefined}));
    await noGpuPage.goto(origin);
    await noGpuPage.waitForFunction(() => document.querySelector('#status').textContent.includes('SOMA ready'));
    await noGpuPage.locator('#start').click();
    await noGpuPage.waitForFunction(() => document.querySelector('#status').textContent.startsWith('Blocked:'));
    assert.match(await noGpuPage.locator('#status').textContent(), /WebGPU is unavailable/);
    const noGpuReport = JSON.parse(await noGpuPage.locator('#diagnostics').textContent());
    assert.equal(noGpuReport.renderer, 'WebGLBackend');
    assert.equal(noGpuReport.webgpu, false);
    assert.equal(await noGpuPage.locator('#generations').textContent(), '0');
    await noGpuPage.selectOption('#character','mmd');
    await noGpuPage.waitForFunction(()=>JSON.parse(document.querySelector('#diagnostics').textContent).mmd?.physicsSteps>30);
    assert.equal(JSON.parse(await noGpuPage.locator('#diagnostics').textContent()).renderer,'WebGLBackend');
    await noGpuPage.close();
  }
  delete report.motionSample;
  console.log(JSON.stringify({result:'pass',realModel,mmdMode,strictGpu,report},null,2));
} finally {await browser.close();}
