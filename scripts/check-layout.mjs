import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {build} from 'vite';
import electron from 'electron';
import {chromium} from 'playwright';
import {guard,root} from './common.mjs';
import {scanLayout} from './layout-probe.mjs';
import {build as bundle} from 'esbuild';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
import {installMotionProbe,uiMetrics} from './u2-motion-probe.mjs';
import {recordLayoutStability} from './layout-stability.mjs';
import {verifyHierarchy} from './hierarchy-metrics.mjs';
import {openSavedRuntime} from './open-saved-runtime.mjs';
import {installLaneProbe,laneMetrics,verifyLaneInteractions} from './lane-metrics.mjs';
guard();
const read=async file=>JSON.parse(await fs.readFile(file,'utf8')),configFile=path.resolve(root,process.argv.find(a=>a.startsWith('--review-config='))?.slice('--review-config='.length)||'tests/fixtures/u4-review.json'),config=await read(configFile),out=path.join(root,config.output),policy=await read(path.join(root,'scripts/layout-policy.json')),checkWindows=config.layoutWindows||config.windows;
const phase=process.argv.includes('--before')?'before':'after',probe=process.argv.includes('--probe'),hierarchyOnly=process.argv.includes('--hierarchy'),laneOnly=process.argv.includes('--lanes'),metricsOnly=process.argv.includes('--metrics-only'),runName=laneOnly?phase+'-lanes':hierarchyOnly?phase+'-hierarchy':phase==='after'&&probe?'after-probe':phase,folder=path.join(out,'layout',runName);await fs.mkdir(folder,{recursive:true});
let projects;
try{
 projects=await read(path.join(out,'projects.json'));await fs.access(path.join(out,'runtime-inputs.json'));
 for(const project of projects)await fs.access(path.join(out,'before',project.id,'model.json'));
 if(phase==='before')await fs.access(path.join(out,'source-before/src/renderer/index.html'));
}catch(error){throw Error('缺少真实版式检查输入，请按 docs/layout-check.md 恢复冻结归档。'+String(error));}
await bundle({stdin:{contents:"export {collectAnalysisNotes} from './src/main/analysis-notes';",resolveDir:root},outfile:path.join(folder,'notes.cjs'),bundle:true,platform:'node',format:'cjs'});
await build({configFile:false,root:path.join(root,phase==='before'?config.output+'/source-before/src/renderer':'src/renderer'),base:'./',resolve:{preserveSymlinks:true},build:{outDir:path.join(folder,'renderer'),emptyOutDir:true,chunkSizeWarningLimit:4000},worker:{format:'es'}});
const server=net.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve));
const env={...process.env,CODELEADER_LAYOUT_CONFIG:configFile,CODELEADER_LAYOUT_PHASE:runName,CODELEADER_LAYOUT_PORT:String(port)};delete env.ELECTRON_RUN_AS_NODE;
const log=await fs.open(path.join(folder,'window.log'),'a'),child=spawn(electron,[path.join(root,'scripts/layout-window.cjs')],{cwd:root,env,windowsHide:true,stdio:['ignore',log.fd,log.fd]});
let browser,page,runtimeCount=0;const results=[],errors=[];
try{
 for(let i=0;i<60;i++){try{browser=await chromium.connectOverCDP('http://127.0.0.1:'+port,{timeout:1000});break;}catch{await new Promise(resolve=>setTimeout(resolve,100));}}if(!browser)throw Error('Layout renderer unavailable');
 page=browser.contexts()[0].pages()[0];page.setDefaultTimeout(30000);page.on('pageerror',error=>errors.push(String(error)));
 await page.waitForSelector('[data-view=main]');
 const loaded=async input=>{const ready=page.waitForEvent('load');await page.evaluate(input=>window.codeleader.layoutLoad(input),input).catch(error=>{if(!String(error).includes('destroyed'))throw error;});await ready;await page.waitForSelector('[data-view=main]');};
 const inspect=async(project,view,size,state,shot=true)=>{
  if(state!=='hover'){await page.mouse.move(5,50);await page.evaluate(()=>document.activeElement?.blur());}
  const result=await page.evaluate(scanLayout,policy),item={project,view,size,state,...result};results.push(item);
  if(view==='runtime'&&size[0]===1564&&state==='step-9'){const {text,...counts}=await page.evaluate(uiMetrics);item.uiMetrics=counts;}
  if(shot){const name=[project,view,size.join('x'),state].join('/').toLowerCase();await page.evaluate(name=>window.codeleader.capture(name),name);item.screenshot=path.relative(out,path.join(folder,name+'.png')).replaceAll('\\','/');}
  if(hierarchyOnly&&phase==='after'){const index=await read(path.join(out,'before',project,'model.json')),tokens=await read(path.join(root,'src/shared/ui-tokens.json'));item.hierarchy=await verifyHierarchy(page,index,policy,tokens,{name:[project,view,size.join('x')].join('/'),capture:name=>page.evaluate(name=>window.codeleader.capture(name),name),interactions:size[0]===config.windows[0][0]});if(view==='main'&&item.hierarchy.widthFraction+0.001<tokens.hierarchy.minimumWidthFraction)item.hierarchy.issues.push({kind:'width-occupation',actual:item.hierarchy.widthFraction});if(item.hierarchy.issues.length)errors.push(`${project}/${view}/${size.join('x')}: ${item.hierarchy.issues.length} 层级验收问题`);}
  if(laneOnly&&phase==='after'){item.lanes=await page.evaluate(laneMetrics);item.cold=await page.evaluate(()=>window.__laneProbe?.finish());if(!metricsOnly&&size[0]===checkWindows[0][0])item.interactions=await verifyLaneInteractions(page,policy,{name:[project,view,size.join('x')].join('/'),capture:name=>page.evaluate(name=>window.codeleader.capture(name),name)});}
  await fs.writeFile(path.join(folder,'RESULT.json'),JSON.stringify({phase,probe,policyVersion:policy.version,results,errors},null,2));console.log(JSON.stringify({project,view,size,state,texts:result.textCount,violations:result.counts}));
 };
 for(const project of projects.filter(p=>hierarchyOnly?config.projects.includes(p.id):!probe||p.id===config.probeProject)){
  if(laneOnly&&phase==='after'){const index=await read(path.join(out,'before',project.id,'model.json'));await page.evaluate(id=>{for(const key of Object.keys(localStorage))if(key==='codeleader.dependency-orientation.'+id||key.startsWith('codeleader.dependency-positions.'+id+':'))localStorage.removeItem(key);},index.id);}
  await loaded({mode:'static',project:project.id});
  for(const size of hierarchyOnly?config.windows:probe?[checkWindows[0]]:checkWindows){await page.evaluate(([w,h])=>window.codeleader.layoutSize(w,h),size);
   for(const view of laneOnly?['overview']:hierarchyOnly?['main','guide']:probe?['guide']:['main','guide','overview']){
    if(laneOnly&&phase==='after')await page.evaluate(installLaneProbe,[project.id,view,size.join('x')].join('/'));
    const button=page.locator(`[data-view=${view}]`);if(await button.isEnabled())await button.click();await page.waitForFunction(view=>document.querySelector(`[data-view=${view}]`)?.getAttribute('aria-pressed')==='true'&&document.querySelector('.graph-canvas')?.dataset.layoutBusy==='false',view);await page.waitForTimeout(500);
    if(view==='overview'&&phase==='after')await page.waitForFunction(()=>[...document.querySelectorAll('.dependency-lane-card,.lane-draw-mask,.lane-edge-visual.lane-auxiliary')].every(e=>e.getAnimations().every(a=>a.playState==='finished')));
    await inspect(project.id,view,size,'default');
   }
  }
 }
 if(!hierarchyOnly&&!laneOnly){
 await loaded({mode:'runtime'});await openSavedRuntime(page);
 const input=await read(path.join(out,'runtime-inputs.json')),op=input.record.operations.find(o=>o.id===input.operationId);
 await page.getByRole('button',{name:'操作历史',exact:true}).click();await page.getByRole('button',{name:`操作 ${op.number} · ${op.label}`,exact:true}).click();
 const pause=page.getByLabel('暂停回放',{exact:true});if(await pause.count())await pause.click();
 const go=async step=>{const segment=page.locator(`.dock-segment[data-step="${step-1}"]`);await segment.scrollIntoViewIfNeeded();await segment.click({force:true});await page.waitForFunction(step=>document.querySelector('[aria-label="步骤时间轴"]')?.getAttribute('aria-valuenow')===String(step),step);await page.waitForTimeout(950);};
 const count=runtimeCount=Number(await page.locator('[aria-label="步骤时间轴"]').getAttribute('aria-valuemax'));
 for(const size of probe?[checkWindows[0]]:[...checkWindows,config.narrowWindow]){
  await page.evaluate(([w,h])=>window.codeleader.layoutSize(w,h),size);
  for(const step of probe?config.probeSteps:size[0]===900?[3,9,16]:Array.from({length:count},(_,i)=>i+1)){await go(step);const close=page.getByLabel('收起数据面板',{exact:true});if(await close.count())await close.click();await inspect(config.runtimeProject,'runtime',size,'step-'+step,probe||config.screenshotSteps.includes(step));}
  if(!probe){await go(9);const open=page.locator('.capability button[aria-expanded=true]').first();if(await open.count()){const label=await open.getAttribute('aria-label');await open.click();await page.waitForTimeout(500);await inspect(config.runtimeProject,'runtime',size,'collapsed');await page.getByLabel(label,{exact:true}).click();await page.waitForTimeout(500);await inspect(config.runtimeProject,'runtime',size,'expanded');}
   const row=page.locator('.runtime-method-row.is-current').first();if(await row.count()){await row.hover();await page.waitForTimeout(180);await inspect(config.runtimeProject,'runtime',size,'hover');await row.click();await page.waitForTimeout(500);await inspect(config.runtimeProject,'runtime',size,'details');const close=page.getByLabel('收起数据面板',{exact:true});if(await close.count())await close.click();}
   const walk=page.getByRole('button',{name:'步骤走读',exact:true});await walk.click();await page.waitForTimeout(500);await inspect(config.runtimeProject,'runtime',size,'walkthrough');await page.getByRole('button',{name:'收起步骤走读',exact:true}).click();
  }
 }
 if(!probe&&phase==='after'){
  await page.evaluate(([w,h])=>window.codeleader.layoutSize(w,h),checkWindows[0]);await go(1);
  await page.evaluate(installMotionProbe);await page.evaluate(()=>window.__motionProbe.start('saved-17-step-playback'));
  await page.getByLabel('播放回放',{exact:true}).click();
  await page.waitForFunction(count=>document.querySelector('[aria-label="步骤时间轴"]')?.getAttribute('aria-valuenow')===String(count)&&!!document.querySelector('[aria-label="播放回放"]'),count,{timeout:60000});
  const performance=await page.evaluate(()=>window.__motionProbe.finish());
  const machine={platform:os.platform(),release:os.release(),arch:os.arch(),cpu:os.cpus()[0]?.model,logicalCpus:os.cpus().length,memoryGB:Math.round(os.totalmem()/1024**3),electron:process.versions.electron,offscreen:true};
  await fs.writeFile(path.join(folder,'PERFORMANCE.json'),JSON.stringify({machine,...performance}));
  console.log(JSON.stringify({playbackFPS:performance.fps,longTasks:performance.longTasks.length,recreated:performance.recreated,abnormalFrames:performance.abnormalFrames.length,maxCommitsPerStep:performance.maxCommitsPerStep}));
 }
 if(phase==='after'&&process.argv.includes('--stability')){await page.evaluate(([w,h])=>window.codeleader.layoutSize(w,h),checkWindows[0]);await go(9);console.log(JSON.stringify({stability:await recordLayoutStability(page,folder)}));}
 }
 const counts=results.reduce((all,r)=>{for(const[k,n]of Object.entries(r.counts))all[k]=(all[k]||0)+n;return all;},{}),expectedCases=laneOnly?projects.length*checkWindows.length:hierarchyOnly?config.projects.length*config.windows.length*2:probe?1+config.probeSteps.length:projects.length*checkWindows.length*3+runtimeCount*checkWindows.length+3+5*(checkWindows.length+1);
 if(results.length!==expectedCases)errors.push(`覆盖不足：${results.length}/${expectedCases}`);
 if(phase==='before'&&probe&&(!counts['collapsed-text']||!counts['icon-overlap']||!counts['small-font']||!results.some(r=>r.violations.some(v=>v.kind==='text-overlap'&&[v.elementClass,v.otherClass].some(name=>String(name).includes('motion-data-arrival'))))))errors.push('修改前的四类已知缺陷未全部检出');
 const summary={phase,probe,cases:results.length,expectedCases,violations:results.reduce((n,r)=>n+r.violations.length,0),waivers:results.reduce((n,r)=>n+r.waivers.length,0),counts,errors};await fs.writeFile(path.join(folder,'SUMMARY.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary));
 if(summary.violations||errors.length)process.exitCode=1;
 if(laneOnly&&phase==='after'&&!metricsOnly){
  const project=projects.find(p=>p.id===config.probeProject)||projects[0],index=await read(path.join(out,'before',project.id,'model.json'));
  await page.evaluate(()=>{for(const key of Object.keys(localStorage))if(key.startsWith('codeleader.dependency-positions.'))localStorage.removeItem(key);});
  await page.evaluate(width=>window.codeleader.layoutSize(width,1000),config.narrowWindow[0]);await page.evaluate(id=>localStorage.removeItem('codeleader.dependency-orientation.'+id),index.id);await loaded({mode:'static',project:project.id});await page.locator('[data-view=overview]').click();await page.waitForFunction(()=>document.querySelector('.graph-canvas')?.dataset.layoutBusy==='false'&&document.querySelector('.dependency-lane-card'));await page.waitForTimeout(500);
  const portrait=await page.evaluate(laneMetrics),portraitLayout=await page.evaluate(scanLayout,policy);await page.evaluate(()=>window.codeleader.capture('portrait/default'));await page.evaluate(()=>window.codeleader.layoutSize(1564,954));await page.waitForTimeout(500);const resized=await page.evaluate(laneMetrics);
  await fs.writeFile(path.join(folder,'PORTRAIT.json'),JSON.stringify({portrait,layout:portraitLayout,resized,stable:portrait.orientation===resized.orientation&&JSON.stringify(portrait.nodes)===JSON.stringify(resized.nodes)},null,2));
  if(portraitLayout.violations.length||portrait.orientation!==resized.orientation||JSON.stringify(portrait.nodes)!==JSON.stringify(resized.nodes))throw Error('竖屏版式或固定方向检查未通过');
  await page.goto(pathToFileURL(path.join(root,'tests/fixtures/layout-exterior.html')).href);const selftest=await page.evaluate(scanLayout,policy);await fs.writeFile(path.join(folder,'GUARD-SELFTEST.json'),JSON.stringify(selftest,null,2));if(!selftest.violations.some(v=>v.kind==='edge-exterior'))throw Error('走线外扩检查未能检出固件违规');
 }
}catch(error){await fs.writeFile(path.join(folder,'FAILURE.json'),JSON.stringify({error:String(error),errors,completed:results.length},null,2));throw error;}
finally{await page?.evaluate(()=>window.codeleader.reviewClose()).catch(()=>{});await browser?.close().catch(()=>{});child.kill();await log.close();}
