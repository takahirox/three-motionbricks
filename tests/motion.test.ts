import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Quaternion, Vector3 } from 'three';
import { clonePose, decode, encode, heading, JOINTS, positions, rotation6D, targetsFor, type Pose, type Rig } from '../src/motion.ts';
import { readIntent } from '../src/input.ts';
import { MotionPlayer } from '../src/player.ts';

const near = (a: number, b: number, epsilon = 1e-5) => assert.ok(Math.abs(a - b) < epsilon, `${a} != ${b}`);
const rig: Rig = {parents: JOINTS.map((_, i) => i ? 0 : -1), offsets: JOINTS.map(() => new Vector3(0, 0.2, 0))};
rig.offsets[22].set(0.1, -0.1, 0); rig.offsets[26].set(-0.1, -0.1, 0);
const stance: Pose = {root: new Vector3(0, 1, 0), rotations: JOINTS.map(() => new Quaternion())};

test('keyboard normalizes diagonals, cancels opposites and selects run speed', () => {
  const diagonal = readIntent(new Set(['KeyW', 'ArrowRight', 'ShiftRight']));
  near(Math.hypot(diagonal.x, diagonal.z), 1); assert.equal(diagonal.speed, 4.5);
  assert.deepEqual(readIntent(new Set(['KeyW', 'ArrowDown'])), {x: 0, z: 0, speed: 0});
  assert.equal(readIntent(new Set(['KeyA'])).speed, 2.3);
});

test('hip heading and 6D matrix columns follow the official Y-up convention', () => {
  near(heading(positions(stance, rig)), 0);
  const q = rotation6D(new Float32Array([0, 0, -2, 0, 3, 0]), 0);
  const forward = new Vector3(0, 0, 1).applyQuaternion(q);
  near(forward.x, 1); near(forward.y, 0); near(forward.z, 0);
  assert.throws(() => rotation6D(new Float32Array(6), 0), /degenerate/);
});

test('encode preserves height, aligns the last context at ground origin and encodes 30 Hz velocity', () => {
  const context = Array.from({length: 4}, (_, i) => ({...clonePose(stance), root: new Vector3(50 + i / 30, 1, 80)}));
  const target = targetsFor(context[3], stance, {x: 1, z: 0, speed: 2.3}, rig);
  const {features: f, placement} = encode(context, target, rig);
  near(f.global_root_values[15], 0); near(f.global_root_values[16], 1); near(f.global_root_values[17], 0);
  near(Math.hypot(f.local_root_values[1], f.local_root_values[2]), 1);
  near(f.local_root_values[13], 0); near(f.local_root_values[14], 0);
  near(Math.hypot(f.local_root_values[17], f.local_root_values[18]), 2.3);
  assert.deepEqual([...f.has_local_poses], [1, 1, 1, 1, 1, 1, 1, 1]);
  assert.equal(f.local_poses.length, 2136); assert.equal(f.allowed_pred_num_tokens.length, 11);
  near(placement.origin.x, 50.1); near(placement.origin.y, 0);
  const p = target[0].root.clone().sub(context[3].root);
  near(p.x, 2.3 * 0.8); near(p.z, 0);
  assert.ok(target[0].rotations[22].angleTo(target[3].rotations[22]) > 0.01, 'Moving targets must contain a body stride, not only root travel');
  const stopped = encode(context, targetsFor(context[3], stance, {x:0,z:0,speed:0},rig),rig);
  assert.ok(stopped.features.has_local_poses.every(v=>v===1));
});

test('decode trims exactly six boundary frames, restores placement and rejects corrupt output', () => {
  const data = new Float32Array(64 * 366);
  for (let frame = 0; frame < 64; frame++) {
    data.set([frame / 30, 1, 0], frame * 366);
    for (let j = 0; j < 30; j++) data.set([1, 0, 0, 0, 1, 0], frame * 366 + 92 + j * 6);
  }
  const placement = {origin: new Vector3(10, 0, -8), rotation: new Quaternion().setFromAxisAngle(new Vector3(0,1,0),Math.PI/2)};
  const output = decode(data, 6, placement);
  assert.equal(output.length, 18); near(output[0].root.x, 10); near(output[0].root.z, -8.1);
  near(output[17].root.z, -8 - 20 / 30); near(output[0].root.y, 1);
  near(output[0].rotations[0].angleTo(placement.rotation), 0);
  assert.throws(() => decode(data, 17, placement), /Invalid SOMA/);
  data[0] = NaN; assert.throws(() => decode(data, 6, placement), /non-finite/);
});

test('queue rejects stale responses, corrects seams and holds through an underrun', () => {
  const player = new MotionPlayer(stance), request = player.request();
  const segment = Array.from({length: 24}, (_, i) => ({...clonePose(stance), root: new Vector3(3 + i / 30, 1, 0)}));
  assert.equal(player.accept(segment, request.revision), true);
  near(player.pose.root.distanceTo(stance.root), 0);
  player.advance(0.2); const before = player.pose;
  player.changeIntent(); near(player.pose.root.distanceTo(before.root), 0);
  assert.equal(player.accept(segment, request.revision), false);
  player.advance(10); const held = player.pose; player.advance(10);
  near(player.pose.root.distanceTo(held.root), 0); assert.equal(player.waiting, true);
  const next = player.request(); assert.equal(next.context.length, 4);
  assert.equal(player.accept(segment, next.revision), true);
  near(player.pose.root.distanceTo(held.root), 0);
});

test('bundled native SOMA GLB has the expected joints and finite, normalized skin weights', () => {
  const glb = readFileSync(new URL('../public/assets/soma.glb', import.meta.url));
  assert.equal(glb.readUInt32LE(0), 0x46546c67); assert.equal(glb.readUInt32LE(8), glb.length);
  const jsonLength = glb.readUInt32LE(12), document = JSON.parse(glb.subarray(20, 20 + jsonLength).toString());
  const bin = glb.subarray(28 + jsonLength);
  assert.equal(document.skins[0].joints.length, 110);
  for (const name of JOINTS) assert.ok(document.nodes.some((n: {name: string}) => n.name === name), name);
  const primitive = document.meshes[0].primitives[0];
  const weightAccessor = document.accessors[primitive.attributes.WEIGHTS_0], view = document.bufferViews[weightAccessor.bufferView];
  assert.equal(weightAccessor.count, 18056);
  for (let i = 0; i < weightAccessor.count; i++) {
    let sum = 0;
    for (let j = 0; j < 4; j++) {const weight = bin.readFloatLE(view.byteOffset + (i * 4 + j) * 4); assert.ok(Number.isFinite(weight) && weight >= 0); sum += weight;}
    near(sum, 1);
  }
});
