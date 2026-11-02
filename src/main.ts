import { AmbientLight, Color, DirectionalLight, Fog, GridHelper, Mesh, MeshStandardMaterial,
  PerspectiveCamera, PlaneGeometry, Scene, WebGPURenderer } from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { SomaAvatar } from './avatar';
import { Inference } from './inference';
import { Keyboard } from './input';
import { decode, encode, positions, targetsFor, type Intent } from './motion';
import { MotionPlayer } from './player';
import { CharacterSelection } from './characters';
import type { MMDCharacter } from './mmd';
import model from '../model-source.json';
import './style.css';

const modelUrl = import.meta.env.PROD ? model.url : new URL(`${import.meta.env.BASE_URL}assets/mmm_v6_soma_fp32.onnx`, location.href).href;
document.getElementById('model-source')!.textContent = import.meta.env.PROD
  ? 'Start downloads 758 MB from NVIDIA’s upstream repository. Browser caching is temporary; later visits may download again.'
  : 'Start loads the local 758 MB model. Run npm run assets:model first.';
const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const status = element('status'), start = element<HTMLButtonElement>('start');
const report: Record<string, unknown> = {time: new Date().toISOString(), userAgent: navigator.userAgent,
  secureContext: isSecureContext, webgpu: Boolean(navigator.gpu), model: modelUrl,
  provider: 'webgpu', strictGpu: new URL(location.href).searchParams.has('strictGpu'), cpuFallback: new URL(location.href).searchParams.has('strictGpu') ? 'disabled' : 'ORT default WASM for unsupported or shape operations', samples: []};
const updateReport = () => {element('diagnostics').textContent = JSON.stringify(report, null, 2);};
const fail = (error: unknown) => {
  report.error = error instanceof Error ? error.message : String(error); updateReport();
  status.textContent = `Blocked: ${report.error}`;
  start.textContent = 'Retry local inference'; start.disabled = false;
};
element('download').onclick = () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], {type: 'application/json'}));
  const a = document.createElement('a'); a.href = url; a.download = 'motionbricks-webgpu-report.json'; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

