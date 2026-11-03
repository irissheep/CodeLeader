import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {build as viteBuild} from 'vite';
import { _electron as electron } from 'playwright';
import electronPath from 'electron';
import {guard,root} from './common.mjs';
import {inspectCollisions} from './u11-collision.mjs';
import {beginSampling,finishSampling} from './u11-continuity.mjs';

guard();
const mode=process.argv.includes('--collision')?'collision':'continuity',smoke=process.argv.includes('--smoke'),sample=process.argv.includes('--sample');
const out=path.join(root,'.tmp/verification-u11-continuity'),phase='after',folder=path.join(out,'layout',phase),source=path.join(root,'.tmp/verification-generalization-baseline');
const projects=smoke?['learnflow']:['learnflow','ruoyi','wms'];
const sizes=smoke||sample?[[1580,959]]:[[1280,720],[1580,959],[1920,1080]],scales=smoke||sample?[1]:[1,1.25,1.5];
await fs.mkdir(folder,{recursive:true});await fs.writeFile(path.join(out,'review.json'),JSON.stringify({output:path.relative(root,out)}));
const models=[];
for(const id of projects){const file=path.join(source,id,'model.json');try{const value=await fs.readFile(file,'utf8');JSON.parse(value);await fs.mkdir(path.join(out,'before',id),{recursive:true});await fs.writeFile(path.join(out,'before',id,'model.json'),value);models.push({id,value:JSON.parse(value)});}catch(error){throw Error(`缺少 ${id} 的实际分析结果：${String(error)}`);}}
await fs.writeFile(path.join(out,'projects.json'),JSON.stringify(models.map(({id})=>({id}))));await fs.writeFile(path.join(out,'runtime-inputs.json'),JSON.stringify({static:models[0].value,runtime:models[0].value,record:{}}));
await build({stdin:{contents:"export {collectAnalysisNotes} from './src/main/analysis-notes';",resolveDir:root},outfile:path.join(folder,'notes.cjs'),bundle:true,platform:'node',format:'cjs'});
await viteBuild({configFile:false,root:path.join(root,'src/renderer'),base:'./',build:{outDir:path.join(folder,'renderer'),emptyOutDir:true,chunkSizeWarningLimit:4000},worker:{format:'es'}});
const results=[];let failed=false;
try{for(const scale of scales){
 const env={...process.env,CODELEADER_LAYOUT_CONFIG:path.join(out,'review.json'),CODELEADER_LAYOUT_PHASE:phase,CODELEADER_LAYOUT_PORT:'0',CODELEADER_ZOOM_NATIVE:'1'};delete env.ELECTRON_RUN_AS_NODE;
 const app=await electron.launch({executablePath:electronPath,args:[path.join(root,'scripts/layout-window.cjs'),`--force-device-scale-factor=${scale}`],cwd:root,env,timeout:45000});
 try{
  const page=await app.firstWindow();const actualScale=await page.evaluate(()=>devicePixelRatio);if(Math.abs(actualScale-scale)>.01)throw Error(`请求 DPI ${scale}，实际 ${actualScale}`);
  for(const [width,height] of sizes){await page.evaluate(([w,h])=>window.codeleader.layoutSize(w,h),[width,height]);
   for(const {id} of models){
    const load=page.waitForEvent('load');await page.evaluate(project=>window.codeleader.layoutLoad({mode:'static',project}),id).catch(error=>{if(!String(error).includes('destroyed'))throw error;});await load;await page.waitForFunction(()=>document.querySelector('.graph-canvas')?.getAttribute('data-layout-busy')==='false',{timeout:45000});
    await page.waitForTimeout(400);const dismiss=page.getByRole('button',{name:'知道了'});if(await dismiss.isVisible())await dismiss.click();
    await page.waitForSelector('[data-module-block]',{timeout:15000});
    const modules=await page.locator('[data-module-block]').evaluateAll(nodes=>nodes.map(n=>({id:n.getAttribute('data-module-block'),name:n.getAttribute('data-module-name')})));
    const selected=smoke||sample||mode==='continuity'?[modules.find(m=>m.name?.includes('notes'))||modules[0]]:modules;
    for(const module of selected){
     const row={project:id,width,height,scale,module:module.id,mode,states:[],errors:[]};results.push(row);
     try{
      const block=page.locator('[data-module-block]').filter({has:page.locator('.module-name')}).locator(`:scope[data-module-block="${module.id}"]`);
      await block.scrollIntoViewIfNeeded();
      const before=await page.evaluate(()=>{const e=document.querySelector('[data-module-block]');return !!e;});if(!before)throw Error('模块不可见');
      await page.evaluate(id=>{const e=[...document.querySelectorAll('[data-module-block]')].find(n=>n.getAttribute('data-module-block')===id);window.__u11Anchor=e;},module.id);
      if(smoke)await page.screenshot({path:path.join(out,`${id}-${mode}-overview.png`)});
      const inspectApplication=async name=>{const heading=block.locator('xpath=ancestor::*[contains(@class,"hierarchy-unit")]').locator('.hierarchy-application-heading');await heading.click();await page.waitForTimeout(300);if(!await page.locator('.inspector-close').count()){row.errors.push(`${name} 无法打开详情栏`);return;}row.states.push({name:name+'-inspector',collisions:await page.evaluate(inspectCollisions)});await page.locator('.inspector-close').click();await page.waitForTimeout(300);};
      if(mode==='collision'){row.states.push({name:'overview',collisions:await page.evaluate(inspectCollisions)});await inspectApplication('overview');}
      if(mode==='continuity')await beginSampling(page);await block.click();if(mode==='continuity'){const transition=await finishSampling(page);row.states.push({name:'S0→S1',transition});row.errors.push(...transition.errors.map(error=>`S0→S1 ${error}`));}await page.waitForFunction(()=>document.querySelector('[data-domain-id]'),undefined,{timeout:15000});await page.waitForTimeout(400);
      const intact=await page.evaluate(()=>!!window.__u11Anchor?.isConnected);const collisions=await page.evaluate(inspectCollisions);row.states.push({name:'expanded',intact,collisions});
      if(smoke)await page.screenshot({path:path.join(out,`${id}-${mode}-expanded.png`)});
      if(mode==='collision')await inspectApplication('expanded');
      const entries=await page.locator('.inline-interfaces [data-entry-id]').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('data-entry-id')));if(!entries.length)row.errors.push('展开后未找到接口行');
      for(const entry of smoke||sample||mode==='continuity'?entries.slice(0,1):entries){const element=page.locator('.inline-interfaces [data-entry-id]').filter({has:page.locator('.entry-route')}).locator(`:scope[data-entry-id="${entry}"] .entry-route`);if(mode==='continuity')await beginSampling(page);await element.click();if(mode==='continuity'){const transition=await finishSampling(page);row.states.push({name:'S1→S2',transition});row.errors.push(...transition.errors.map(error=>`S1→S2 ${error}`));}await page.waitForTimeout(400);const flowVisible=await page.locator('[data-domain-id][data-stage=chain]').count();if(!flowVisible)row.errors.push('未进入流程');row.states.push({name:'flow',entry,collisions:await page.evaluate(inspectCollisions)});if(smoke)await page.screenshot({path:path.join(out,`${id}-${mode}-flow.png`)});
       if(mode==='collision'){const card=page.locator('.react-flow__node:has(.kind-symbol) .card-accessible').first();if(await card.count()){await card.click({position:{x:8,y:8}});await page.waitForTimeout(300);if(await page.locator('.inspector-close').count()){row.states.push({name:'flow-inspector',entry,collisions:await page.evaluate(inspectCollisions)});if(smoke)await page.screenshot({path:path.join(out,`${id}-${mode}-flow-inspector.png`)});await page.locator('.inspector-close').click();await page.waitForTimeout(300);}else row.errors.push('无法打开详情栏');}else row.errors.push('未找到流程节点以检查详情栏');}
       if(mode==='continuity')await beginSampling(page);await page.keyboard.press('Escape');if(mode==='continuity'){const transition=await finishSampling(page);row.states.push({name:'S2→S1',transition});row.errors.push(...transition.errors.map(error=>`S2→S1 ${error}`));}await page.waitForTimeout(300);if(!await page.locator('[data-domain-id][data-stage=interfaces]').count())row.errors.push('未返回接口列表');}
      if(mode==='continuity')await beginSampling(page);await page.keyboard.press('Escape');if(mode==='continuity'){const transition=await finishSampling(page);row.states.push({name:'S1→S0',transition});row.errors.push(...transition.errors.map(error=>`S1→S0 ${error}`));}await page.waitForTimeout(300);if(await page.locator('[data-domain-id]').count())row.errors.push('未收起接口列表');row.states.push({name:'closed',intact:await page.evaluate(()=>!!window.__u11Anchor?.isConnected),collisions:await page.evaluate(inspectCollisions)});
      if(!intact)row.errors.push('展开后模块元素已重建');
      if(mode==='collision')for(const state of row.states){const c=state.collisions;if(c.errors.length||c.text.length||c.overflow.length||c.childrenOutside.length||c.controlsOverlap.length||c.tooltipOverlap)row.errors.push(`${state.name} 存在版式问题`);}
     }catch(error){row.errors.push(String(error));}
     if(row.errors.length){failed=true;row.failureScreenshot=path.join(out,`${id}-${mode}-${width}x${height}-${scale}-${results.length}-failure.png`);await page.screenshot({path:row.failureScreenshot}).catch(()=>{});}console.log(JSON.stringify({project:id,viewport:[width,height],scale,module:module.name,errors:row.errors}));await fs.writeFile(path.join(out,`${mode}${smoke?'-smoke':sample?'-sample':''}.json`),JSON.stringify({mode,smoke,sample,complete:false,results},null,2));
    }
   }
  }
 }finally{await app.close().catch(()=>{});}
}}catch(error){failed=true;results.push({errors:[String(error)]});console.error('检查中断：',String(error));}
await fs.writeFile(path.join(out,`${mode}${smoke?'-smoke':sample?'-sample':''}.json`),JSON.stringify({mode,smoke,sample,complete:!results.some(row=>!row.project),results},null,2));
if(failed)process.exitCode=1;
