// Start npm run dev first. Optional real-model test: npm run test:browser -- --model
// CHROME_BIN selects a system Chrome; otherwise run npx playwright install chromium.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import model from '../model-source.json' with {type: 'json'};
const realModel = process.argv.includes('--model');
const strictGpu = process.argv.includes('--strict-gpu');
const origin = process.env.DEMO_URL || 'http://127.0.0.1:5173/';
const browser = await chromium.launch({executablePath: process.env.CHROME_BIN || undefined,
  headless: true, args: ['--enable-unsafe-webgpu']});
const output = new URL('../.artifacts/', import.meta.url);
await mkdir(output, {recursive: true});
try {
  const page = await browser.newPage({viewport: {width: 1280, height: 850}});
  const errors = [];
  const initialHttpErrors = [];
  page.on('pageerror', error => errors.push(error.message));
  const checkResponse = response => {if (response.status() >= 400) initialHttpErrors.push(`${response.status()} ${response.url()}`);};
  page.on('response', checkResponse);
  await page.goto(`${origin}${strictGpu ? '?strictGpu=1' : ''}`);
  await page.waitForFunction(() => document.querySelector('#status').textContent.includes('SOMA ready'), undefined, {timeout: 30000});
  assert.equal(await page.locator('canvas').count(), 1);
  page.off('response', checkResponse);
  assert.deepEqual(initialHttpErrors, []);
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
  await page.waitForFunction(() => document.querySelector('#status').textContent.startsWith('Blocked:') || Number(document.querySelector('#generations').textContent) > 0,
    undefined, {timeout: realModel ? 930000 : 30000});
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
      await page.screenshot({path: new URL(`${step.label}.png`, output).pathname});
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
    await writeFile(new URL('movement.json', output), JSON.stringify(traces, null, 2));
  }
  await writeFile(new URL('report.json', output), JSON.stringify(report, null, 2));
  await page.screenshot({path: new URL('desktop.png', output).pathname});
  assert.deepEqual(errors, []);
  if (!realModel) {
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
    await noGpuPage.close();
  }
  console.log(JSON.stringify({result:'pass',realModel,strictGpu,report},null,2));
} finally {await browser.close();}
