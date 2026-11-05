import { Quaternion, Vector3 } from 'three';
import { createStage } from './stage';
import { SomaAvatar } from './avatar';
import { CharacterSelection } from './characters';
import type { MMDCharacter } from './mmd';
import { clonePose, decode, encode, positions, type Pose } from './motion';
import { EFFECTORS, jointIndex, PoseIK, rotateBranch, type Effector, type PoseConstraint } from './pose-ik';
import { PosePointer, type Manipulation } from './pose-pointer';
import { boundedCorrection, PoseResponse, responseProblem } from './pose-response';
import { Inference } from './inference';
import model from '../model-source.json';
import './style.css';
import './pose.css';

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const status = el('status'), load = el<HTMLButtonElement>('load'), pause = el<HTMLButtonElement>('pause');
const modelURL = import.meta.env.PROD ? model.url : new URL(`${import.meta.env.BASE_URL}assets/mmm_v6_soma_fp32.onnx`,location.href).href;
const report: Record<string,any> = {time:new Date().toISOString(),webgpu:Boolean(navigator.gpu),model:modelURL,
  generations:0,discarded:0,trace:[],source:'IK only'};
el('model-source').textContent = import.meta.env.PROD ? 'Load downloads 758 MB from NVIDIA. Browser caching is temporary.'
  : 'Load uses the local 758 MB model (npm run assets:model).';

