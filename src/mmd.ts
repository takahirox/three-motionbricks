import { Mesh, SkinnedMesh, Texture, type Group, type Material } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MMDToonPlugin, createToonLighting } from 'mmd-gltf/packages/three-mmd-toon';
import { MMDOutlinePlugin, MMDOutlineEffect } from 'mmd-gltf/packages/three-mmd-outline';
import type { WebGPURenderer } from 'three/webgpu';
import { MMDPhysicsPlugin, loadAmmoBrowser } from 'mmd-gltf/packages/three-mmd-physics';
import { SomaRetargeter, ANIMASA_MAPPING, UKA_MAPPING } from './retarget';
import { verifyAnimasaGLB, ANIMASA_GLB_BYTES } from './animasa';
import { LiveMMDPhysics } from './mmd-physics';
import type { SomaAvatar } from './avatar';
import type { Pose } from './motion';

let backend: ReturnType<typeof loadAmmoBrowser> | undefined;
function ammo(base: string) {
  return backend ??= loadAmmoBrowser(`${base}runtime/ammo.js`).catch(error => {backend = undefined; throw error;});
}

export class MMDCharacter {
  physicsEnabled = true;
  private constructor(readonly object: Group, private retarget: SomaRetargeter,
    readonly physics: LiveMMDPhysics, private toon: MMDToonPlugin, private outline: MMDOutlinePlugin,
    readonly effect: MMDOutlineEffect, readonly label: string) {}
  static async load(base: string, soma: SomaAvatar, renderer: WebGPURenderer, localAnimasa?: File) {
    let toon!: MMDToonPlugin, outline!: MMDOutlinePlugin;
    const loader = new GLTFLoader()
      .register(p => toon = new MMDToonPlugin(p, {lighting:createToonLighting()}))
      .register(p => outline = new MMDOutlinePlugin(p))
      .register(p => new MMDPhysicsPlugin(p));
    let scene: Group | undefined;
    try {
      if (localAnimasa) {
        if (localAnimasa.size !== ANIMASA_GLB_BYTES) throw new Error('Incorrect Animasa GLB size. Use the documented offline converter.');
        const bytes = await localAnimasa.arrayBuffer();
        await verifyAnimasaGLB(bytes);
        scene = (await loader.parseAsync(bytes,'')).scene;
      } else scene = (await loader.loadAsync(`${base}assets/uka/model.glb`)).scene;
      // All source morph targets stay in the downloadable GLB. Locomotion does
      // not use expressions; don't allocate 203 full-surface GPU morph layers.
      scene.traverse(o => {
        if (o instanceof SkinnedMesh) {
          o.frustumCulled = false;
          o.geometry.morphAttributes = {}; o.morphTargetInfluences = []; o.morphTargetDictionary = {};
        }
      });
      const retarget = new SomaRetargeter(scene, soma.bind, soma.bindPoints,localAnimasa ? ANIMASA_MAPPING : UKA_MAPPING);
      const physics = new LiveMMDPhysics(scene, (await ammo(base)).api,false,Boolean(localAnimasa));
      return new MMDCharacter(scene, retarget, physics, toon, outline, new MMDOutlineEffect(renderer),
        localAnimasa ? 'Animasa Miku' : 'CG-CA Uka');
    } catch (error) {
      if (scene) disposeScene(scene);
      outline?.dispose(); await toon?.dispose(); throw error;
    }
  }
  apply(pose: Pose, delta: number) {this.retarget.apply(pose); this.physics.update(delta, this.physicsEnabled); this.object.updateMatrixWorld(true);}
  setPhysics(enabled: boolean) {this.physicsEnabled = enabled; this.physics.reset();}
  reset() {this.physics.reset();}
  dispose() {
    this.physics.dispose(); this.effect.dispose(); this.object.removeFromParent(); disposeScene(this.object);
    this.outline.dispose(); void this.toon.dispose();
  }
}

function disposeScene(scene: Group) {
  const geometries = new Set<SkinnedMesh['geometry']>(), materials = new Set<Material>(), textures = new Set<Texture>();
  const skeletons = new Set<SkinnedMesh['skeleton']>();
  scene.traverse(o => {
    if (!(o instanceof Mesh)) return;
    geometries.add(o.geometry);
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      materials.add(m); for (const value of Object.values(m)) if (value instanceof Texture) textures.add(value);
    }
    if (o instanceof SkinnedMesh) skeletons.add(o.skeleton);
  });
  for (const g of geometries) g.dispose(); for (const m of materials) m.dispose();
  for (const t of textures) t.dispose(); for (const s of skeletons) s.dispose();
}
