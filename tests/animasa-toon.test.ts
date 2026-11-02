import test from 'node:test';
import assert from 'node:assert/strict';
import { DataTexture, Mesh, MeshStandardMaterial, NearestFilter, NoColorSpace, SRGBColorSpace, Vector3 } from 'three';
import { createToonLighting, MMDToonPlugin } from 'mmd-gltf/packages/three-mmd-toon';
import { createToonMaterial } from 'mmd-gltf/packages/three-mmd-toon/shading';
import { AnimasaToonPlugin, animasaTextureView, createAnimasaToonMaterial, inspectToonMaterials } from '../src/animasa-toon';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';

test('Animasa compatibility is opt-in, retains source factors and isolates texture views', async () => {
  const source = new DataTexture(new Uint8Array([128, 64, 32, 255]), 1, 1);
  source.colorSpace = NoColorSpace;
  const base = animasaTextureView(source), toon = animasaTextureView(source, true);
  assert.notEqual(base.source, source.source);
  assert.equal(source.colorSpace, NoColorSpace);
  assert.equal(base.colorSpace, SRGBColorSpace);
  assert.equal(toon.colorSpace, SRGBColorSpace);
  assert.equal(toon.flipY, false);
  assert.equal(toon.minFilter, NearestFilter);
  assert.equal(toon.generateMipmaps, false);
  const m = {diffuseFactor:[0.3,0.4,0.5,1],ambientFactor:[0.2,0.3,0.4],specularFactor:[0.15,0.25,0.4],shininessFactor:15};
  const original = structuredClone(m), light = createToonLighting();
  assert.deepEqual(light.direction.value.toArray(), [0,0,1]);
  assert.deepEqual(light.rgb.value.toArray(), [1,1,1]);
  const normal = createToonMaterial(m, {}, {}, light);
  const adapted = createAnimasaToonMaterial(m, {}, {}, light);
  assert.deepEqual(m, original);
  assert.equal(normal.userData.mmdCompatibility, undefined);
  const clone = adapted.clone(); // GLTFLoader's final skin/material cloning.
  assert.equal(inspectToonMaterials(new Mesh(undefined, clone), true).materials, 1);
  assert.deepEqual(clone.userData.mmdSpecularFactor, m.specularFactor);
  assert.equal(clone.userData.mmdShininessFactor, m.shininessFactor);
  assert.throws(() => inspectToonMaterials(new Mesh(undefined, new MeshStandardMaterial()), true), /fallback/);
  assert.throws(() => inspectToonMaterials(new Mesh(undefined, normal), true), /not active/);
  assert.equal(inspectToonMaterials(new Mesh(undefined, normal), false).compatibility, 'default');
  assert.throws(() => createAnimasaToonMaterial({...m,sharedToonIndex:0}, {}, {}, light), /pinned embedded/);
  const json = {materials:[{extensions:{MMD_materials_toon:m}},{}]};
  const associations = new Map();
  const parser = {json, associations} as any;
  const plugin = new AnimasaToonPlugin(parser, light);
  assert.ok(plugin instanceof MMDToonPlugin);
  plugin.beforeRoot();
  assert.equal(plugin.loadMaterial(1), null);
  const loaded = await plugin.loadMaterial(0);
  assert.deepEqual(associations.get(loaded), {materials:0});
  assert.equal(loaded?.userData.mmdCompatibility, 'animasa-three-mmd-loader');
  await plugin.dispose();
  source.dispose(); base.dispose(); toon.dispose(); normal.dispose(); adapted.dispose(); clone.dispose(); loaded?.dispose();
});

test('exact embedded Animasa ramps: vertical rows correspond to the reference +90 degree rotation', async () => {
  const bytes = await readFile('public/assets/animasa/model.glb');
  const json = JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString());
  const start = 28+bytes.readUInt32LE(12);
  const dots = [-1,-0.75,-0.5,0,0.25,0.5,0.75,1];
  const coordinates = [0,0.125,0.25,0.5,0.625,0.75,0.875,1];
  const expectedBottom: Record<string, number[]> = {'toon01.png':[205,205,205], 'toon02.png':[245,225,225], 'toon03.png':[154,154,154]};
  for (const image of json.images.filter((i:any) => i.name.startsWith('toon'))) {
    const view = json.bufferViews[image.bufferView];
    const {data,info} = await sharp(bytes.subarray(start+view.byteOffset,start+view.byteOffset+view.byteLength)).raw().toBuffer({resolveWithObject:true});
    assert.equal(info.width, 32); assert.equal(info.height, 32);
    const rotated = await sharp(data,{raw:info}).rotate(90).raw().toBuffer();
    for (let i=0;i<dots.length;i++) {
      const c = Math.min(1, Math.max(0,dots[i]*0.5+0.5));
      assert.equal(c, coordinates[i]);
      const x = Math.min(31,Math.floor(c*32));
      // +90° rotation maps original row 31-x to rotated column x.
      const row = 31-x;
      const sample = [...data.subarray((row*32+16)*4,(row*32+16)*4+3)];
      assert.deepEqual(sample,[...rotated.subarray(x*4,x*4+3)]);
      if (i===0) assert.deepEqual(sample,expectedBottom[image.name]);
      if (i===dots.length-1) assert.deepEqual(sample,[255,255,255]);
    }
  }
  assert.ok(new Vector3(0,0,1).equals(createToonLighting().direction.value));
});
