import { BufferGeometry, Float32BufferAttribute, Line, LineBasicMaterial, LineLoop, Mesh, MeshBasicMaterial, Quaternion, SphereGeometry, Vector3 } from 'three';
import { BalanceRecovery, PUSH_JOINTS, recoveryTrace } from './balance';
import { createStage } from './stage';
import { SomaAvatar } from './avatar';
import { CharacterSelection } from './characters';
import type { MMDCharacter } from './mmd';
import { blendPose, clonePose, decode, encode, positions, type Pose } from './motion';
import { EFFECTORS, jointIndex, PoseIK, type Effector, type PoseConstraint } from './pose-ik';
import { PosePointer, type Manipulation } from './pose-pointer';
import { boundedCorrection, type PoseResponse, responseProblem } from './pose-response';
import { encodeInteraction, InteractionResponse, jointChanges, serializePose } from './interaction';
import { Inference } from './inference';
import model from '../model-source.json';
import './style.css';
import './pose.css';

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const status = el('status'), load = el<HTMLButtonElement>('load'), pause = el<HTMLButtonElement>('pause');
const modelURL = import.meta.env.PROD ? model.url : new URL(`${import.meta.env.BASE_URL}assets/mmm_v6_soma_fp32.onnx`,location.href).href;
const report: Record<string,any> = {time:new Date().toISOString(),webgpu:Boolean(navigator.gpu),model:modelURL,modelRevision:model,
  generations:0,discarded:0,trace:[],source:'IK only'};
el('model-source').textContent = import.meta.env.PROD ? 'Load downloads 758 MB from NVIDIA. Browser caching is temporary.'
  : 'Load uses the local 758 MB model (npm run assets:model).';