async function main() {
  const stage = await createStage(el('stage')), {scene,camera,renderer,controls} = stage;
  report.renderer = 'isWebGPUBackend' in renderer.backend ? 'WebGPUBackend' : 'WebGLBackend';
  const avatar = await SomaAvatar.load(`${import.meta.env.BASE_URL}assets/soma.glb`).catch(error => {stage.dispose(); throw error;}); scene.add(avatar.object);
  const ik = new PoseIK(avatar.rig,avatar.stance), response = new PoseResponse(avatar.stance);
  const character = el<HTMLSelectElement>('character'), effector = el<HTMLSelectElement>('effector');
  const plant = el<HTMLInputElement>('plant'), physics = el<HTMLInputElement>('mmd-physics');
  let base = clonePose(response.pose), held: PoseConstraint | undefined, supports: PoseConstraint[] = [];
  let heldRotation: {joint:Effector; rotation:Quaternion} | undefined;
  let inference: Inference | undefined, pending = false, running = false, loaded = false, latency = 0;
  let edits = 0;
  const characters = new CharacterSelection<MMDCharacter>(mmd => {
    avatar.object.visible = !mmd; el('physics-control').hidden = !mmd;
    if (mmd) {mmd.setPhysics(physics.checked); scene.add(mmd.object);}
    report.character = mmd ? mmd.label : 'SOMA';
  });
  const visiblePoint = (joint: Effector) => characters.current?.handle(joint) ?? positions(response.pose,avatar.rig)[jointIndex(joint)];
  const captureSupports = (pose: Pose, joint: Effector) => plant.checked && joint !== 'Hips'
    ? (['LeftFoot','RightFoot'] as const).filter(name => name !== joint).map(name => ({joint:name,target:positions(pose,avatar.rig)[jointIndex(name)]})) : [];
  // Convert displacement at the visible retargeted joint back to canonical SOMA.
  // A few feedback iterations compensate for different MMD limb proportions.
  function solveVisible(input: Pose, joint: Effector, target: Vector3, planted: PoseConstraint[], follow: boolean): Pose {
    let pose = clonePose(input), canonicalTarget = positions(pose,avatar.rig)[jointIndex(joint)];
    const mmd = characters.current;
    if (!mmd) return ik.solve(input,{joint,target},planted,follow);
    for (let i = 0; i < 4; i++) {
      mmd.preview(pose);
      const visible = mmd.handle(joint)!;
      canonicalTarget.add(target.clone().sub(visible).multiplyScalar(1 / mmd.heightRatio));
      pose = ik.solve(input,{joint,target:canonicalTarget},planted,follow);
    }
    return pose;
  }
  const edit = (pose: Pose, kind: 'position IK' | 'orientation') => {
    response.edit(pose,performance.now()); edits++; report.source = 'Immediate IK';
    if (loaded && running) status.textContent = 'Immediate IK · waiting for new ONNX response';
    el('interaction').textContent = `${pointer.selected} · ${kind} · release keeps pose`;
  };
  const manipulate = (change: Manipulation, begin: boolean) => {
    effector.value = change.joint;
    if (begin) {
      base = clonePose(response.pose);
      held = pointer.mode === 'move' ? {joint:change.joint,target:visiblePoint(change.joint)} : undefined;
      heldRotation = pointer.mode === 'rotate' ? {joint:change.joint,rotation:base.rotations[jointIndex(change.joint)].clone()} : undefined;
      supports = captureSupports(base,change.joint);
      response.edit(response.pose,performance.now());
    }
    if (change.position) {
      heldRotation = undefined;
      const target = change.position.clone();
      if (change.joint.includes('Foot')) target.y = Math.max(0.04,target.y);
      held = {joint:change.joint,target};
      edit(solveVisible(base,change.joint,target,supports,true),'position IK');
    } else if (change.rotation) {
      held = undefined;
      const pose = ik.rotate(base,change.joint,change.rotation);
      heldRotation = {joint:change.joint,rotation:pose.rotations[jointIndex(change.joint)].clone()}; edit(pose,'orientation');
    }
  };
  const pointer = new PosePointer(renderer.domElement,camera,controls,manipulate,() => {
    el('interaction').textContent = `${pointer.selected} · pose retained`;
  }); scene.add(pointer.object);
  const clearTargets = () => {pointer.cancel(); held = undefined; heldRotation = undefined; supports = [];};
  const reset = () => {
    clearTargets(); response.reset(avatar.stance,performance.now()); characters.current?.reset();
    report.source = 'IK only'; el('interaction').textContent = 'Rest pose · drag a handle';
  };
  el('reset').onclick = reset;
  for (const mode of ['move','rotate'] as const) el(mode).onclick = () => {
    pointer.cancel(); pointer.mode = mode;
    for (const name of ['move','rotate']) el(name).setAttribute('aria-pressed',String(name === mode));
  };
  effector.onchange = () => {pointer.cancel(); pointer.selected = effector.value as Effector;};
  plant.onchange = () => {supports = captureSupports(response.pose,pointer.selected); response.edit(response.pose,performance.now());};
  physics.onchange = () => characters.current?.setPhysics(physics.checked);
  character.disabled = false;
  character.onchange = async () => {
    clearTargets(); response.reset(response.pose,performance.now()); pointer.selected = 'LeftHand'; effector.value = pointer.selected;
    const selection = character.value;
    el('character-status').textContent = selection === 'soma' ? '' : 'Loading character…';
    try {
      if (await characters.select(selection === 'soma' ? undefined : async () =>
        (await import('./mmd')).MMDCharacter.load(import.meta.env.BASE_URL,avatar,renderer,selection === 'animasa'))) {
        el('character-status').textContent = characters.current ? `${characters.current.label} · physics ${physics.checked ? 'on' : 'off'}` : '';
      }
    } catch (error) {
      character.value = 'soma'; el('character-status').textContent = `Character could not load: ${String(error)}. Select again to retry.`;
    }
  };
  function example(joint: Effector, offset: Vector3) {
    el('move').click();
    clearTargets(); pointer.selected = joint; effector.value = joint;
    manipulate({joint},true); manipulate({joint,position:visiblePoint(joint).add(offset)},false);
  }
  el('reach').onclick = () => example('LeftHand',new Vector3(0.12,0.3,-0.25));
  el('step').onclick = () => example('LeftFoot',new Vector3(0,0.12,-0.25));
  const keyboard = (event: KeyboardEvent) => {
    if (!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key) || pointer.active
      || (event.target instanceof HTMLElement && event.target.closest('input,select,button,summary'))) return;
    event.preventDefault(); const joint = pointer.selected;
    manipulate({joint},true);
    if (event.shiftKey || pointer.mode === 'rotate') {
      manipulate({joint,rotation:new Quaternion().setFromAxisAngle(new Vector3(0,1,0),event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -0.08 : 0.08)},false);
    } else {
      const offset = new Vector3(event.key === 'ArrowLeft' ? -0.03 : event.key === 'ArrowRight' ? 0.03 : 0,
        event.key === 'ArrowUp' ? 0.03 : event.key === 'ArrowDown' ? -0.03 : 0,0);
      manipulate({joint,position:visiblePoint(joint).add(offset)},false);
    }
  }; addEventListener('keydown',keyboard);
  const fail = (error: unknown) => {
    running = false; loaded = false; inference?.dispose(); inference = undefined;
    report.error = error instanceof Error ? error.message : String(error);
    status.textContent = `IK only · ${report.error}`; load.disabled = false; load.textContent = 'Retry MotionBricks'; pause.disabled = true;
    report.source = 'IK only';
  };
  load.disabled = false;
  if (!navigator.gpu) status.textContent = 'IK only · WebGPU unavailable; posing still works';
  load.onclick = async () => {
    inference?.dispose(); inference = new Inference(); load.disabled = true; pending = true; delete report.error;
    status.textContent = 'Downloading model…';
    try {
      const result = await inference.load(modelURL,bytes => {status.textContent = bytes < model.bytes
        ? `Downloading ${(bytes/1e6).toFixed(0)} / 758 MB…` : 'Compiling WebGPU kernels…';});
      report.runtime = result.runtime; report.gpu = result.gpu; report.loadMs = result.milliseconds;
      loaded = true; running = true; pause.disabled = false; pause.textContent = 'Pause generation';
      status.textContent = 'Model loaded · waiting for ONNX response';
    } catch (error) {fail(error);} finally {pending = false;}
  };
  pause.onclick = () => {
    running = !running; response.edit(response.pose,performance.now());
    pause.textContent = running ? 'Pause generation' : 'Resume generation';
    status.textContent = running ? 'Waiting for ONNX response' : 'Generation paused · posing remains active';
  };
  el<HTMLInputElement>('strength').oninput = () => response.edit(response.pose,performance.now());
  async function generate() {
    if (!inference || pending) return;
    pending = true;
    const strength = Number(el<HTMLInputElement>('strength').value), request = response.request(strength);
    const {features,placement} = encode(request.context,request.targets,avatar.rig);
    try {
      const result = await inference.run(features); latency = result.milliseconds;
      const segment = decode(result.data,result.tokens,placement);
      if (request.revision === response.revision) {
        const problem = responseProblem(segment,avatar.rig);
        if (problem) {
          running = false; response.edit(response.pose,performance.now());
          report.rejected = (report.rejected ?? 0)+1; report.rejectedReason = problem; report.source = 'IK only';
          status.textContent = `IK only · ${problem}. Adjust/reset pose, then resume to retry.`;
          pause.textContent = 'Resume generation'; return;
        }
      }
      if (response.accept(segment,request.revision)) {
        report.source = 'MotionBricks + bounded IK'; status.textContent = held || heldRotation
          ? 'Actual ONNX motion · bounded IK target correction' : 'Actual ONNX motion · full-body playback';
        report.lastGeneration = {revision:request.revision,tokens:result.tokens,frames:segment.length,milliseconds:latency,targetStrength:strength,
          contextRoots:request.context.map(p=>p.root.toArray()),targetRoots:request.targets.map(p=>p.root.toArray()),
          contextEnd:positions(request.context[3],avatar.rig).map(p=>p.toArray()),targetEnd:positions(request.targets[3],avatar.rig).map(p=>p.toArray()),
          rawStart:positions(segment[0],avatar.rig).map(p=>p.toArray()),rawEnd:positions(segment.at(-1)!,avatar.rig).map(p=>p.toArray()),
          target:held ? {joint:held.joint,world:held.target.toArray()} : undefined};
        if (new URL(location.href).searchParams.has('captureMotion')) report.motionSample = segment.map(p=>({root:p.root.toArray(),rotations:p.rotations.map(q=>q.toArray())}));
      }
    } catch (error) {fail(error);} finally {pending = false;}
  }
  function constrain(pose: Pose) {
    // The direct solver has full authority during a drag. During generated
    // playback cap root and angular corrections, retaining model body motion.
    let corrected = held ? solveVisible(pose,held.joint,held.target,supports,false) : clonePose(pose);
    if (heldRotation) {
      const j = jointIndex(heldRotation.joint);
      rotateBranch(corrected,avatar.rig,j,heldRotation.rotation.clone().multiply(corrected.rotations[j].clone().invert()));
      ik.limit(corrected,j);
    }
    return boundedCorrection(pose,corrected);
  }
  let last = performance.now(), lastReport = 0;
  renderer.setAnimationLoop(() => {
    const now = performance.now(), delta = Math.min((now-last)/1000,0.05); last = now;
    if (!document.hidden) {
      if (running && loaded && !pending && response.ready(now) && response.remaining < 0.12) void generate();
      response.advance(delta,running,running && (held || heldRotation) ? constrain : undefined);
    }
    const pose = response.pose; avatar.apply(pose);
    const mmd = characters.current;
    if (mmd && !document.hidden) {
      try {mmd.apply(pose,delta,true);} catch (error) {
        clearTargets(); response.reset(pose,now); void characters.select(); character.value = 'soma';
        el('character-status').textContent = `MMD physics stopped: ${String(error)}`;
      }
    }
    if (!pointer.active) controls.update();
    pointer.update(visiblePoint);
    if (characters.current) characters.current.effect.render(scene,camera); else renderer.render(scene,camera);
    if (now-lastReport > 250) {
      lastReport = now;
      const rect = renderer.domElement.getBoundingClientRect();
      report.handles = Object.fromEntries(EFFECTORS.map(joint => {
        const world = visiblePoint(joint), screen = world.clone().project(camera);
        return [joint,{world:world.toArray(),screen:[rect.left+(screen.x+1)/2*rect.width,rect.top+(1-screen.y)/2*rect.height]}];
      }));
      report.root = pose.root.toArray(); report.rotations = pose.rotations.map(q=>q.toArray());
      report.camera = camera.position.toArray();
      report.revision = response.revision; report.edits = edits; report.generations = response.generations;
      report.discarded = response.discarded; report.active = pointer.active; report.orbitEnabled = controls.enabled;
      report.targetErrorMeters = held ? visiblePoint(held.joint).distanceTo(held.target) : 0;
      if (held && report.targetErrorMeters > 0.05)
        el('interaction').textContent = `${held.joint} · reach limit · ${(report.targetErrorMeters*100).toFixed(0)} cm from target`;
      else if (el('interaction').textContent?.includes('reach limit'))
        el('interaction').textContent = `${pointer.selected} · target retained`;
      report.mmd = mmd ? {physicsEnabled:mmd.physicsEnabled,steps:mmd.physics.steps,allocations:mmd.physics.allocations,
        maximumSecondaryAngle:mmd.physics.maximumSecondaryAngle,shading:mmd.shading} : undefined;
      if (running) {
        const points = positions(pose,avatar.rig);
        report.trace.push({time:now,root:pose.root.toArray(),hand:points[13].toArray(),foot:points[24].toArray(),source:report.source});
        if (report.trace.length > 120) report.trace.shift();
      }
      el('diagnostics').textContent = JSON.stringify(report,null,2);
      el('generations').textContent = String(response.generations);
      el('latency').textContent = latency ? `${Math.round(latency)} ms` : '—';
      el('playback').textContent = running ? `${response.remaining.toFixed(2)} s${pending ? ' · inferring' : response.remaining === 0 ? ' · holding' : ''}` : loaded ? 'Paused' : 'IK only';
    }
  });
  const visibility = () => {pointer.cancel(); characters.current?.reset();};
  document.addEventListener('visibilitychange',visibility);
  el('download').onclick = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));
    const a = document.createElement('a'); a.href = url; a.download = 'motionbricks-pose-report.json'; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  el('interaction').textContent = 'Rest pose · drag a handle';
  window.addEventListener('pagehide',event => {
    pointer.cancel();
    if (event.persisted) return;
    removeEventListener('keydown',keyboard); document.removeEventListener('visibilitychange',visibility);
    pointer.dispose(); inference?.dispose(); characters.dispose(); avatar.dispose(); stage.dispose();
  });
}
main().catch(error => {status.textContent = `Character preview unavailable: ${String(error)}`; el('interaction').textContent = 'Character could not load';});
