// Development-only comparison harness. Excluded from the production entry and
// asset allowlist. The driver verifies the reference revision and PMD SHA-256.
import { Color, DataTexture, DirectionalLight, FloatType, LinearSRGBColorSpace, LoadingManager, Mesh,
  NoBlending, OrthographicCamera, PerspectiveCamera, PlaneGeometry, Scene, SRGBColorSpace, Vector3 } from 'three';
import { RenderTarget, WebGPURenderer } from 'three/webgpu';
import { vec3 } from 'three/tsl';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Parser } from 'mmd-parser';
import { MMDToonPlugin, createToonLighting, encodedTextureView } from 'mmd-gltf/packages/three-mmd-toon';
import { createToonMaterial } from 'mmd-gltf/packages/three-mmd-toon/shading';
import { AnimasaToonPlugin, animasaTextureView, createAnimasaToonMaterial, inspectToonMaterials } from '../src/animasa-toon';
import type { ToonPayload } from 'mmd-gltf/packages/three-mmd-toon';

const check = (condition: unknown, message: string) => {if (!condition) throw new Error(message);};
const decode = (v: number) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
const encode = (v: number) => v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
const near = (actual: ArrayLike<number>, expected: number[], label: string, tolerance = 0.003) => {
  expected.forEach((v,i) => check(Math.abs(actual[i]-v) < tolerance, `${label}: ${Array.from(actual)} expected ${expected}`));
};
const backend = new URL(location.href).searchParams.get('backend') ?? 'webgpu';
const renderer = new WebGPURenderer({antialias:false, forceWebGL:backend === 'webgl', preserveDrawingBuffer:true});
await renderer.init(); renderer.setSize(640,720); document.body.append(renderer.domElement);
check(backend === 'webgpu' ? 'isWebGPUBackend' in renderer.backend : 'isWebGLBackend' in renderer.backend,
  `Requested ${backend} backend is unavailable`);
const api: Record<string, any> = {};
Object.assign(window, {shadingValidation: api});
const lighting = createToonLighting();

