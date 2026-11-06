// Canonical snapshots from saved real trial output; no new inference.
import {readFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {chromium} from 'playwright';
const experiment=JSON.parse(gunzipSync(await readFile(new URL('../.artifacts/interaction-response-quality/traces.json.gz',import.meta.url))).toString());
const browser=await chromium.launch({executablePath:process.env.CHROME_BIN || undefined,headless:true});
try {
  const page=await browser.newPage({viewport:{width:1250,height:1000}});
  await page.goto(new URL('pose.html',process.env.DEMO_URL || 'http://127.0.0.1:5173/').href);
  await page.evaluate(async rollouts=> {
    const THREE=await import('/node_modules/three/build/three.module.js');
    const {SomaAvatar}=await import('/src/avatar.ts');
    const {Vector3,Quaternion}=THREE;
    document.body.innerHTML='';document.body.style.cssText='margin:0;background:#18202b;color:white;font:14px sans-serif;display:grid;grid-template-columns:repeat(5,250px)';
    const single=rollouts.find(r=>r.joint==='LeftHand' && r.strategy==='single' && r.trajectory==='up');
    const selection=rollouts.find(r=>r.joint==='LeftHand' && r.strategy==='selection' && r.trajectory==='up');
    for(const row of ['single displayed','selection raw','selection displayed']) for(const frame of [15,40,65,89,130]) {
      const cell=document.createElement('div');document.body.append(cell);
      const label=document.createElement('div');label.style.cssText='height:28px;text-align:center';label.textContent=`${row} · ${(frame/30).toFixed(2)} s`;cell.append(label);
      const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setSize(250,290);cell.append(renderer.domElement);
      const scene=new THREE.Scene();scene.background=new THREE.Color('#222c39');
      scene.add(new THREE.HemisphereLight(0xffffff,0x556677,3));
      const light=new THREE.DirectionalLight(0xffffff,3);light.position.set(-2,4,3);scene.add(light);
      scene.add(new THREE.GridHelper(3,15,0x657689,0x344354));
      const avatar=await SomaAvatar.load('/assets/soma.glb');scene.add(avatar.object);
      let p;
      if(row==='single displayed') p=single.displayed[frame].pose;
      else if(row==='selection displayed') p=selection.displayed[frame].pose;
      else {
        const sequence=selection.sequences.filter(s=>s.requestedAt<=frame*1000/30+.001).at(-1);
        const candidate=sequence.candidates.find(c=>c.index===sequence.selected);
        p=candidate.rawMotion[Math.min(17,frame-Math.round(sequence.requestedAt*30/1000)+1)];
      }
      avatar.apply({root:new Vector3().fromArray(p.root),rotations:p.rotations.map(q=>new Quaternion().fromArray(q))});
      const camera=new THREE.PerspectiveCamera(36,250/290,.01,50);camera.position.set(2.7,1.9,3.8);camera.lookAt(0,.95,0);
      renderer.render(scene,camera);
    }
  },experiment.rollouts);
  await page.screenshot({path:new URL('../docs/images/interaction-response-quality-hand.png',import.meta.url).pathname});
} finally {await browser.close();}
