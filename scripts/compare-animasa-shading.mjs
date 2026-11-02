// Start the development server first. See docs/animasa-shading.md for the two
// pinned read-only source checkouts required by this optional GPU comparison.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import manifest from './animasa-manifest.json' with {type:'json'};

const referenceRevision = '7b604fb1d76b26a2c46bced0cbeab2b8b5781c40';
assert.equal(execFileSync('git',['-C','.cache/three-mmd-loader','rev-parse','HEAD'],{encoding:'utf8'}).trim(),referenceRevision);
assert.equal(execFileSync('git',['-C','.cache/three-mmd-loader','status','--porcelain'],{encoding:'utf8'}).trim(),'');
for (const path of ['miku/miku_v2.pmd','miku/eyeM2.bmp']) {
  const bytes=await readFile(`.cache/animasa-source/${path}`),file=manifest.files.find(f=>f.path===path);
  assert.equal(bytes.length,file.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),file.sha256);
}
const browser=await chromium.launch({executablePath:process.env.CHROME_BIN||undefined,headless:true,args:['--enable-unsafe-webgpu']});
const destination='docs/animasa-shading';await mkdir(destination,{recursive:true});
const report={referenceRevision,sourceRevision:manifest.revision,sourceModelSHA256:manifest.files.find(f=>f.path.endsWith('.pmd')).sha256,backends:[]};
try {
  for (const backend of ['webgpu','webgl']) {
    const page=await browser.newPage({viewport:{width:640,height:720}}),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
    await page.goto(`${process.env.DEMO_URL||'http://127.0.0.1:5186/'}scripts/animasa-shading.html?backend=${backend}`);
    await page.waitForFunction(()=>window.shadingValidation?.ready,undefined,{timeout:30000});
    const probes=await page.evaluate(()=>window.shadingValidation.probes());
    const model=await page.evaluate(()=>window.shadingValidation.prepare());
    const comparisons=[];
    for (const oblique of [false,true]) {
      for (const mode of ['before','after','reference']) {
        const data=await page.evaluate(async ({mode,oblique})=> {
          const api=window.shadingValidation;
          (api.linear??={})[mode]=await api.render(mode,oblique,true);
          return api.render(mode,oblique);
        },{mode,oblique});
        if (backend==='webgpu') await writeFile(`${destination}/${oblique?'oblique':'front'}-${mode}.png`,Buffer.from(data.split(',')[1],'base64'));
      }
      const numeric=await page.evaluate(()=>{
        const {before,after,reference}=window.shadingValidation.linear;
        const compare=(pixels)=> {
          let absolute=0,squared=0,maximum=0,channels=0,changed=0,clipped=0,luminance=0;
          // The clear color is shared. Exclude it using the old/reference union;
          // zero-valued black material pixels remain part of this mask.
          const background=before.slice(0,3);
          for(let i=0;i<reference.length;i+=4) {
            if ([0,1,2].every(c=>Math.abs(reference[i+c]-background[c])<1e-6&&Math.abs(before[i+c]-background[c])<1e-6)) continue;
            let pixelMaximum=0;
            for(let c=0;c<3;c++) {const d=Math.abs(pixels[i+c]-reference[i+c]);absolute+=d;squared+=d*d;maximum=Math.max(maximum,d);pixelMaximum=Math.max(pixelMaximum,d);channels++;}
            if(pixelMaximum>0.01)changed++;
            if([0,1,2].some(c=>pixels[i+c]>=1))clipped++;
            luminance+=0.2126*pixels[i]+0.7152*pixels[i+1]+0.0722*pixels[i+2];
          }
          return {pixels:channels/3,meanAbsoluteLinearRGB:absolute/channels,rootMeanSquareLinearRGB:Math.sqrt(squared/channels),
            maximumLinearRGB:maximum,pixelsOver001:changed,pixelsAtOrAboveDisplayWhite:clipped,meanLinearLuminance:luminance/(channels/3)};
        };
        return {before:compare(before),after:compare(after),reference:compare(reference)};
      });
      assert.ok(numeric.after.meanAbsoluteLinearRGB<numeric.before.meanAbsoluteLinearRGB*0.25,`${backend}: insufficient reference alignment`);
      assert.ok(numeric.after.meanAbsoluteLinearRGB<0.0001,`${backend}: reference error exceeds tolerance`);
      assert.ok(numeric.after.pixelsOver001<=4,`${backend}: excessive reference pixel outliers`);
      comparisons.push({view:oblique?'oblique':'front',...numeric});
    }
    assert.deepEqual(errors,[]);
    report.backends.push({backend,probes,model,comparisons,errors});await page.close();
  }
  await writeFile(`${destination}/report.json`,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
} finally {await browser.close();}
