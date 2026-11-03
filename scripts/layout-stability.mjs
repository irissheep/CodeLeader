import fs from 'node:fs/promises';
import path from 'node:path';
import {installMotionProbe} from './u2-motion-probe.mjs';

// Capture the real renderer during transitions; the sampler keeps world and screen coordinates separate.
export async function recordLayoutStability(page,folder){
 await page.evaluate(installMotionProbe);
 const results=[];
 const record=async(name,action)=>{
  await page.evaluate(name=>window.__motionProbe.start(name),name);await action();
  for(let i=0;i<10;i++){
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));
   await page.evaluate(name=>window.codeleader.capture(name),`stability/${name}/${String(i+1).padStart(2,'0')}`);
  }
  await page.waitForTimeout(400);
  const result=await page.evaluate(()=>window.__motionProbe.finish());results.push(result);
  await fs.writeFile(path.join(folder,'stability-'+name+'.json'),JSON.stringify(result));
 };
 const module=page.locator('.capability button[aria-expanded=true]').first();
 if(!await module.count())throw Error('Current module is not expanded');
 const label=await module.getAttribute('aria-label');
 await record('collapse',()=>module.click());
 await record('expand',()=>page.getByLabel(label,{exact:true}).click());
 await record('details-open',()=>page.locator('.runtime-method-row.is-current').first().click());
 await record('details-close',()=>page.getByLabel('收起数据面板',{exact:true}).click());
 await record('view-switch',()=>page.locator('[data-view=overview]').click());
 const summary=results.map(r=>({name:r.name,frames:r.frameCount,recreated:r.recreated,abnormalFrames:r.abnormalFrames.length,commonNodes:r.identities.filter(i=>i.common).length,commits:r.commits.length}));
 await fs.writeFile(path.join(folder,'STABILITY.json'),JSON.stringify(summary,null,2));
 return summary;
}
