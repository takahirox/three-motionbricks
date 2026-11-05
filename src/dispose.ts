import { Mesh, SkinnedMesh, Texture, type Object3D, type Material } from 'three';

export function disposeScene(scene: Object3D) {
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
