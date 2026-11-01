// Numerical experiment on real MotionBricks output captured by --model --mmd.
// No captured animation is loaded by the demo or published to Pages.
import { readFile, writeFile } from 'node:fs/promises';
import { Quaternion, Vector3 } from 'three';
import { solvePose } from 'mmd-gltf/packages/mmd-solver';
import { ukaFixture, somaFixture, mmdFixture } from '../tests/mmd-fixture';
import { SomaRetargeter, ANIMASA_MAPPING, UKA_MAPPING } from '../src/retarget';
import { mmdPhysicsModel } from '../src/mmd-physics';
import { positions } from '../src/motion';

const args = process.argv.slice(2), animasa = args.includes('--animasa');
const trace = JSON.parse(await readFile(args.find(a=>a !== '--animasa') ?? '.artifacts/mmd-movement.json','utf8'));
const local = animasa ? await readFile('public/assets/animasa/model.glb') : undefined;
const soma = somaFixture(), {root} = local
  ? await mmdFixture(JSON.parse(local.subarray(20,20+local.readUInt32LE(12)).toString())) : await ukaFixture();
const retarget = new SomaRetargeter(root,soma.bind,soma.points,animasa ? ANIMASA_MAPPING : UKA_MAPPING), model = mmdPhysicsModel(root,true,animasa);
const names = ['左足首','左つま先','右足首','右つま先'];
const results = [];
for (const step of trace) {
  if (!step.report.motionSample?.length) throw new Error('Run browser smoke with --model --mmd to capture real generated poses first.');
  const errors: number[] = [], offHeights: number[] = [], onHeights: number[] = [], offTravel: number[] = [], onTravel: number[] = [];
  let previousOff: Vector3[] | undefined, previousOn: Vector3[] | undefined;
  for (const p of step.report.motionSample) {
    const pose = {root:new Vector3().fromArray(p.root),rotations:p.rotations.map((q: number[]) => new Quaternion().fromArray(q))};
    retarget.apply(pose);
    const off = names.map(n=>retarget.byName.get(n)!.getWorldPosition(new Vector3()));
    // Test the plausible IK strategy: drive ankle/toe controllers from source
    // positional motion, preserving MMD rest proportions with the hip scale.
    const source = positions(pose,soma.rig), hips = retarget.byName.get('下半身')!.getWorldPosition(new Vector3());
    for (const [name,index] of [['左足ＩＫ',24],['左つま先ＩＫ',25],['右足ＩＫ',28],['右つま先ＩＫ',29]] as const) {
      const bone = retarget.byName.get(name)!;
      const target = source[index].clone().sub(pose.root).multiplyScalar(retarget.heightRatio).add(hips);
      bone.position.copy(bone.parent!.worldToLocal(target)); root.updateMatrixWorld(true);
    }
    const raw = model.solver.bones.map(b=>({...b,translation:model.nodes.get(b.index)!.position.toArray(),rotation:model.nodes.get(b.index)!.quaternion.toArray()}));
    const solved = solvePose(model.solver,raw,model.controls);
    for(const b of solved) {const n=model.nodes.get(b.index)!;n.position.fromArray(b.translation);n.quaternion.fromArray(b.rotation);}
    root.updateMatrixWorld(true);
    const on = names.map(n=>retarget.byName.get(n)!.getWorldPosition(new Vector3()));
    for(let i=0;i<4;i++) {errors.push(off[i].distanceTo(on[i]));offHeights.push(off[i].y);onHeights.push(on[i].y);}
    if(previousOff && previousOn) for(let i=0;i<4;i++) {
      offTravel.push(off[i].distanceTo(previousOff[i]));onTravel.push(on[i].distanceTo(previousOn[i]));
    }
    previousOff=off;previousOn=on;
  }
  const mean = (v: number[])=>v.reduce((a,b)=>a+b,0)/v.length;
  results.push({state:step.state,frames:step.report.motionSample.length,
    meanIKCorrectionMeters:mean(errors),maximumIKCorrectionMeters:Math.max(...errors),
    fkMinimumFootJointHeight:Math.min(...offHeights),ikMinimumFootJointHeight:Math.min(...onHeights),
    fkMaximumFootFrameTravel:Math.max(...offTravel),ikMaximumFootFrameTravel:Math.max(...onTravel)});
}
const report = {character:animasa ? 'Animasa Miku' : 'CG-CA Uka', source:'Real official SOMA ONNX output, browser smoke capture; no VMD',
  strategy:'FK vs ankle/toe IK targets from the source foot positions relative to the hip, scaled to MMD hip height',results};
await writeFile('.artifacts/mmd-ik.json',JSON.stringify(report,null,2)+'\n'); console.log(JSON.stringify(report,null,2));