async function main() {
  const stage = await createStage(el('stage')), {scene,camera,renderer,controls} = stage;
  report.renderer = 'isWebGPUBackend' in renderer.backend ? 'WebGPUBackend' : 'WebGLBackend';
  const avatar = await SomaAvatar.load(`${import.meta.env.BASE_URL}assets/soma.glb`).catch(error => {stage.dispose(); throw error;}); scene.add(avatar.object);
  const ik = new PoseIK(avatar.rig,avatar.stance), editor = new InteractionResponse(avatar.stance);
  const balance = new BalanceRecovery(avatar.stance,avatar.rig,ik);
  let response: PoseResponse = editor;
  const pushOrigin = new Vector3();
  let impulse: {start:number;direction:Vector3} | undefined;
  const supportLine = new LineLoop(new BufferGeometry(),new LineBasicMaterial({color:0x9de2ca,depthTest:false}));
  supportLine.geometry.setAttribute('position',new Float32BufferAttribute(new Float32Array(24),3));
  const pushLine = new Line(new BufferGeometry(),new LineBasicMaterial({color:0xffd07a,depthTest:false}));
  const comDot = new Mesh(new SphereGeometry(.025,10,8),new MeshBasicMaterial({color:0x9de2ca,depthTest:false}));
  scene.add(supportLine,pushLine,comDot);
  const character = el<HTMLSelectElement>('character'), effector = el<HTMLSelectElement>('effector');
  const plant = el<HTMLInputElement>('plant'), physics = el<HTMLInputElement>('mmd-physics');
  let base = clonePose(response.pose), held: PoseConstraint | undefined, supports: PoseConstraint[] = [];
  const controlOrigin = new Vector3();
  let heldRotation: {joint:Effector; rotation:Quaternion} | undefined;
  let inference: Inference | undefined, pending = false, running = false, loaded = false, latency = 0;
  let edits = 0;
  const characters = new CharacterSelection<MMDCharacter>(mmd => {
    avatar.object.visible = !mmd; el('physics-control').hidden = !mmd;
    if (mmd) {mmd.setPhysics(physics.checked); scene.add(mmd.object);}
    report.character = mmd ? mmd.label : 'SOMA';
  });
  const visiblePoint = (joint: Effector) => characters.current?.handle(joint) ?? positions(response.pose,avatar.rig)[jointIndex(joint)];
  const captureSupports = (pose: Pose, joint: Effector) => plant.checked
    ? (['LeftFoot','RightFoot'] as const).filter(name => name !== joint).map(name => ({joint:name,target:positions(pose,avatar.rig)[jointIndex(name)]})) : [];
  // Convert displacement at the visible retargeted joint back to canonical SOMA.
  // A few feedback iterations compensate for different MMD limb proportions.
  function solveVisible(input: Pose, joint: Effector, target: Vector3, planted: PoseConstraint[]): Pose {
    let pose = clonePose(input), canonicalTarget = positions(pose,avatar.rig)[jointIndex(joint)];
    const mmd = characters.current;
    if (!mmd) return ik.direct(input,{joint,target},planted);
    for (let i = 0; i < 4; i++) {
      mmd.preview(pose);
      const visible = mmd.handle(joint)!;
      canonicalTarget.add(target.clone().sub(visible).multiplyScalar(1 / mmd.heightRatio));
      pose = ik.direct(input,{joint,target:canonicalTarget},planted);
    }
    return pose;
  }
  const edit = (pose: Pose, kind: 'position IK' | 'orientation') => {
    response.pose = pose; edits++; report.source = loaded && running ? 'MotionBricks + direct-part IK' : 'IK-only direct preview';
    if (loaded && running) status.textContent = 'Experimental ONNX response · direct part constrained';
    el('interaction').textContent = `${pointer.selected} · ${kind} · ${loaded && running ? 'release lets the model settle' : 'IK-only preview'}`;
  };
  const manipulate = (change: Manipulation, begin: boolean) => {
    effector.value = change.joint;
    if (pointer.mode === 'push') {
      if (begin) {
        impulse=undefined; pushOrigin.copy(visiblePoint(change.joint)); balance.begin(performance.now());
        report.recoverySequences=[];delete report.lastRecovery;
      }
      if (change.position) {
        balance.push(change.position.clone().sub(pushOrigin).multiplyScalar(1/(characters.current?.heightRatio ?? 1)),performance.now());
        report.source='Deterministic disturbance IK';
      }
      return;
    }
    if (begin) {
      base = clonePose(response.pose);
      controlOrigin.copy(visiblePoint(change.joint));
      held = pointer.mode === 'move' ? {joint:change.joint,target:visiblePoint(change.joint)} : undefined;
      heldRotation = pointer.mode === 'rotate' ? {joint:change.joint,rotation:base.rotations[jointIndex(change.joint)].clone()} : undefined;
      supports = captureSupports(base,change.joint);
      editor.begin(change.joint,held ? positions(base,avatar.rig)[jointIndex(change.joint)] : undefined,heldRotation?.rotation,performance.now());
    }
    if (change.position) {
      heldRotation = undefined;
      const target = change.position.clone();
      if (change.joint==='Hips') target.sub(controlOrigin).clampLength(0,.25*(characters.current?.heightRatio ?? 1)).add(controlOrigin);
      if (change.joint.includes('Foot')) target.y = Math.max(0.04,target.y);
      held = {joint:change.joint,target};
      const canonical = positions(response.pose,avatar.rig)[jointIndex(change.joint)].clone()
        .add(target.clone().sub(visiblePoint(change.joint)).multiplyScalar(1/(characters.current?.heightRatio ?? 1)));
      editor.update(canonical,undefined,performance.now());
      edit(constrain(response.pose),'position IK');
    } else if (change.rotation) {
      held = undefined;
      const delta = change.rotation.clone(), angle = new Quaternion().angleTo(delta);
      if (change.joint==='Hips' && angle>.4) delta.slerp(new Quaternion(),1-.4/angle);
      const pose = ik.rotate(base,change.joint,delta);
      heldRotation = {joint:change.joint,rotation:pose.rotations[jointIndex(change.joint)].clone()};
      editor.update(undefined,heldRotation.rotation,performance.now()); edit(constrain(response.pose),'orientation');
    }
  };
  const pointer = new PosePointer(renderer.domElement,camera,controls,manipulate,() => {
    if(pointer.mode==='push') {balance.release(performance.now());el('interaction').textContent='Push released · recovery requested';}
    else {editor.release(performance.now());el('interaction').textContent = loaded && running ? `${pointer.selected} · released · model settling` : `${pointer.selected} · IK-only pose retained`;}
  }); scene.add(pointer.object);
  const clearTargets = () => {pointer.cancel(); impulse=undefined; held = undefined; heldRotation = undefined; supports = [];};
  const reset = () => {
    clearTargets(); editor.reset(avatar.stance,performance.now()); balance.reset(performance.now()); characters.current?.reset();
    report.source = 'IK only'; el('interaction').textContent = pointer.mode==='push' ? 'Rest pose · push a body dot' : 'Rest pose · drag a handle';
    report.recoverySequences=[];delete report.lastRecovery;report.interactionSequences=[];report.displayedInteraction=[];
  };
  el('reset').onclick = reset;
  for (const mode of ['push','move','rotate'] as const) el(mode).onclick = () => {
    const current=clonePose(response.pose);
    clearTargets(); response.edit(current,performance.now()); pointer.mode = mode;
    response=mode==='push' ? balance.response : editor;
    if(mode==='push') balance.reset(performance.now(),current); else response.reset(current,performance.now());
    pointer.selected=mode==='push' ? 'Chest' : 'LeftHand';effector.value=pointer.selected;
    for(const option of effector.options) option.hidden=mode==='push'
      ? !PUSH_JOINTS.includes(option.value as typeof PUSH_JOINTS[number]) : false;
    el('push-controls').hidden=mode!=='push';el('pose-examples').hidden=mode==='push';plant.disabled=mode==='push';
    el('plant-control').hidden=el('strength-control').hidden=mode==='push';
    el('mode-help').textContent=mode==='push'
      ? 'Push a chest, shoulder or hips dot; release to request recovery. Arrows push in world X/Z. Esc releases. Empty space orbits; scroll zooms.'
      : 'Hold and drag a body dot; Rotate turns around camera axes. Load MotionBricks for experimental responses during dragging and release. Arrows move; Shift + arrows rotate. Empty space orbits; scroll zooms; Esc releases.';
    report.source='IK only';
    for (const name of ['push','move','rotate']) el(name).setAttribute('aria-pressed',String(name === mode));
  };
  effector.onchange = () => {clearTargets(); editor.edit(editor.pose,performance.now()); pointer.selected = effector.value as Effector;};
  plant.onchange = () => {supports = captureSupports(response.pose,pointer.selected); response.invalidatePlayback();};
  physics.onchange = () => characters.current?.setPhysics(physics.checked);
  character.disabled = false;
  character.onchange = async () => {
    clearTargets(); editor.reset(avatar.stance,performance.now()); balance.reset(performance.now()); characters.current?.reset();
    pointer.selected = pointer.mode==='push' ? 'Chest' : 'LeftHand'; effector.value = pointer.selected;
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
    manipulate({joint},true); manipulate({joint,position:visiblePoint(joint).add(offset)},false); editor.release(performance.now());
  }
  el('reach').onclick = () => example('LeftHand',new Vector3(0.12,0.3,-0.25));
  el('step').onclick = () => example('LeftFoot',new Vector3(0,0.12,-0.25));
  function pushExample(direction: Vector3) {
    if(pointer.mode!=='push') el('push').click();
    clearTargets();balance.begin(performance.now());
    report.recoverySequences=[];
    delete report.lastRecovery;
    impulse={start:performance.now(),direction:direction.multiplyScalar(Number(el<HTMLSelectElement>('push-size').value))};
    report.source='Deterministic disturbance IK';
  }
  el('push-left').onclick=()=>pushExample(new Vector3(-1,0,0));
  el('push-right').onclick=()=>pushExample(new Vector3(1,0,0));
  el('push-forward').onclick=()=>pushExample(new Vector3(0,0,-1));
  el('push-back').onclick=()=>pushExample(new Vector3(0,0,1));
  const keyboard = (event: KeyboardEvent) => {
    if (!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key) || pointer.active
      || (event.target instanceof HTMLElement && event.target.closest('input,select,button,summary'))) return;
    event.preventDefault();
    if(pointer.mode==='push') {
      pushExample(new Vector3(event.key==='ArrowLeft' ? -1 : event.key==='ArrowRight' ? 1 : 0,0,
        event.key==='ArrowUp' ? -1 : event.key==='ArrowDown' ? 1 : 0));return;
    }
    const joint = pointer.selected;
    manipulate({joint},true);
    if (event.shiftKey || pointer.mode === 'rotate') {
      manipulate({joint,rotation:new Quaternion().setFromAxisAngle(new Vector3(0,1,0),event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -0.08 : 0.08)},false);
    } else {
      const offset = new Vector3(event.key === 'ArrowLeft' ? -0.03 : event.key === 'ArrowRight' ? 0.03 : 0,
        event.key === 'ArrowUp' ? 0.03 : event.key === 'ArrowDown' ? -0.03 : 0,0);
      manipulate({joint,position:visiblePoint(joint).add(offset)},false);
    }
    editor.release(performance.now());
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
      response.reanchorPlayback();
      loaded = true; running = true; pause.disabled = false; pause.textContent = 'Pause generation';
      status.textContent = 'Model loaded · waiting for ONNX response';
    } catch (error) {fail(error);} finally {pending = false;}
  };
  pause.onclick = () => {
    running = !running; response.invalidatePlayback();
    pause.textContent = running ? 'Pause generation' : 'Resume generation';
    status.textContent = running ? 'Waiting for ONNX response' : 'Generation paused · posing remains active';
  };
  el<HTMLInputElement>('strength').oninput = () => response.invalidatePlayback();
  async function generate() {
    if (!inference || pending) return;
    pending = true;
    const strength = Number(el<HTMLInputElement>('strength').value), isPush=pointer.mode==='push';
    const controller=response;
    const interactionRequest = isPush ? undefined : editor.request(strength);
    const request = interactionRequest ?? balance.request();
    const encoded = interactionRequest ? encodeInteraction(interactionRequest,avatar.rig,strength) : encode(request.context,request.targets,avatar.rig);
    const {features,placement} = encoded;
    try {
      const result = await inference.run(features); latency = result.milliseconds;
      const segment = decode(result.data,result.tokens,placement);
      if (!isPush && controller===response && request.revision === controller.revision) {
        const problem = responseProblem(segment,avatar.rig);
        if (problem) {
          running = false; response.edit(response.pose,performance.now());
          report.rejected = (report.rejected ?? 0)+1; report.rejectedReason = problem; report.source = 'IK only';
          status.textContent = `IK only · ${problem}. Adjust/reset pose, then resume to retry.`;
          pause.textContent = 'Resume generation'; return;
        }
      }
      const rawTrace=isPush ? recoveryTrace(segment,avatar.rig,request.context[3],balance.floor) : undefined;
      const current=controller===response && request.revision===controller.revision;
      if(isPush && current) report.lastRecovery={revision:request.revision,modelRevision:model,source:'Raw decoded MotionBricks ONNX',
        // Pinned SOMA output channels 362..365: left heel/toe, right heel/toe.
        // Preserve raw confidence (including out-of-range values) independently
        // of geometric contact inference. This does not grant IK authority.
        predictedFootContactOrder:['left heel','left toe','right heel','right toe'],
        predictedFootContacts:segment.map((_,i)=>Array.from(result.data.subarray((i+3)*366+362,(i+4)*366))),
        conditioningStage:balance.attempts===0 && balance.needsStep ? 'lift intention'
          : balance.attempts>=2 && balance.needsStep ? 'observed landing / settling' : 'grounded recovery',
        tokens:result.tokens,rawMotion:new URL(location.href).searchParams.has('captureMotion')
          ? segment.map(p=>({root:p.root.toArray(),rotations:p.rotations.map(q=>q.toArray())})) : undefined,
        context:request.context.map(p=>({root:p.root.toArray(),rotations:p.rotations.map(q=>q.toArray())})),
        targets:request.targets.map(p=>({root:p.root.toArray(),rotations:p.rotations.map(q=>q.toArray())})),
        milliseconds:latency,rawTrace,correctionBounds:{radians:.18,rootMeters:.025,seamFrames:8}};
      if(isPush && current) {
        report.recoverySequences ??=[];
        report.recoverySequences.push(report.lastRecovery);
        if(report.recoverySequences.length>6) report.recoverySequences.shift();
      }
      if(!isPush && current) {
        const evidence = {generation:controller.generations+1,requestedAt:interactionRequest?.now,revision:request.revision,source:'Raw decoded MotionBricks ONNX',milliseconds:latency,
          tokens:result.tokens,context:request.context.map(serializePose),neutralTargets:request.targets.map(serializePose),
          control:interactionRequest?.control,controls:interactionRequest?.controls,
          features:Object.fromEntries(Object.entries(features).map(([k,v])=>[k,Array.from(v)])),
          rawMotion:segment.map(serializePose),perJointRawChange:jointChanges(segment[0],segment.at(-1)!,avatar.rig),
          rawRootTravel:segment.at(-1)!.root.distanceTo(segment[0].root),
          correctionBounds:{radians:.45,rootMeters:.08,releaseSeconds:.35,seamFrames:8}};
        report.interactionSequences ??=[]; report.interactionSequences.push(evidence);
        if(report.interactionSequences.length>12) report.interactionSequences.shift();
      }
      const accepted=controller!==response ? (controller.discarded++,false) : isPush ? balance.accept(segment,request.revision,performance.now()) : controller.accept(segment,request.revision);
      if(isPush && current && !accepted) {
        report.lastRecovery.problem=balance.problem;report.source='ONNX rejected · deterministic disturbed pose held';
        status.textContent=balance.problem ?? 'Stale recovery discarded';
      }
      if (accepted && current) {
        report.source = isPush ? 'MotionBricks + bounded contacts' : 'MotionBricks + direct-part IK'; status.textContent = isPush
          ? 'Actual ONNX recovery candidate · bounded contacts · capability unverified' : editor.correctionWeight>0
          ? 'Experimental ONNX motion · direct part constrained' : 'Experimental ONNX motion · released / settling';
        report.lastGeneration = {revision:request.revision,tokens:result.tokens,frames:segment.length,milliseconds:latency,targetStrength:isPush ? undefined : strength,
          contextRoots:request.context.map(p=>p.root.toArray()),targetRoots:request.targets.map(p=>p.root.toArray()),
          contextEnd:positions(request.context[3],avatar.rig).map(p=>p.toArray()),neutralTargetEnd:positions(request.targets[3],avatar.rig).map(p=>p.toArray()),
          rawStart:positions(segment[0],avatar.rig).map(p=>p.toArray()),rawEnd:positions(segment.at(-1)!,avatar.rig).map(p=>p.toArray()),
          target:held ? {joint:held.joint,world:held.target.toArray()} : undefined};
        if (new URL(location.href).searchParams.has('captureMotion')) report.motionSample = segment.map(p=>({root:p.root.toArray(),rotations:p.rotations.map(q=>q.toArray())}));
      }
    } catch (error) {fail(error);} finally {pending = false;}
  }
  function constrain(pose: Pose) {
    if (response !== editor || !editor.control) return pose;
    let corrected = held ? solveVisible(pose,held.joint,held.target,supports) : clonePose(pose);
    if (heldRotation) {
      const j = jointIndex(heldRotation.joint);
      corrected = ik.rotate(corrected,heldRotation.joint,heldRotation.rotation.clone().multiply(corrected.rotations[j].clone().invert()));
    }
    corrected = blendPose(pose,boundedCorrection(pose,corrected,.45,.08),editor.correctionWeight);
    report.directCorrection = jointChanges(pose,corrected,avatar.rig); report.playerSample=serializePose(pose);
    return corrected;
  }

  let last = performance.now(), lastReport = 0;
  renderer.setAnimationLoop(() => {
    const now = performance.now(), delta = Math.min((now-last)/1000,0.05); last = now;
    if (!document.hidden) {
      if(impulse) {
        const t=Math.min(1,(now-impulse.start)/240);balance.push(impulse.direction.clone().multiplyScalar(t),now);
        if(t===1) {impulse=undefined;balance.release(now);}
      }
      if (running && loaded && !pending && (pointer.mode==='push' ? balance.ready(now) : response.ready(now) && response.remaining<.12)) void generate();
      if(pointer.mode==='push') balance.advance(delta,running);
      else response.advance(delta,running,running && editor.correctionWeight>0 ? constrain : undefined);
    }
    const pose = response.pose; avatar.apply(pose);
    if (pointer.mode!=='push' && running && new URL(location.href).searchParams.has('captureMotion')) {
      report.displayedInteraction ??=[];
      report.displayedInteraction.push({time:now,revision:editor.revision,generation:editor.generations,
        generatedFrame:(report.lastGeneration?.frames ?? 18)-1-editor.remaining*30,
        held:editor.control?.held ?? false,control:editor.control ? JSON.parse(JSON.stringify(editor.control)) : undefined,
        player:editor.correctionWeight>0 ? report.playerSample : serializePose(pose),displayed:serializePose(pose),
        directCorrection:editor.correctionWeight>0 ? report.directCorrection : [],
        controlError:editor.control?.position ? positions(pose,avatar.rig)[jointIndex(editor.control.joint)].distanceTo(editor.control.position) : 0});
      if(report.displayedInteraction.length>360) report.displayedInteraction.shift();
    }
    const pushing=pointer.mode==='push', metrics=balance.metrics();
    supportLine.visible=comDot.visible=pushing;pushLine.visible=pushing && balance.phase==='pushing';
    if(pushing) {
      const coords=metrics.support.flatMap(p=>[p[0],.008,p[2]]);
      const attribute=supportLine.geometry.getAttribute('position');
      for(let i=0;i<coords.length;i++) attribute.array[i]=coords[i];
      attribute.needsUpdate=true;supportLine.geometry.setDrawRange(0,coords.length/3);supportLine.geometry.computeBoundingSphere();
      comDot.position.fromArray(metrics.com).setY(.015);
      const chest=visiblePoint('Chest');
      pushLine.geometry.setFromPoints([chest,chest.clone().add(balance.displacement)]);
    }
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
      report.mode=pointer.mode;
      if(pushing) {
        report.balance=metrics;report.displayedRecoveryTrace=balance.displayedTrace;
        el('balance-status').textContent=`${balance.phase==='pushing' ? 'Actively pushed · deterministic IK' : balance.phase==='stable'
          ? balance.generated ? 'Stable by estimated support metrics · inspect raw evidence' : 'Stable stance'
          : balance.problem ? `Recovery limited · ${balance.problem}` : !loaded ? 'Recovering · load MotionBricks to continue'
          : !running ? 'Recovering · generation paused' : 'Recovering · ONNX candidate'}${balance.needsStep ? balance.phase==='stable' ? ' · step conditioned' : ' · step needed' : ''}`;
        el('interaction').textContent=balance.phase==='stable' && !balance.generated ? 'Rest pose · push a body dot'
          : `Support margin ${(metrics.margin*100).toFixed(1)} cm · torso ${(metrics.tilt*180/Math.PI).toFixed(1)}°`;
      }
      report.root = pose.root.toArray(); report.rotations = pose.rotations.map(q=>q.toArray());
      report.camera = camera.position.toArray();
      report.revision = response.revision; report.edits = edits; report.generations = response.generations;
      report.discarded = response.discarded; report.active = pointer.active; report.control=editor.control; report.correctionWeight=editor.correctionWeight; report.orbitEnabled = controls.enabled;
      report.targetErrorMeters = held ? visiblePoint(held.joint).distanceTo(held.target) : 0;
      if (!pushing && held && editor.correctionWeight>0 && report.targetErrorMeters > 0.05)
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
      // Full traces stay in Save report; avoid rendering megabytes of JSON in
      // ordinary interaction. Validation opts into all samples explicitly.
      const diagnostics=new URL(location.href).searchParams.has('captureMotion') ? report : {...report,
        interactionSequences:report.interactionSequences?.map((s: any)=>({revision:s.revision,source:s.source,milliseconds:s.milliseconds,perJointRawChange:s.perJointRawChange})),
        displayedInteraction:report.displayedInteraction ? `${report.displayedInteraction.length} frames · Save report for full traces` : undefined,
        recoverySequences:report.recoverySequences?.map((s: any)=>({revision:s.revision,source:s.source,frames:s.rawTrace.length,milliseconds:s.milliseconds,problem:s.problem})),
        lastRecovery:report.lastRecovery ? {revision:report.lastRecovery.revision,source:report.lastRecovery.source,
          frames:report.lastRecovery.rawTrace.length,correctionBounds:report.lastRecovery.correctionBounds,problem:report.lastRecovery.problem} : undefined,
        displayedRecoveryTrace:`${balance.displayedTrace.length} samples · Save report for full traces`};
      el('diagnostics').textContent = JSON.stringify(diagnostics,null,2);
      el('generations').textContent = String(response.generations);
      el('latency').textContent = latency ? `${Math.round(latency)} ms` : '—';
      el('playback').textContent = running ? `${response.remaining.toFixed(2)} s${pending ? ' · inferring' : response.remaining === 0 ? ' · holding' : ''}` : loaded ? 'Paused' : 'IK only';
    }
  });
  const visibility = () => {pointer.cancel(); if(impulse) {impulse=undefined;balance.release(performance.now());} response.edit(response.pose,performance.now());characters.current?.reset();};
  document.addEventListener('visibilitychange',visibility);
  el('download').onclick = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));
    const a = document.createElement('a'); a.href = url; a.download = 'motionbricks-pose-report.json'; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  el('move').click();
  el('interaction').textContent = 'Rest pose · drag a body dot';
  window.addEventListener('pagehide',event => {
    pointer.cancel();
    if (event.persisted) return;
    removeEventListener('keydown',keyboard); document.removeEventListener('visibilitychange',visibility);
    for(const object of [supportLine,pushLine,comDot]) {object.geometry.dispose();object.material.dispose();object.removeFromParent();}
    pointer.dispose(); inference?.dispose(); characters.dispose(); avatar.dispose(); stage.dispose();
  });
}
main().catch(error => {status.textContent = `Character preview unavailable: ${String(error)}`; el('interaction').textContent = 'Character could not load';});
