// Offline acquisition/conversion only. No PMX parser is imported by the app.
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import sharp from 'sharp';
import { convertModel, parsePMX } from 'mmd-gltf/tools/pmx-to-gltf';
import manifest from 'mmd-gltf/tools/uka-manifest.json';
import { BACKEND_SHA256 } from 'mmd-gltf/packages/three-mmd-physics/ammo';

const cache = resolve('.cache/uka'), textures = resolve('.cache/uka-preview');
const output = resolve('public/assets/uka');
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const files = manifest.files.filter(f => !f.path.endsWith('.vmd'));
for (const file of files) {
  const path = resolve(cache, file.path);
  let bytes: Buffer;
  try { bytes = await readFile(path); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    const response = await fetch(`https://raw.githubusercontent.com/${manifest.repository}/${manifest.commit}/${file.path}`);
    if (!response.ok) throw new Error(`${file.path}: HTTP ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
  }
  if (bytes.length !== file.size || sha(bytes) !== file.sha256) throw new Error(`${file.path}: source hash/size mismatch`);
  await mkdir(dirname(path), {recursive: true}); await writeFile(path, bytes);
  if (file.path.endsWith('.png')) {
    const target = resolve(textures, file.path); await mkdir(dirname(target), {recursive: true});
    await sharp(bytes).resize({width:1024, height:1024, fit:'inside', withoutEnlargement:true}).png().toFile(target);
  }
}
const model = parsePMX(await readFile(resolve(cache, 'MS_Uka.pmx')));
const {document, io, warnings, diagnostics} = await convertModel(model, textures, {
  mode:'bdef', scale:0.08, physics:'rigid-body-v1',
});
const attribution = 'CG-CA Uka (c) 2023-2024 by Nagoya Institute of Technology, Moonshot R&D Goal 1 Avatar Symbiotic Society';
const changes = 'PMX to skinned glTF; BDEF, retained morphs, toon, outline, solver and rigid-body/joint metadata. Textures resized to at most 1024 pixels. MotionBricks FK retargeting and bounded secondary physics in the app; unsupported source features documented in docs/mmd.md.';
const {mmdSource: _rawPMX, ...extras} = document.getRoot().getExtras();
document.getRoot().setExtras({...extras, attribution, license:'CC BY 4.0',
  source:`https://github.com/${manifest.repository}/tree/${manifest.commit}`, changes});
for (const mesh of document.getRoot().listMeshes()) for (const primitive of mesh.listPrimitives())
  for (const target of primitive.listTargets()) target.getAttribute('POSITION')?.setSparse(true);
await mkdir(output, {recursive:true});
await mkdir('public/runtime', {recursive:true});
const ammo = await readFile('node_modules/ammojs-typed/ammo/ammo.js');
if (sha(ammo) !== BACKEND_SHA256) throw new Error('Pinned Ammo artifact hash mismatch');
await writeFile('public/runtime/ammo.js', ammo);
await copyFile('node_modules/mmd-gltf/extensions/MMD_physics/BACKEND-LICENSE.txt','public/runtime/ammo-LICENSE');
await io.write(resolve(output,'model.glb'), document);
for (const name of ['README.md','README.ja.md']) await copyFile(resolve(cache,name),resolve(output,name));
const artifact = await readFile(resolve(output,'model.glb'));
await writeFile(resolve(output,'conversion.json'), JSON.stringify({
  repository:manifest.repository, commit:manifest.commit, files, attribution, changes,
  converter:'takahirox/mmd-gltf@3dfa726aa38992a1f7d5ea17b377c685e839e8b8',
  sha256:sha(artifact), bytes:artifact.length,
  bones:model.bones.length, bodies:model.rigidBodies.length, joints:model.constraints.length,
  vertices:model.vertices.length, morphs:model.morphs.length, warnings, diagnostics,
}, null, 2)+'\n');
console.log(`Converted Uka: ${artifact.length} bytes; ${model.bones.length} bones, ${model.rigidBodies.length} rigid bodies, ${model.constraints.length} joints.`);
