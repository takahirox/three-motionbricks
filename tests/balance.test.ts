import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Quaternion, Vector3 } from 'three';
import { blendPose, clonePose, encode, positions } from '../src/motion.ts';
import { PoseIK } from '../src/pose-ik.ts';
import { BalanceRecovery, disturbedPose, FootContacts, recoveryTargets, supportMargin, supportPolygon, torsoTilt } from '../src/balance.ts';
import { somaFixture } from './mmd-fixture.ts';
const {stance,rig}=somaFixture(), ik=new PoseIK(rig,stance), initial=positions(stance,rig);
const feet = [{joint:'LeftFoot' as const,target:initial[24]},{joint:'RightFoot' as const,target:initial[28]}];
const floor=[initial[24].y,initial[28].y];

test('signed support hull handles double/single/absent contacts, rotation and capture outside support',()=> {
  const polygon=supportPolygon([new Vector3(-.1,0,0),new Vector3(.1,0,0)],0);
  assert.ok(supportMargin(new Vector3(),polygon)>.1);
  assert.ok(supportMargin(new Vector3(.3,0,0),polygon)<0);
  assert.ok(supportMargin(new Vector3(.1,0,0),supportPolygon([new Vector3(.1,0,0)],Math.PI/2))>0);
  assert.ok(supportMargin(new Vector3(),[])<0);
});

test('bounded disturbance tilts body with arm participation, planted feet and unchanged bone lengths',()=> {
  for(const d of [new Vector3(.07,0,0),new Vector3(-.34,0,0),new Vector3(0,0,.34)]) {
    const pose=disturbedPose(stance,d,rig,ik), p=positions(pose,rig);
    assert.ok(torsoTilt(pose,rig)>d.length()*.9);
    assert.ok(pose.root.distanceTo(stance.root)<.19);
    for(const j of [24,28]) assert.ok(p[j].distanceTo(initial[j])<.012,`Foot ${j}: ${p[j].distanceTo(initial[j])}`);
    assert.ok(Math.min(...p.map(v=>v.y))>=0,'Planted soles do not penetrate the floor');
    assert.ok(pose.rotations[11].angleTo(stance.rotations[11])>.01);
    for(let j=1;j<30;j++) assert.ok(Math.abs(p[j].distanceTo(p[rig.parents[j]])-rig.offsets[j].length())<1e-6);
  }
  const extreme=disturbedPose(stance,new Vector3(100,0,0),rig,ik);
  assert.ok(extreme.root.distanceTo(stance.root)<.21);
});

test('recovery targets are upright full-body landing intentions rather than held disturbed poses',()=> {
  const disturbed=disturbedPose(stance,new Vector3(.34,0,0),rig,ik);
  for(const step of [false,true]) {
    const targets=recoveryTargets(stance,stance,new Vector3(.34,0,0),step,rig,ik,feet);
    assert.equal(targets.length,4);
    assert.ok(torsoTilt(targets[3],rig)<.06);
    assert.ok(targets[3].rotations[3].angleTo(disturbed.rotations[3])>.2);
    const p=positions(targets[3],rig), travel=Math.max(p[24].distanceTo(initial[24]),p[28].distanceTo(initial[28]));
    assert.ok(Math.min(...p.map(v=>v.y))>=0,'Landing targets retain level soles after knee flexion');
    assert.ok(step ? travel>.25 : travel<.01);
    const {features}=encode([stance,stance,stance,disturbed],targets,rig);
    assert.deepEqual(Object.values(features).map(v=>v.length),[40,32,2136,8,8,8,11]);
    for(const values of Object.values(features)) assert.ok(values.every(Number.isFinite));
  }
  const airborne=recoveryTargets(stance,stance,new Vector3(.34,0,0),true,rig,ik,feet,true);
  assert.ok(positions(airborne[3],rig)[24].y>floor[0]+.06);
  assert.ok(Math.min(...positions(airborne[3],rig).map(p=>p.y))>=0);
});

test('release captures observed disturbance history; stale inference cannot outlive pushes, pause, reset or switching',()=> {
  const balance=new BalanceRecovery(stance,rig,ik);
  balance.begin(0);
  for(let n=1;n<=8;n++) {balance.push(new Vector3(n*.035,0,0),n*1000/30);balance.advance(1/30,false);}
  assert.equal(balance.phase,'pushing');assert.equal(balance.needsStep,true);
  balance.release(300);assert.equal(balance.phase,'recovering');
  const request=balance.request();
  assert.ok(request.context[0].rotations[3].angleTo(request.context[3].rotations[3])>.02);
  assert.ok(request.context[3].rotations[3].angleTo(balance.pose.rotations[3])<1e-6);
  balance.advance(5,false);assert.equal(balance.phase,'recovering','An offset hold never reports stable');
  assert.deepEqual(balance.request().context.map(p=>p.root.toArray()),request.context.map(p=>p.root.toArray()));
  const segment=Array.from({length:24},()=>clonePose(stance));
  balance.begin(500);assert.equal(balance.accept(segment,request.revision,600),false);
  balance.push(new Vector3(-.07,0,0),650);balance.release(700);const paused=balance.request();
  balance.invalidate(750);assert.equal(balance.accept(segment,paused.revision,800),false);
  const switched=balance.request();balance.reset(900);assert.equal(balance.accept(segment,switched.revision,1000),false);
  assert.equal(balance.phase,'stable');assert.equal(balance.response.generations,0);
});