async function main() {
  const scene = new Scene(); scene.background = new Color('#101c25'); scene.fog = new Fog('#101c25', 18, 70);
  const camera = new PerspectiveCamera(40, innerWidth / innerHeight, 0.1, 150); camera.position.set(4, 2.5, 5);
  // Rendering may explicitly fall back for asset preview; inference always requires WebGPU.
  const renderer = new WebGPURenderer({antialias: true});
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setSize(innerWidth, innerHeight);
  await renderer.init();
  report.renderer = 'isWebGPUBackend' in renderer.backend ? 'WebGPUBackend' : 'WebGLBackend';
  element('stage').append(renderer.domElement);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0.9, 0); controls.enableDamping = true; controls.enablePan = false;
  controls.minDistance = 2; controls.maxDistance = 12; controls.maxPolarAngle = Math.PI / 2 - 0.03;
  scene.add(new AmbientLight(0xffffff, 2));
  const sun = new DirectionalLight(0xfff0db, 3); sun.position.set(4, 7, 3); scene.add(sun);
  const ground = new Mesh(new PlaneGeometry(200, 200), new MeshStandardMaterial({color: '#172c36', roughness: 1}));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.015; scene.add(ground);
  const grid = new GridHelper(200, 200, '#36535c', '#253e49'); grid.position.y = -0.01; scene.add(grid);
  const avatar = await SomaAvatar.load(`${import.meta.env.BASE_URL}assets/soma.glb`); scene.add(avatar.object);
  const character = element<HTMLSelectElement>('character'), characterStatus = element('character-status');
  const physicsControl = element<HTMLInputElement>('mmd-physics');
  const animasaFile = element<HTMLInputElement>('animasa-file');
  let localAnimasa: File | undefined;
  const characters = new CharacterSelection<MMDCharacter>(mmd => {
    avatar.object.visible = !mmd;
    element('physics-control').hidden = !mmd;
    if (mmd) {mmd.setPhysics(physicsControl.checked); scene.add(mmd.object);}
    else delete report.mmd;
    report.character = mmd ? `MMD (${mmd.label})` : 'SOMA'; updateReport();
  });
  physicsControl.onchange = () => {
    characters.current?.setPhysics(physicsControl.checked);
    characterStatus.textContent = `${characters.current?.label ?? ''} · MMD physics ${physicsControl.checked ? 'on' : 'off'}`;
  };
  character.disabled = false;
  character.onchange = async () => {
    const selection = character.value, file = localAnimasa;
    const label = selection === 'animasa' ? 'Animasa Miku' : 'CG-CA Uka';
    element('animasa-control').hidden = selection !== 'animasa';
    characterStatus.textContent = selection === 'soma' ? '' : `Loading ${label}…`;
    try {
      const selected = await characters.select(selection !== 'soma'
        ? async () => (await import('./mmd')).MMDCharacter.load(import.meta.env.BASE_URL, avatar, renderer,selection === 'animasa',selection === 'animasa' ? file : undefined) : undefined);
      if (selected) characterStatus.textContent = selection !== 'soma' ? `${label} · MMD physics ${physicsControl.checked ? 'on' : 'off'}` : '';
    } catch (error) {
      character.value = selection === 'animasa' ? 'animasa' : 'soma';
      element('animasa-control').hidden = selection !== 'animasa';
      characterStatus.textContent = `${label} could not load: ${error instanceof Error ? error.message : String(error)}. Select again to retry.`;
    }
  };
  animasaFile.onchange = () => {
    localAnimasa = animasaFile.files?.[0];
    if (character.value === 'animasa') character.dispatchEvent(new Event('change'));
  };
  const player = new MotionPlayer(avatar.stance), keyboard = new Keyboard();
  const previousRoot = player.pose.root.clone();
  let inference: Inference | undefined, running = false, pending = false;
  let lastIntent: Intent = {x: 0, z: 0, speed: 0};
  let latency = 0;
  status.textContent = navigator.gpu ? 'SOMA ready. Start to load the model.'
    : 'SOMA ready. WebGPU is unavailable. Use a supported desktop browser on localhost or HTTPS.';
  start.disabled = false;
  updateReport();
  start.onclick = async () => {
    inference?.dispose(); start.disabled = true;
    running = false; pending = true; report.error = undefined;
    status.textContent = 'Connecting to model host…';
    try {
      inference = new Inference();
      const result = await inference.load(modelUrl, received => {
        status.textContent = received < model.bytes
          ? `Downloading model: ${(received / 1_000_000).toFixed(0)} / 758 MB (${Math.floor(received / model.bytes * 100)}%)…`
          : 'Model downloaded. Compiling WebGPU kernels; this may take a minute…';
      });
      report.loadMs = Math.round(result.milliseconds); report.gpu = result.gpu; report.runtime = result.runtime; report.samples = []; updateReport();
      running = true; status.textContent = 'Model loaded. Generating first motion…';
    } catch (error) {inference?.dispose(); fail(error);}
    finally {pending = false;}
  };
  async function generate() {
    if (!inference || pending) return;
    pending = true;
    const request = player.request(), anchor = request.context[3];
    const {features, placement} = encode(request.context, targetsFor(anchor, avatar.stance, lastIntent, avatar.rig), avatar.rig);
    try {
      const result = await inference.run(features);
      latency = result.milliseconds;
      const samples = report.samples as number[]; samples.push(Math.round(latency)); if (samples.length > 30) samples.shift();
      report.lastTokens = result.tokens; report.intent = {...lastIntent};
      const segment = decode(result.data, result.tokens, placement);
      if (player.accept(segment, request.revision)) {
        report.minimumHeadAboveRootMeters = Math.min(...segment.map(p => positions(p, avatar.rig)[6].y - p.root.y));
        report.generations = player.generations; report.requestRoot = anchor.root.toArray();
        report.generatedRoot = segment[segment.length - 1].root.toArray();
        if (new URL(location.href).searchParams.has('captureMotion')) report.motionSample = segment.map(p => ({
          root:p.root.toArray(), rotations:p.rotations.map(q => q.toArray()),
        }));
        status.textContent = 'MotionBricks generating locally';
      }
      updateReport();
    } catch (error) {running = false; inference.dispose(); fail(error);}
    finally {pending = false;}
  }
  let last = performance.now();
  renderer.setAnimationLoop(() => {
    const now = performance.now(), delta = Math.min((now - last) / 1000, 0.1); last = now;
    const intent = keyboard.intent;
    if (intent.x !== lastIntent.x || intent.z !== lastIntent.z || intent.speed !== lastIntent.speed) {
      lastIntent = intent; player.changeIntent();
    }
    // Generate ahead from the queued endpoint. Responses cannot overwrite newer intent.
    if (running && !pending && player.remaining < Math.max(0.5, latency / 1000 + 0.2)) void generate();
    if (!document.hidden) player.advance(delta);
    const pose = player.pose; avatar.apply(pose);
    const mmd = characters.current;
    if (mmd && !document.hidden) {
      try {mmd.apply(pose, delta);}
      catch (error) {
        void characters.select(); character.value = 'soma';
        element('animasa-control').hidden = true;
        characterStatus.textContent = `${mmd.label} physics stopped: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
    const movement = pose.root.clone().sub(previousRoot); camera.position.add(movement); controls.target.add(movement); previousRoot.copy(pose.root);
    ground.position.x = pose.root.x; ground.position.z = pose.root.z;
    grid.position.x = Math.floor(pose.root.x); grid.position.z = Math.floor(pose.root.z);
    controls.update();
    if (characters.current) characters.current.effect.render(scene, camera);
    else renderer.render(scene, camera);
    if (mmd && characters.current === mmd && now % 500 < delta * 1000) {
      report.mmd = {shading:mmd.shading, physicsEnabled:mmd.physicsEnabled, physicsSteps:mmd.physics.steps, nativeAllocations:mmd.physics.allocations,
        maximumSecondaryAngle:mmd.physics.maximumSecondaryAngle}; updateReport();
    }
    element('movement').textContent = intent.speed === 0 ? 'Stop / idle' : intent.speed > 3 ? 'Run' : 'Walk';
    element('latency').textContent = latency ? `${Math.round(latency)} ms` : '—';
    element('queue').textContent = `${player.remaining.toFixed(2)} s${pending ? ' · generating' : player.waiting && running ? ' · holding' : ''}`;
    element('generations').textContent = String(player.generations);
    element('position').textContent = `${pose.root.x.toFixed(2)}, ${pose.root.z.toFixed(2)} m`;
  });
  addEventListener('resize', () => {camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight);});
  document.addEventListener('visibilitychange', () => characters.current?.reset());
  addEventListener('pagehide', () => {inference?.dispose(); characters.dispose();}, {once: true});
}
main().catch(error => {fail(error); start.disabled = true;});