function solid(rgba: number[]) {
  const t = new DataTexture(new Uint8Array(rgba),1,1); t.colorSpace = SRGBColorSpace; t.needsUpdate = true; return t;
}
async function probes() {
  const target = new RenderTarget(1,1,{type:FloatType}); target.texture.colorSpace = LinearSRGBColorSpace;
  const scene = new Scene(), camera = new OrthographicCamera(-1,1,1,-1,0.1,10); camera.position.z = 2;
  const plane = new Mesh(new PlaneGeometry(2,2)); scene.add(plane);
  const pixel = async () => {
    renderer.setRenderTarget(target); renderer.render(scene,camera);
    return Array.from(await renderer.readRenderTargetPixelsAsync(target,0,0,1,1));
  };
  let count = 0;
  // Distinct asymmetric rows expose an inverted ramp and wrong coordinate scale.
  const rows = [[31,63,95,255],[63,95,127,255],[127,159,191,255],[223,239,255,255]];
  const rampSource = new DataTexture(new Uint8Array(rows.flat()),1,4);
  const ramp = animasaTextureView(rampSource,true);
  for (const dot of [-1,-0.75,-0.5,-0.25,0,0.25,0.5,0.75,1]) {
    const m = createAnimasaToonMaterial({diffuseFactor:[1,1,1,1],toonTexture:{index:0}}, {}, {toon:ramp}, lighting,
      {normal:vec3(Math.sqrt(1-dot*dot),0,dot),light:vec3(0,0,1),view:vec3(0,0,1)});
    plane.material = m;
    const row = 3-Math.min(3,Math.floor((dot+1)*2));
    near(await pixel(), [...rows[row].slice(0,3).map(x=>decode(x/255)),1], `ramp dot ${dot}`);
    m.dispose(); count++;
  }
  // Linear contribution tests: independent scalar equation, colored light and
  // samples, zero/positive powers, degenerate half-vector, HDR, and sample alpha.
  const source = {diffuseFactor:[0.55,0.4,0.25,0.8],ambientFactor:[0.3,0.2,0.1],specularFactor:[0.4,0.25,0.15],shininessFactor:8};
  const baseRGBA = [192,128,64,128], toonRGBA = [220,180,140,255];
  const base = solid(baseRGBA), toon = solid(toonRGBA);
  const lightColor = new Vector3(0.8,0.6,0.4), coloredLight = createToonLighting(new Vector3(0,0,1),lightColor);
  for (const ambient of [false,true]) for (const specular of [false,true]) for (const power of [0,8]) for (const dot of [-1,0,0.5,1]) {
    const payload: ToonPayload = {...source, ambientFactor:ambient?source.ambientFactor:[0,0,0],
      specularFactor:specular?source.specularFactor:[0,0,0],shininessFactor:power,baseTexture:{index:0},toonTexture:{index:1}};
    const m = createAnimasaToonMaterial(payload,{alphaMode:'BLEND'},{base,toon},coloredLight,
      {normal:vec3(Math.sqrt(1-dot*dot),0,dot),light:vec3(0,0,1),view:vec3(0,0,1)});
    m.blending = NoBlending; plane.material = m;
    const expected = source.diffuseFactor.slice(0,3).map((d,i) =>
      (decode(d)*lightColor.getComponent(i)+(ambient?0.5*decode(source.ambientFactor[i]):0))*decode(baseRGBA[i]/255)*decode(toonRGBA[i]/255)
      +(specular?decode(source.specularFactor[i])*lightColor.getComponent(i)*(power===0?1:Math.max(0,dot)**power):0));
    near(await pixel(),[...expected,0.8*128/255],`contribution ${ambient}/${specular}/${power}/${dot}`);
    m.dispose(); count++;
  }
  // Guard the unmodified extension contract used by Uka and other consumers:
  // encoded-component composition, ambient coefficient 1, final decode only.
  const encodedBase=encodedTextureView(base),encodedToon=encodedTextureView(toon);
  const defaultMaterial=createToonMaterial({...source,baseTexture:{index:0},toonTexture:{index:1}}, {}, {base:encodedBase,toon:encodedToon}, coloredLight,
    {normal:vec3(0,0,1),light:vec3(0,0,1),view:vec3(0,0,1)});
  plane.material=defaultMaterial;
  near(await pixel(),[...source.diffuseFactor.slice(0,3).map((d,i)=>decode(Math.min(1,
    Math.min(1,d*lightColor.getComponent(i)+source.ambientFactor[i])*baseRGBA[i]/255*toonRGBA[i]/255
      +source.specularFactor[i]*lightColor.getComponent(i)))),1],'unchanged default extension');
  defaultMaterial.dispose();encodedBase.dispose();encodedToon.dispose();count++;
  const hdr = createAnimasaToonMaterial({diffuseFactor:[1,1,1,1],ambientFactor:[1,1,1],specularFactor:[1,1,1],shininessFactor:1}, {}, {}, lighting,
    {normal:vec3(0,0,1),light:vec3(0,0,1),view:vec3(0,0,1)});
  plane.material = hdr; near(await pixel(),[2.5,2.5,2.5,1],'unclipped linear HDR'); count++;
  // Opposing L/V with authored positive power produces no specular, while the
  // explicitly defined zero-power case remains constant, as in the reference.
  for (const power of [0,5]) {
    const m = createAnimasaToonMaterial({diffuseFactor:[0,0,0,1],specularFactor:[0.4,0.4,0.4],shininessFactor:power}, {}, {}, lighting,
      {normal:vec3(0,0,1),light:vec3(0,0,1),view:vec3(0,0,-1)});
    plane.material=m; near(await pixel(),[...Array(3).fill(power===0?decode(0.4):0),1],`degenerate half vector ${power}`);m.dispose();count++;
  }
  const output = createAnimasaToonMaterial({diffuseFactor:[0.5,0.25,0.1,1],ambientFactor:[0.4,0.2,0.1]}, {}, {}, lighting,
    {normal:vec3(0,0,1),light:vec3(0,0,1),view:vec3(0,0,1)});
  plane.material=output;
  const canvasTarget = new RenderTarget(1,1); canvasTarget.texture.colorSpace=LinearSRGBColorSpace;
  renderer.setRenderTarget(null);renderer.setOutputRenderTarget(canvasTarget);renderer.outputColorSpace=SRGBColorSpace;
  renderer.render(scene,camera);
  const encoded = await renderer.readRenderTargetPixelsAsync(canvasTarget,0,0,1,1);
  near(Array.from(encoded).map(x=>x/255),[...Array(3).fill(0).map((_,i)=>encode(decode([0.5,0.25,0.1][i])+0.5*decode([0.4,0.2,0.1][i]))),1],'single display encoding',0.007);
  renderer.setOutputRenderTarget(null);renderer.setRenderTarget(null);
  target.dispose();canvasTarget.dispose();base.dispose();toon.dispose();rampSource.dispose();ramp.dispose();hdr.dispose();output.dispose();plane.geometry.dispose();
  return {linearSamples:count,outputSamples:1,backend};
}