test('contact hysteresis releases generated swings, replants quiet landings and preserves the opposite support',()=> {
  const contacts=new FootContacts(stance,rig,floor);
  const swing=ik.solve(stance,{joint:'LeftFoot',target:initial[24].clone().add(new Vector3(0,.12,-.25))},[feet[1]]);
  assert.equal(new FootContacts(swing,rig,floor).contacts[0].planted,false,'An airborne initial foot is not an invented support');
  contacts.update(swing,1/30);
  assert.equal(contacts.contacts[0].planted,false);assert.equal(contacts.contacts[1].planted,true);
  assert.equal(contacts.contacts[0].releases,1);
  contacts.update(stance,1/30);assert.equal(contacts.contacts[0].planted,false,'Fast touchdown does not immediately lock');
  contacts.update(stance,1/30);assert.equal(contacts.contacts[0].planted,true);assert.equal(contacts.contacts[0].replants,1);
  const balance=new BalanceRecovery(stance,rig,ik);
  balance.reset(0,swing);balance.begin(100);
  assert.equal(balance.contacts.contacts[0].planted,false,'A repeated push preserves an airborne foot');
});

function repeatLargePushes(balance: BalanceRecovery, start: number) {
  let rejected=0;
  for(let episode=0;episode<8;episode++) {
    const now=start+episode*500, before=clonePose(balance.pose), contacts=balance.contacts.snapshot();
    balance.begin(now);
    assert.deepEqual(balance.pose,before,'Interrupting recovery must not move the body');
    assert.deepEqual(balance.contacts.snapshot(),contacts,'Interrupting recovery must retain contact history');
    for(let frame=1;frame<=8;frame++) {
      const safe=clonePose(balance.pose), context=balance.response.observedContext(), revision=balance.response.revision;
      const displacement=balance.displacement.clone(), velocity=balance.velocity.clone();
      balance.push(new Vector3(.34*frame/8,0,0),now+frame*30);
      if(balance.problem) {
        rejected++;
        assert.match(balance.problem,/Disturbance.*safety|Disturbance.*bounds|Disturbance.*floor/);
        assert.deepEqual(balance.pose,safe,'Unsafe disturbance must retain the last safe displayed pose');
        assert.deepEqual(balance.response.observedContext(),context,'Rejected candidates must not enter context');
        assert.equal(balance.response.revision,revision);
        assert.deepEqual(balance.displacement,displacement);
        assert.deepEqual(balance.velocity,velocity);
      }
      assert.equal(balance.boundsProblem([balance.pose]),undefined,'Every displayed disturbance must stay within body bounds');
      assert.deepEqual(balance.contacts.snapshot(),contacts,'Pushes must retain anchors, counters and foot velocity history');
      balance.advance(1/30,false);
    }
    balance.release(now+250);
    assert.equal(balance.phase,'recovering');
    if(balance.problem) assert.equal(balance.ready(now+450),false,'Safety stops must remain explicit after release');
  }
  assert.ok(rejected>0,'Repeated large pushes must exercise the disturbance safety guard');
}

test('repeated large pushes while waiting for inference never accumulate unsafe tilt or floor penetration',()=> {
  const balance=new BalanceRecovery(stance,rig,ik);
  repeatLargePushes(balance,0);
  assert.equal(balance.response.generations,0);
  balance.reset(5000);
  assert.equal(balance.problem,undefined);assert.deepEqual(balance.pose,stance);
});

test('repeated pushes interrupting saved generated recovery preserve the safe pose and contact history',()=> {
  // Replay saved decoded ONNX output; this does not run fresh inference.
  const saved=JSON.parse(readFileSync(new URL('../docs/balance-traces.json',import.meta.url),'utf8'));
  const segment=saved.rawSequences[0].rawMotion.map((p: {root:number[];rotations:number[][]})=>({
    root:new Vector3().fromArray(p.root),rotations:p.rotations.map(q=>new Quaternion().fromArray(q).normalize())
  }));
  const balance=new BalanceRecovery(stance,rig,ik);
  balance.begin(0);balance.push(new Vector3(.34,0,0),240);balance.release(250);
  assert.ok(balance.accept(segment,balance.request().revision,500));
  for(let frame=0;frame<50 && !balance.contacts.contacts.some(c=>c.releases>0);frame++) balance.advance(1/30,true);
  assert.equal(balance.problem,undefined);
  assert.ok(balance.response.remaining>0,'Interrupt active playback');
  assert.ok(balance.contacts.contacts.some(c=>c.releases>0),'Exercise generated support switching');
  repeatLargePushes(balance,2500);
});

