import { AmbientLight, Color, DirectionalLight, Fog, GridHelper, Mesh, MeshStandardMaterial,
  PerspectiveCamera, PlaneGeometry, Scene, WebGPURenderer } from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/** Shared camera, lighting and rendering setup for both demo entry points. */
export async function createStage(container: HTMLElement) {
  const scene = new Scene(); scene.background = new Color('#101c25'); scene.fog = new Fog('#101c25',18,70);
  const camera = new PerspectiveCamera(40,container.clientWidth / container.clientHeight,0.1,150); camera.position.set(4,2.5,5);
  const renderer = new WebGPURenderer({antialias:true});
  renderer.setPixelRatio(Math.min(devicePixelRatio,2)); renderer.setSize(container.clientWidth,container.clientHeight);
  try {await renderer.init();} catch (error) {renderer.dispose(); throw error;}
  container.append(renderer.domElement);
  const controls = new OrbitControls(camera,renderer.domElement);
  controls.target.set(0,0.9,0); controls.enableDamping = true; controls.enablePan = false;
  controls.minDistance = 2; controls.maxDistance = 12; controls.maxPolarAngle = Math.PI / 2 - 0.03;
  scene.add(new AmbientLight(0xffffff,2));
  const sun = new DirectionalLight(0xfff0db,3); sun.position.set(4,7,3); scene.add(sun);
  const ground = new Mesh(new PlaneGeometry(200,200),new MeshStandardMaterial({color:'#172c36',roughness:1}));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.015; scene.add(ground);
  const grid = new GridHelper(200,200,'#36535c','#253e49'); grid.position.y = -0.01; scene.add(grid);
  const resize = () => {camera.aspect = container.clientWidth / container.clientHeight; camera.updateProjectionMatrix(); renderer.setSize(container.clientWidth,container.clientHeight);};
  addEventListener('resize',resize);
  return {scene,camera,renderer,controls,ground,grid,dispose() {
    removeEventListener('resize',resize); renderer.setAnimationLoop(null); controls.dispose();
    ground.geometry.dispose(); ground.material.dispose(); grid.geometry.dispose();
    for (const material of Array.isArray(grid.material) ? grid.material : [grid.material]) material.dispose();
    renderer.dispose(); renderer.domElement.remove();
  }};
}
