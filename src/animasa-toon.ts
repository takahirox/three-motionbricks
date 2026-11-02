import { ClampToEdgeWrapping, Mesh, NearestFilter, SRGBColorSpace, type Object3D, type Texture } from 'three';
import type { GLTFParser } from 'three/addons/loaders/GLTFLoader.js';
import { MMDToonPlugin, encodedTextureView } from 'mmd-gltf/packages/three-mmd-toon';
import { createToonMaterial, type MaterialState, type ShadingInputs, type ToonLighting, type ToonTextures } from 'mmd-gltf/packages/three-mmd-toon/shading';
import { validatePayload, type ToonPayload } from 'mmd-gltf/packages/three-mmd-toon/payload';
import { Fn, If, Discard, float, vec2, vec3, vec4, texture, uv, normalView, cameraViewMatrix, positionViewDirection, sRGBTransferEOTF } from 'three/tsl';
import type { Node } from 'three/webgpu';

/** Opt-in renderer adapter for the verified Animasa PMD conversion only.
 * The extension's default encoded-component contract is deliberately untouched.
 * See docs/animasa-shading.md for the reference equation and sampling boundary.
 */
export function createAnimasaToonMaterial(m: ToonPayload, state: MaterialState, maps: ToonTextures,
  lighting: ToonLighting, inputs: ShadingInputs = {}) {
  if (m.sphereTexture || m.sharedToonIndex !== undefined || m.baseTexture?.extensions || m.baseTexture?.texCoord)
    throw new Error('Animasa compatibility supports only the pinned embedded PMD textures');
  const material = createToonMaterial(m, state, maps, lighting);
  material.userData.mmdCompatibility = 'animasa-three-mmd-loader';
  material.userData.mmdSpecularFactor = [...(m.specularFactor ?? [0, 0, 0])];
  material.userData.mmdShininessFactor = m.shininessFactor ?? 0;
  material.fragmentNode = Fn(() => {
    const decode = (rgb: number[]) => sRGBTransferEOTF(vec3(...rgb as [number, number, number])) as Node<'vec3'>;
    const d = m.diffuseFactor ?? [1, 1, 1, 1];
    const n = inputs.normal ?? normalView;
    const l = inputs.light ?? cameraViewMatrix.mul(vec4(lighting.direction, 0)).xyz.normalize();
    const v = inputs.view ?? positionViewDirection;
    const t = maps.base ? texture(maps.base, inputs.baseUV ?? uv(0)) : vec4(1);
    const coord = n.dot(l).mul(0.5).add(0.5).clamp(0, 1);
    // Reference rotates the vertical image +90° and samples (coord,0).
    // Keep embedded pixels intact: the equivalent unrotated row is 1-coord.
    // Resolve nearest texel in the rotated axis first, including exact bin
    // boundaries, then address the center of the corresponding original row.
    const height = (maps.toon?.image as {height: number} | undefined)?.height ?? 1;
    const row = float(height - 1).sub(coord.mul(height).floor().min(height - 1));
    const ramp = maps.toon ? texture(maps.toon, vec2(0.5, row.add(0.5).div(height))).rgb : vec3(1);
    const surface = decode(d.slice(0, 3)).mul(lighting.rgb)
      .add(decode(m.ambientFactor ?? [0, 0, 0]).mul(0.5)).mul(t.rgb).mul(ramp);
    const p = decode(m.specularFactor ?? [0, 0, 0]);
    const specular = p.mul(lighting.rgb).toVar();
    if ((m.shininessFactor ?? 0) > 0) {
      const sum = l.add(v).toVar();
      specular.assign(vec3(0));
      If(sum.dot(sum).greaterThan(0), () => {
        specular.assign(p.mul(lighting.rgb).mul(n.dot(sum.normalize()).clamp(0, 1).pow(m.shininessFactor!)));
      });
    }
    const alpha = float(d[3]).mul(t.a).clamp(0, 1);
    if (state.alphaMode === 'MASK') If(alpha.lessThan(state.alphaCutoff ?? 0.5), () => { Discard(); });
    // Factors decode once above, sRGB texture views decode at sampling. Return
    // linear HDR; Three performs the single final display conversion.
    return vec4(surface.add(specular), state.alphaMode === 'BLEND' ? alpha : float(1));
  })();
  return material;
}

/** Independent GPU source/view: never mutate PBR or default-plugin textures. */
export function animasaTextureView(original: Texture, toon = false) {
  const view = encodedTextureView(original);
  view.colorSpace = SRGBColorSpace;
  if (toon) {
    view.wrapS = view.wrapT = ClampToEdgeWrapping;
    view.magFilter = view.minFilter = NearestFilter;
    view.generateMipmaps = false;
  }
  view.needsUpdate = true;
  return view;
}

export class AnimasaToonPlugin extends MMDToonPlugin {
  private readonly compatibilityViews = new Map<string, Promise<Texture>>();
  constructor(private readonly gltf: GLTFParser, private readonly light: ToonLighting) {
    super(gltf, {lighting: light});
  }
  override loadMaterial(index: number) {
    const def = this.gltf.json.materials[index];
    const m = def.extensions?.MMD_materials_toon;
    if (m === undefined) return null;
    validatePayload(m);
    const view = (index: number, toon = false) => {
      const key = `${index}:${toon}`;
      if (!this.compatibilityViews.has(key)) this.compatibilityViews.set(key,
        this.gltf.getDependency('texture', index).then((t: Texture) => animasaTextureView(t, toon)));
      return this.compatibilityViews.get(key)!;
    };
    return (async () => {
      const [base, toon] = await Promise.all([m.baseTexture ? view(m.baseTexture.index) : undefined,
        m.toonTexture ? view(m.toonTexture.index, true) : undefined]);
      const material = createAnimasaToonMaterial(m, def, {base, toon}, this.light);
      this.gltf.associations.set(material, {materials: index});
      return material;
    })();
  }
  override async dispose() {
    const results = await Promise.allSettled(this.compatibilityViews.values());
    for (const result of results) if (result.status === 'fulfilled') result.value.dispose();
    this.compatibilityViews.clear();
    await super.dispose();
  }
}

/** Inspect final GLTFLoader clones, so a PBR fallback cannot pass unnoticed. */
export function inspectToonMaterials(root: Object3D, animasa: boolean) {
  // Keep material identities (several primitives can share one material).
  const records = new Map<string, {specular: number[]; shininess: number}>();
  let meshes = 0;
  root.traverse(object => {
    if (!(object instanceof Mesh)) return;
    meshes++;
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (material.userData.mmdMaterialModel !== 'MMD_materials_toon' || !('fragmentNode' in material) || !material.fragmentNode)
        throw new Error('Expected an active MMD Toon material; core glTF fallback is not supported');
      if (animasa && material.userData.mmdCompatibility !== 'animasa-three-mmd-loader')
        throw new Error('Animasa Toon compatibility is not active');
      records.set(material.uuid, {specular: material.userData.mmdSpecularFactor, shininess: material.userData.mmdShininessFactor});
    }
  });
  if (!meshes) throw new Error('MMD model has no meshes');
  return {model: 'MMD_materials_toon', compatibility: animasa ? 'animasa-three-mmd-loader' : 'default',
    meshes, materials: records.size, ...(animasa ? {sourceSpecular: [...records.values()]} : {})};
}