api.probes = probes;
api.ready = true;
api.prepare = async () => {
  // Vite resolves the reference's relative .js imports to its checked-out TS.
  const { MMDLoader } = await import(/* @vite-ignore */ '/.cache/three-mmd-loader/src/loaders/MMDLoader.ts');
  const manager = new LoadingManager();
  const ready = new Promise<void>((resolve,reject) => {manager.onLoad=resolve;manager.onError=url=>reject(new Error(url));});
  const reference = await new MMDLoader(manager).loadAsync('/.cache/animasa-source/miku/miku_v2.pmd');
  await ready; reference.scale.setScalar(0.08);
  const load = async (adapted: boolean) => {
    const loader = new GLTFLoader().register(p=> adapted ? new AnimasaToonPlugin(p,lighting) : new MMDToonPlugin(p,{lighting}));
    return (await loader.loadAsync('/assets/animasa/model.glb')).scene;
  };
  const before=await load(false), after=await load(true);
  for (const object of [reference,before,after]) object.traverse((o:any)=>{
    if (!o.isMesh) return;
    o.frustumCulled=false;o.geometry.morphAttributes={};o.morphTargetInfluences=[];o.morphTargetDictionary={};
    const materials=Array.isArray(o.material)?o.material:[o.material];
    materials.forEach((m:any)=>{m.fog=false;m.toneMapped=false;});
  });
  const camera = new PerspectiveCamera(40,640/720,0.1,100);camera.position.set(0,0.96,2.8);camera.lookAt(0,0.8,0);
  const scene = new Scene();scene.background=new Color('#202830');
  const light=new DirectionalLight(0xffffff,1);light.position.set(0,0,1);scene.add(light);
  const objects: Record<string, any>={before,after,reference};
  const inspect = inspectToonMaterials(after,true);
  const sourceMaterials = new Parser().parsePmd(await (await fetch('/.cache/animasa-source/miku/miku_v2.pmd')).arrayBuffer(),true).materials;
  const actual = inspect.sourceSpecular!;
  actual.forEach((m,i)=>{near(m.specular,sourceMaterials[i].specular,`source specular ${i}`,1e-7);check(m.shininess===sourceMaterials[i].shininess,`source power ${i}`);});
  api.render = async (mode: string, oblique=false, linear=false) => {
    Object.values(objects).forEach(o=>o.removeFromParent());scene.add(objects[mode]);
    camera.position.set(...(oblique?[1.5,0.96,2.6]:[0,0.96,2.8]) as [number,number,number]);camera.lookAt(0,0.8,0);
    if (linear) {
      const target=new RenderTarget(640,720,{type:FloatType});target.texture.colorSpace=LinearSRGBColorSpace;
      renderer.setRenderTarget(target);renderer.render(scene,camera);
      const pixels=await renderer.readRenderTargetPixelsAsync(target,0,0,640,720);
      renderer.setRenderTarget(null);target.dispose();
      // Exclude background; compare the same geometry, including antialias-free edges.
      return Array.from(pixels);
    }
    renderer.setRenderTarget(null);renderer.render(scene,camera);
    await new Promise(requestAnimationFrame);
    return renderer.domElement.toDataURL('image/png');
  };
  return {inspect,referenceMaterials:sourceMaterials.length,sourceSpecularPreserved:true,lightDirection:lighting.direction.value.toArray(),
    camera:camera.position.toArray(),scale:0.08,backend};
};
