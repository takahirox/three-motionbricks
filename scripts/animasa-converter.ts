// Offline, exact-source PMD adapter. This module is never imported by the app.
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Parser } from 'mmd-parser';
import sharp from 'sharp';
import { convertModel, type PMXModel, type PMXBone } from 'mmd-gltf/tools/pmx-to-gltf';
import manifest from './animasa-manifest.json';

export const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
export function verifySource(path: string, bytes: Uint8Array) {
  const record = manifest.files.find(f => f.path === path);
  if (!record || bytes.length !== record.bytes || sha256(bytes) !== record.sha256)
    throw new Error(`${path}: not the pinned historical Animasa source (size/SHA-256 mismatch)`);
}

export function parseAnimasa(bytes: Buffer): PMXModel {
  // Bound and identify the input before invoking the legacy parser.
  verifySource('miku/miku_v2.pmd', bytes);
  const pmd = new Parser().parsePmd(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), true);
  const bones: PMXBone[] = pmd.bones.map((b, index) => {
    const result: PMXBone = {name:b.name, englishName:pmd.englishBoneNames[index]?.name ?? '',
      position:b.position, parentIndex:b.parentIndex, transformationClass:0, flag:0};
    // PMD rotation grants: type 5 uses ikIndex; type 9 uses tailIndex and a percentage.
    if (b.type === 5 || b.type === 9) {
      result.flag! |= 0x100;
      result.grant = {isLocal:false, affectRotation:true, affectPosition:false,
        parentIndex:b.type === 5 ? b.ikIndex : b.tailIndex, ratio:b.type === 5 ? 1 : b.ikIndex / 100};
    }
    if (b.type === 8) {
      const axis = pmd.bones[b.tailIndex].position.map((v, k) => v - b.position[k]);
      const length = Math.hypot(...axis);
      result.flag! |= 0x400;
      // createSolver expects fixed axes in the original left-handed coordinates.
      result.fixAxis = axis.map((v,k) => (k === 2 ? -v : v) / length);
    }
    return result;
  });
  pmd.iks.forEach(ik => {
    const bone = bones[ik.target]; bone.flag! |= 0x20;
    bone.ik = {effector:ik.effector, iteration:ik.iteration,
      // Historical Three.js PMD behavior (PMX angles have no factor of four).
      maxAngle:Math.min(Math.PI, ik.maxAngle * 4), links:ik.links.map(l => {
        const knee = bones[l.index].name.includes('ひざ');
        return {index:l.index, angleLimitation:knee ? 1 : 0,
          ...(knee ? {lowerLimitationAngle:[-Math.PI,0,0], upperLimitationAngle:[0,0,0]} : {})};
      })};
  });
  const base = pmd.morphs[0];
  if (base.type !== 0) throw new Error('PMD base morph is missing');
  return {
    metadata:{modelName:pmd.metadata.modelName, comment:pmd.metadata.comment,
      englishComment:pmd.metadata.englishComment ?? '', coordinateSystem:'right',
      boneCount:bones.length, morphCount:pmd.morphs.length - 1,
      rigidBodyCount:pmd.rigidBodies.length, constraintCount:pmd.constraints.length},
    vertices:pmd.vertices.map(v => ({...v, type:1, auvs:[], edgeRatio:v.edgeFlag === 0 ? 1 : 0})),
    faces:pmd.faces, bones, textures:['eyeM2.png','toon01.png','toon02.png','toon03.png'],
    materials:pmd.materials.map((m,index) => {
      if (m.fileName && m.fileName !== 'eyeM2.bmp') throw new Error(`Unexpected PMD texture ${m.fileName}`);
      if (pmd.toonTextures[m.toonIndex]?.fileName !== `toon${String(m.toonIndex+1).padStart(2,'0')}.bmp`)
        throw new Error('Unexpected custom toon texture');
      return {...m, name:`PMD material ${index}`, flag:m.edgeFlag ? 0x10 : 0,
        textureIndex:m.fileName ? 0 : -1, envTextureIndex:-1, envFlag:0,
        toonFlag:0, toonIndex:m.toonIndex+1, edgeColor:[0,0,0,1], edgeSize:1};
    }),
    // PMD expression indices address the base morph table, not the vertex array.
    morphs:pmd.morphs.slice(1).map((m,index) => ({name:m.name,
      englishName:pmd.englishMorphNames[index]?.name ?? '', type:1, elementCount:m.elements.length,
      elements:m.elements.map(e => ({index:base.elements[e.index].index, position:e.position}))})),
    // PMD body positions are bone-relative; the PMX-aware writer needs absolute positions.
    rigidBodies:pmd.rigidBodies.map(b => ({...b,
      // Bullet's setDamping clamps to [0,1]. Six source angular values exceed 1.
      rotationDamping:Math.min(1,b.rotationDamping),
      position:b.position.map((v,k) => v + (b.boneIndex < 0 ? 0 : bones[b.boneIndex].position[k]))})),
    constraints:pmd.constraints.map(j => ({...j, type:0})),
  };
}