test('generated correction bounds preserve torso/arms; floor and collapsed predictions fail honestly',()=> {
  const balance=new BalanceRecovery(stance,rig,ik);
  const pose=disturbedPose(stance,new Vector3(.18,0,0),rig,ik), corrected=balance.correct(pose);
  assert.ok(corrected.root.distanceTo(pose.root)<=.025+1e-6);
  for(let j=0;j<30;j++) assert.ok(corrected.rotations[j].angleTo(pose.rotations[j])<=.18+1e-6);
  for(const j of [0,1,3,11,17]) assert.ok(corrected.rotations[j].angleTo(pose.rotations[j])<1e-6);
  balance.begin(0);balance.push(new Vector3(.07,0,0),100);balance.release(200);
  const bad=clonePose(stance);bad.root.y-=.4;
  assert.equal(balance.accept([bad,bad],balance.request().revision,300),false);
  assert.match(balance.problem!,/floor|standing/);assert.equal(balance.phase,'recovering');
  assert.equal(balance.response.generations,0);assert.equal(balance.ready(1000),false);
});

test('unsafe playback seam between valid input poses holds the last safe display and contact history',()=> {
  const balance=new BalanceRecovery(stance,rig,ik);
  // Synthetic input tests the seam safety guard, not ONNX recovery capability.
  // Opposite leg angles clear the floor at either endpoint. Interpolation
  // straightens the legs below the floor while the seam correction fades.
  const endpoints=[-.8,.8].map(angle=> {
    const pose=clonePose(stance);
    for(const j of [22,26]) pose.rotations[j].premultiply(new Quaternion().setFromAxisAngle(new Vector3(1,0,0),angle));
    return pose;
  });
  const minimum=Math.min(...endpoints.flatMap(p=>positions(p,rig).map(p=>p.y)));
  for(const pose of endpoints) pose.root.y+=.005-minimum;
  balance.reset(0,endpoints[0]);balance.begin(0);balance.release(100);
  const segment=Array.from({length:12},()=>clonePose(endpoints[1]));
  assert.equal(balance.boundsProblem(endpoints),undefined);
  assert.match(balance.boundsProblem([blendPose(endpoints[0],endpoints[1],.5)])!,/floor/);
  assert.ok(balance.accept(segment,balance.request().revision,300));
  const safePose=clonePose(balance.pose), safeContacts=balance.contacts.snapshot();
  balance.advance(1/30,true);
  assert.match(balance.problem!,/Playback safety stop:.*floor/);
  assert.deepEqual(balance.pose,safePose,'Rejected playback must retain the preceding safe pose');
  assert.ok(balance.metrics().minimumJointHeight>=-.025);
  assert.deepEqual(balance.contacts.snapshot(),safeContacts,'Rejected feet must not change anchors, counters or velocity history');
  assert.deepEqual(balance.response.observedContext(),Array.from({length:4},()=>safePose));
  assert.deepEqual(balance.displayedTrace.at(-1)!.joints,positions(safePose,rig).map(p=>p.toArray()));
  assert.equal(balance.phase,'recovering');assert.equal(balance.ready(1000),false);
  balance.advance(.1,true);
  assert.deepEqual(balance.pose,safePose,'A safety stop must keep holding the safe pose');
  assert.deepEqual(balance.contacts.snapshot(),safeContacts);
});

test('only played generated upright motion with settled contacts can transition to stable',()=> {
  const balance=new BalanceRecovery(stance,rig,ik);
  balance.begin(0);balance.push(new Vector3(.07,0,0),100);balance.release(200);
  // Synthetic test fixture exercises state handling only; never model evidence.
  assert.ok(balance.accept(Array.from({length:40},()=>clonePose(stance)),balance.request().revision,300));
  assert.equal(balance.phase,'recovering');
  for(let n=0;n<37;n++) balance.advance(1/30,true);
  assert.ok(balance.response.remaining<.12);
  assert.equal(balance.ready(2000),false,'Settled playback drains instead of perpetually requesting ahead');
  for(let n=0;n<63;n++) balance.advance(1/30,true);
  assert.equal(balance.phase,'stable');
  assert.equal(balance.generated,true);assert.ok(balance.displayedTrace.length>0);
  balance.begin(4000);assert.equal(balance.phase,'pushing');assert.equal(balance.generated,false);
  balance.reset(5000,disturbedPose(stance,new Vector3(.34,0,0),rig,ik));
  assert.equal(balance.phase,'recovering','Entering from an offset editor pose must not claim stable');
});