/** Lossless BGR→RGBA for this pinned uncompressed 24-bit BMP; no color key guess. */
export async function eyePNG(bytes: Buffer) {
  verifySource('miku/eyeM2.bmp',bytes);
  const offset = bytes.readUInt32LE(10), width = bytes.readInt32LE(18), height = bytes.readInt32LE(22);
  if (bytes.toString('ascii',0,2) !== 'BM' || bytes.readUInt16LE(28) !== 24 || bytes.readUInt32LE(30) !== 0 || width <= 0 || height <= 0)
    throw new Error('Unexpected BMP layout');
  const stride = Math.ceil(width * 3 / 4) * 4, rgba = Buffer.alloc(width * height * 4,255);
  for (let y=0;y<height;y++) for(let x=0;x<width;x++) {
    const from = offset + (height-1-y)*stride + x*3, to = (y*width+x)*4;
    rgba[to]=bytes[from+2]; rgba[to+1]=bytes[from+1]; rgba[to+2]=bytes[from];
  }
  return sharp(rgba,{raw:{width,height,channels:4}}).png().toBuffer();
}

export async function convertAnimasa(source: string, output: string) {
  // No network access, public/ writes or publication flag. Read every original notice too.
  for (const file of manifest.files) verifySource(file.path,await readFile(resolve(source,file.path)));
  const model = parseAnimasa(await readFile(resolve(source,'miku/miku_v2.pmd')));
  const textures = resolve(output,'textures'); await mkdir(textures,{recursive:true});
  await writeFile(resolve(textures,'eyeM2.png'),await eyePNG(await readFile(resolve(source,'miku/eyeM2.bmp'))));
  // The reference example resolves stock toons from PNGs embedded in its loader.
  // Embed the three used ramps in GLB so runtime needs no shared-toon resolver.
  const loaderSource = await readFile(resolve(source,'MMDLoader.js'),'utf8');
  const table = loaderSource.slice(loaderSource.indexOf('prototype.defaultToonTextures = ['));
  const ramps = [...table.slice(0,table.indexOf('];')).matchAll(/data:image\/png;base64,([A-Za-z0-9+/=]+)/g)];
  if (ramps.length !== 11) throw new Error('Unexpected reference toon table');
  for(let i=1;i<=3;i++) await writeFile(resolve(textures,`toon0${i}.png`),Buffer.from(ramps[i][1],'base64'));
  const {document,io,warnings,diagnostics} = await convertModel(model,textures,{mode:'bdef',scale:0.08,physics:'rigid-body-v1'});
  // Preserve the source constraints in the asset; runtime separately handles unsupported twists.
  const {mmdSource:_source, ...extras} = document.getRoot().getExtras();
  document.getRoot().setExtras({...extras, sourcePMDSha256:manifest.files.find(f=>f.path.endsWith('.pmd'))!.sha256,
    attribution:'Hatsune Miku — modeling and conversion: Animasa (あにまさ); character © Crypton Future Media, INC.',
    sourceFormat:'pmd', publication:'NOT CLEARED — user-supplied local preview only'});
  const sourceBytes = await readFile(resolve(source,'miku/miku_v2.pmd'));
  const original = new Parser().parsePmd(sourceBytes.buffer.slice(sourceBytes.byteOffset,sourceBytes.byteOffset+sourceBytes.byteLength),false);
  document.getRoot().setExtras({...document.getRoot().getExtras(),
    pmdPhysics:{coordinateSystem:'left',bodies:original.rigidBodies,joints:original.constraints},
    adjustments:['Six angular damping values clamped to 1, matching Bullet setDamping; originals in pmdPhysics.',
      'PMD body offsets made absolute for PMX-aware writer; embedded reference stock toon ramps; base-indexed morphs remapped.']});
  for (const node of document.getRoot().listNodes()) {
    const identity = node.getExtras().pmxBone as {index:number} | undefined;
    if (identity) node.setExtras({...node.getExtras(),pmdBone:{index:identity.index,...original.bones[identity.index]}});
  }
  for (const mesh of document.getRoot().listMeshes()) for (const p of mesh.listPrimitives())
    for (const target of p.listTargets()) target.getAttribute('POSITION')?.setSparse(true);
  await io.write(resolve(output,'model.glb'),document);
  for (const file of manifest.files.filter(f=>f.path.endsWith('.txt'))) {
    const target = resolve(output,'notices',file.path);
    await mkdir(resolve(target,'..'),{recursive:true});
    await writeFile(target,await readFile(resolve(source,file.path)));
  }
  const artifact = await readFile(resolve(output,'model.glb'));
  const record = {source:manifest, sha256:sha256(artifact), bytes:artifact.length,
    bones:model.bones.length, morphs:model.morphs.length, bodies:model.rigidBodies.length,joints:model.constraints.length,
    converter:'mmd-gltf@3dfa726aa38992a1f7d5ea17b377c685e839e8b8 + scripts/animasa-converter.ts',
    publication:'NOT CLEARED — keep out of Git and Pages', warnings,diagnostics};
  await writeFile(resolve(output,'conversion.json'),JSON.stringify(record,null,2)+'\n');
  return record;
}
