import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {build} from 'vite';
import {build as bundle} from 'esbuild';
import electron from 'electron';
import {chromium} from 'playwright';
import {root,guard} from './common.mjs';
import {installZoomProbe,zoomSummary} from './zoom-smooth-probe.mjs';
import {openSavedRuntime} from './open-saved-runtime.mjs';
// Direct npm invocation uses the same process-local D-drive directories as the project launcher.
for(const [key,relative]of Object.entries({TEMP:'.tmp',TMP:'.tmp',TMPDIR:'.tmp',npm_config_cache:'.cache/npm',ELECTRON_CACHE:'.cache/electron',PLAYWRIGHT_BROWSERS_PATH:'.cache/browsers'}))process.env[key]=path.join(root,relative);
guard();
const read=async f=>JSON.parse(await fs.readFile(f,'utf8')),configFile=path.resolve(root,process.argv.find(a=>a.startsWith('--review-config='))?.slice('--review-config='.length)||'tests/fixtures/zoom-review.json'),config=await read(configFile),out=path.join(root,config.output);
const phase=process.argv.includes('--before')?'before':'after',focus=process.argv.includes('--extras-only'),scenarioFilter=process.argv.find(a=>a.startsWith('--scenario='))?.slice('--scenario='.length),sequenceFilter=process.argv.find(a=>a.startsWith('--sequence='))?.slice('--sequence='.length),suffix=process.argv.find(a=>a.startsWith('--run-suffix='))?.slice('--run-suffix='.length)||'';
if(suffix&&!/^[a-z-]+$/.test(suffix))throw Error('Invalid run suffix');
const run=phase+'-zoom'+(focus?'-focused':'')+(suffix?'-'+suffix:''),folder=path.join(out,'layout',run);await fs.mkdir(folder,{recursive:true});
await bundle({stdin:{contents:"export {collectAnalysisNotes} from './src/main/analysis-notes';",resolveDir:root},outfile:path.join(folder,'notes.cjs'),bundle:true,platform:'node',format:'cjs'});
function tierCounters(source){
 if(!source.includes('const changed='))return source;
 const begin="const __tierStart=performance.now(),__tierOriginal=area.dataset.semantic+':'+area.dataset.layoutDetail+':'+area.dataset.tier;const __tierFinish=()=>{if(globalThis.__zoomProbe&&__tierOriginal!==area.dataset.semantic+':'+area.dataset.layoutDetail+':'+area.dataset.tier){void area.getBoundingClientRect();globalThis.__zoomProbe.tier({duration:performance.now()-__tierStart,band:area.dataset.semantic});}};";
 return source.replace('   const zoom=new DOMMatrix(',begin+'\n   const zoom=new DOMMatrix(').replace('if(!fonts&&!changed)return;','if(!fonts&&!changed){__tierFinish();return;}').replace('if(!bandChanged&&!versionChanged)return;','if(!bandChanged&&!versionChanged){__tierFinish();return;}').replace("    path.setAttribute('d',roundedPath(points,look.cornerRadius));\n   }", "    path.setAttribute('d',roundedPath(points,look.cornerRadius));\n   }\n   __tierFinish();");
}
await build({configFile:false,root:path.join(root,phase==='before'?config.output+'/source-before/src/renderer':'src/renderer'),base:'./',resolve:{alias:{'react-dom/client':'react-dom/profiling'}},plugins:[{name:'zoom-render-counters',enforce:'pre',transform(source,id){if(id.replaceAll('\\','/').endsWith('/useSemanticZoom.ts'))return tierCounters(source);if(id.replaceAll('\\','/').endsWith('/ExecutionWorkspace.tsx'))return source.replace('setNow(performance.now())',"(globalThis.__zoomProbe?.background(),setNow(performance.now()))");if(!id.replaceAll('\\','/').endsWith('/Graph.tsx'))return;let code=source.replace('const {data,id}=props,[closed',"globalThis.__zoomProbe?.node(props.id);const {data,id}=props,[closed").replace('function RoutedEdge(props:EdgeProps){','function RoutedEdge(props:EdgeProps){globalThis.__zoomProbe?.edge(props.id);').replace('  const zoom=flow.getViewport().zoom;','  const zoom=flow.getViewport().zoom;globalThis.__zoomFlow=flow;');
code=code.replace('useReactFlow, useStore,','useReactFlow, useStoreApi, useStore,').replace('globalThis.__zoomFlow=flow;','globalThis.__zoomFlow=flow;globalThis.__zoomStore=useStoreApi();');code="import {Profiler as ZoomProfiler} from 'react';\n"+code;code=code.replace('return <ModuleTooltipProvider><ReactFlowProvider>',`return <ZoomProfiler id="zoom-graph" onRender={(id,phase,actualDuration,baseDuration,startTime,commitTime)=>globalThis.__zoomProbe?.commit({id,phase,actualDuration,baseDuration,startTime,commitTime})}><ModuleTooltipProvider><ReactFlowProvider>`).replace('</ReactFlowProvider></ModuleTooltipProvider>;', '</ReactFlowProvider></ModuleTooltipProvider></ZoomProfiler>;');return code;}}],build:{outDir:path.join(folder,'renderer'),emptyOutDir:true,chunkSizeWarningLimit:4000},worker:{format:'es'}});
const server=net.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));
const env={...process.env,CODELEADER_LAYOUT_CONFIG:configFile,CODELEADER_LAYOUT_PHASE:run,CODELEADER_LAYOUT_PORT:String(port),CODELEADER_ZOOM_NATIVE:'1'};delete env.ELECTRON_RUN_AS_NODE;
const log=await fs.open(path.join(folder,'window.log'),'a'),child=spawn(electron,[path.join(root,'scripts/layout-window.cjs')],{cwd:root,env,windowsHide:false,stdio:['ignore',log.fd,log.fd]});
let browser,page;const results=[],extras=[],errors=[];
const input={A:Array.from({length:30},()=>({delta:100,delay:60})),B:Array.from({length:200},(_,i)=>({delta:i<100?4:-4,delay:8})),C:Array.from({length:10},()=>({delta:100,delay:60,ctrl:true}))};
async function traceRead(cdp,handle){const chunks=[];while(true){const item=await cdp.send('IO.read',{handle});chunks.push(item.base64Encoded?Buffer.from(item.data,'base64'):Buffer.from(item.data));if(item.eof)break;}await cdp.send('IO.close',{handle});return Buffer.concat(chunks);}
try{
 for(let i=0;i<80;i++){try{browser=await chromium.connectOverCDP('http://127.0.0.1:'+port,{timeout:1000});break;}catch{await new Promise(r=>setTimeout(r,100));}}if(!browser)throw Error('Window unavailable');
 page=browser.contexts()[0].pages()[0];page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(String(e)));await page.bringToFront();
 for(const scenario of config.zoomScenarios.filter(s=>(!focus||s.mode==='runtime')&&(!scenarioFilter||s.project===scenarioFilter))){
  const ready=page.waitForEvent('load');await page.evaluate(input=>window.codeleader.layoutLoad(input),scenario).catch(e=>{if(!String(e).includes('destroyed'))throw e;});await ready;await page.waitForSelector('[data-view=main]');
  if(scenario.mode==='runtime'){await openSavedRuntime(page);const history=await read(path.join(out,'runtime-inputs.json')),op=history.record.operations.find(o=>o.id===history.operationId);await page.getByRole('button',{name:'操作历史',exact:true}).click();await page.getByRole('button',{name:`操作 ${op.number} · ${op.label}`,exact:true}).click();const pause=page.getByLabel('暂停回放',{exact:true});if(await pause.count())await pause.click();await page.locator('.dock-segment[data-step="8"]').click({force:true});await page.waitForTimeout(500);}
  else{const button=page.locator(`[data-view=${scenario.view}]`);if(await button.isEnabled())await button.click();await page.waitForFunction(view=>document.querySelector(`[data-view=${view}]`)?.getAttribute('aria-pressed')==='true'&&document.querySelector('.graph-canvas')?.dataset.layoutBusy==='false',scenario.view);}
  await page.waitForTimeout(1600);await page.evaluate(installZoomProbe);
  const cdp=await page.context().newCDPSession(page);
  for(const [sequence,events]of focus?[]:Object.entries(input).filter(([key])=>!sequenceFilter||key===sequenceFilter)){
   await page.evaluate(async()=>{const area=document.querySelector('.react-flow').getBoundingClientRect(),old=window.__zoomFlow.getViewport(),zoom=1;await window.__zoomFlow.setViewport({x:area.width/2-(area.width/2-old.x)/old.zoom*zoom,y:area.height/2-(area.height/2-old.y)/old.zoom*zoom,zoom});});await page.waitForTimeout(350);
   const area=await page.locator('.graph-canvas .react-flow').boundingBox(),anchor={x:Math.round(area.x+area.width*.53),y:Math.round(area.y+area.height*.47)};await page.mouse.move(anchor.x,anchor.y);await page.waitForTimeout(220);
   const name=scenario.project+'-'+scenario.view+'-'+sequence;
   await cdp.send('Tracing.start',{categories:'devtools.timeline,disabled-by-default-devtools.timeline,cc,blink.user_timing',transferMode:'ReturnAsStream'});
   await page.evaluate(([name,anchor])=>window.__zoomProbe.start(name,anchor),[name,anchor]);const start=performance.now(),sent=[];
   for(let i=0;i<events.length;i++){const event=events[i],at=start+i*event.delay;await new Promise(r=>setTimeout(r,Math.max(0,at-performance.now())));sent.push(cdp.send('Input.dispatchMouseEvent',{type:'mouseWheel',x:anchor.x,y:anchor.y,deltaY:event.delta,deltaX:0,modifiers:event.ctrl?2:0}));}await Promise.all(sent);
   await page.waitForTimeout(350);const data=await page.evaluate(()=>window.__zoomProbe.finish());data.requested=events.length;
   const tracing=new Promise(r=>cdp.once('Tracing.tracingComplete',r));await cdp.send('Tracing.end');const complete=await tracing,bytes=await traceRead(cdp,complete.stream);await fs.writeFile(path.join(folder,name+'-trace.json'),bytes);
   const trace=JSON.parse(bytes).traceEvents,paintNames=['Layout','Paint','RasterTask','Rasterize'],paint=Object.fromEntries(paintNames.map(n=>{const events=trace.filter(e=>e.name===n&&typeof e.dur==='number');return[n,{count:events.length,totalMs:events.reduce((n,e)=>n+e.dur/1000,0),maxMs:Math.max(0,...events.map(e=>e.dur/1000))}];}));
   const summary={project:scenario.project,view:scenario.view,sequence,...zoomSummary(data),paint};results.push(summary);await fs.writeFile(path.join(folder,name+'-frames.json'),JSON.stringify(data));await page.screenshot({path:path.join(folder,name+'.png')});await fs.writeFile(path.join(folder,'RESULT.json'),JSON.stringify({phase,machine:{cpu:os.cpus()[0].model,cpus:os.cpus().length,memoryGB:Math.round(os.totalmem()/1024**3),platform:os.platform(),nativeWindow:true,profilingBuild:true,display:await page.evaluate(()=>window.codeleader.reviewDisplay())},results,errors},null,2));console.log(JSON.stringify(summary));
  }
  const area=await page.locator('.graph-canvas .react-flow').boundingBox(),anchor={x:Math.round(area.x+area.width*.53),y:Math.round(area.y+area.height*.47)};
  const reset=async zoom=>{await page.evaluate(async zoom=>{const area=document.querySelector('.react-flow').getBoundingClientRect(),v=window.__zoomFlow.getViewport();await window.__zoomFlow.setViewport({x:area.width/2-(area.width/2-v.x)/v.zoom*zoom,y:area.height/2-(area.height/2-v.y)/v.zoom*zoom,zoom});},zoom);await page.waitForTimeout(300);};
  const wheel=delta=>cdp.send('Input.dispatchMouseEvent',{type:'mouseWheel',x:anchor.x,y:anchor.y,deltaY:delta,deltaX:0});
  const start=name=>page.evaluate(([name,anchor])=>window.__zoomProbe.start(name,anchor),[name,anchor]);
  const finish=async(name,requested)=>{const data=await page.evaluate(()=>window.__zoomProbe.finish());data.requested=requested;const summary=zoomSummary(data);await fs.writeFile(path.join(folder,name+'-frames.json'),JSON.stringify(data));return{data,summary};};
  const extra={project:scenario.project,view:scenario.view};
  // An isolated inward notch exposes interpolation duration and a readable text edge.
  await reset(1);await page.mouse.move(anchor.x,anchor.y);await page.waitForTimeout(170);const name=scenario.project+'-impulse';await start(name);await wheel(-100);await page.waitForTimeout(200);
  const clip=await page.evaluate(()=>{const elements=[...document.querySelectorAll('.graph-canvas strong,.graph-canvas .semantic-token>span')];for(const e of elements){const r=e.getBoundingClientRect();if(e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true})&&r.width>20&&r.height>8&&r.x>=0&&r.y>=45&&r.right<innerWidth&&r.bottom<innerHeight){window.__zoomText=e;return{x:Math.max(0,Math.floor(r.x)-2),y:Math.max(0,Math.floor(r.y)-2),width:Math.ceil(r.width)+4,height:Math.ceil(r.height)+4};}}});
  const textStyle=()=>page.evaluate(()=>{const e=window.__zoomText;if(!e)return;const r=e.getBoundingClientRect(),styles=[];for(let p=e;p?.closest('.graph-canvas');p=p.parentElement){const s=getComputedStyle(p);styles.push({class:p.className,opacity:s.opacity,color:s.color,fontSize:s.fontSize,transform:s.transform});}return{x:r.x,y:r.y,width:r.width,height:r.height,styles};});
  const style200=await textStyle();
  const restored=await page.evaluate(()=>{const e=document.querySelector('.graph-canvas'),v=e.querySelector('.react-flow__viewport');return{zooming:e.classList.contains('zooming'),willChange:getComputedStyle(v).willChange,opacity:getComputedStyle(v).opacity};});
  await page.evaluate(name=>window.codeleader.capture(name),name+'-native-200');if(clip)await page.screenshot({path:path.join(folder,name+'-text-200.png'),clip});await page.waitForTimeout(200);await page.evaluate(name=>window.codeleader.capture(name),name+'-native-400');if(clip)await page.screenshot({path:path.join(folder,name+'-text-400.png'),clip});
  const style400=await textStyle(),impulse=await finish(name,1),changed=impulse.data.frames.filter((f,i,all)=>i&&Math.abs(f.zoom-all[i-1].zoom)>0.000001);
  extra.impulse={...impulse.summary,firstMotion:changed[0]?.time,lastMotion:changed.at(-1)?.time,spread:changed.length?changed.at(-1).time-changed[0].time:0,restored,clip,style200,style400};
  if(clip){const images=await Promise.all(['200','400'].map(n=>fs.readFile(path.join(folder,name+'-text-'+n+'.png'))));extra.textComparison=await page.evaluate(async images=>{const load=src=>new Promise(r=>{const im=new Image();im.onload=()=>r(im);im.src='data:image/png;base64,'+src;});const bitmaps=await Promise.all(images.map(load)),canvas=document.createElement('canvas');canvas.width=bitmaps[0].width;canvas.height=bitmaps[0].height;const ctx=canvas.getContext('2d'),bytes=bitmaps.map(im=>{ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(im,0,0);return ctx.getImageData(0,0,canvas.width,canvas.height).data;});let changed=0;for(let i=0;i<bytes[0].length;i+=4)if(Math.max(...[0,1,2].map(c=>Math.abs(bytes[0][i+c]-bytes[1][i+c])))>0)changed++;return{pixels:canvas.width*canvas.height,changed};},images.map(b=>b.toString('base64')));}
  if(clip){const native=await Promise.all(['200','400'].map(n=>fs.readFile(path.join(folder,name+'-native-'+n+'.png'))));extra.nativeTextComparison=await page.evaluate(async({images,clip})=>{const load=src=>new Promise(r=>{const im=new Image();im.onload=()=>r(im);im.src='data:image/png;base64,'+src;});const bitmaps=await Promise.all(images.map(load)),canvas=document.createElement('canvas');canvas.width=clip.width;canvas.height=clip.height;const ctx=canvas.getContext('2d'),bytes=bitmaps.map(im=>{ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(im,-clip.x,-clip.y);return ctx.getImageData(0,0,canvas.width,canvas.height).data;});let changed=0;for(let i=0;i<bytes[0].length;i+=4)if(Math.max(...[0,1,2].map(c=>Math.abs(bytes[0][i+c]-bytes[1][i+c])))>0)changed++;return{pixels:canvas.width*canvas.height,changed};},{images:native.map(b=>b.toString('base64')),clip});}
  // Ten round trips across both hysteresis limits; source order is unchanged.
  await reset(.75);await start(scenario.project+'-thresholds');for(let i=0;i<10;i++)for(const delta of [100,100,-100,-100]){await wheel(delta);await page.waitForTimeout(125);}await page.waitForTimeout(220);
  const tiers=await finish(scenario.project+'-thresholds',40);const key=scenario.mode==='runtime'?'layout':'semantic',switches=tiers.data.frames.flatMap((f,i,a)=>i&&f[key]!==a[i-1][key]?[{time:f.time,event:f.event,from:a[i-1][key],to:f[key]}]:[]);extra.thresholds={...tiers.summary,kind:key,switches,byRound:Array.from({length:10},(_,i)=>switches.filter(s=>Math.floor(s.event/4)===i).length),maxRenderDuration:Math.max(0,...tiers.data.commits.map(c=>c.actualDuration)),tierUpdates:tiers.data.tiers,maxTierWork:Math.max(0,...tiers.data.tiers.map(t=>t.duration))};await page.screenshot({path:path.join(folder,scenario.project+'-thresholds.png')});
  extra.bounds=[];const limits=await page.evaluate(()=>({min:window.__zoomStore.getState().minZoom,max:window.__zoomStore.getState().maxZoom}));for(const [bound,zoom,delta]of [['min',limits.min,100],['max',limits.max,-100]]){await reset(zoom);await start(scenario.project+'-'+bound);for(let i=0;i<5;i++){await wheel(delta);await page.waitForTimeout(65);}await page.waitForTimeout(240);const result=await finish(scenario.project+'-'+bound,5);extra.bounds.push({bound,...result.summary,range:Math.max(...result.data.frames.map(f=>f.zoom))-Math.min(...result.data.frames.map(f=>f.zoom))});await page.screenshot({path:path.join(folder,scenario.project+'-'+bound+'.png')});}
  // A real playback action validates that the render counter is not a constant zero.
  if(scenario.mode==='runtime'){await start('render-counter-calibration');await page.getByRole('button',{name:'下一步',exact:true}).click();await page.waitForTimeout(200);const calibration=await finish('render-counter-calibration',0);extra.calibration={renders:calibration.data.renders.length,commits:calibration.data.commits.length};}
  extras.push(extra);await fs.writeFile(path.join(folder,'EXTRAS.json'),JSON.stringify({phase,extras},null,2));await cdp.detach();
 }
}finally{await page?.evaluate(()=>window.codeleader?.reviewClose()).catch(()=>{});await browser?.close().catch(()=>{});child.kill();await log.close();}
if(phase==='after'){
 for(const r of results){
  if(r.fps<55||r.p95>20||r.maximum>50||r.longTasks)errors.push(r.name+': frame budget');
  if(r.maxInputCommitsPerWheel>1||r.nodeRenders||r.recreated)errors.push(r.name+': render budget');
  if(r.sequence!=='B'&&r.maxZoomDeltaPercent>6.001)errors.push(r.name+': zoom delta');
  if(r.anchorDrift>1)errors.push(r.name+': anchor');
 }
 for(const e of extras){
  if(e.impulse.spread<100)errors.push(e.project+': isolated impulse shorter than 100ms');
  if(e.impulse.restored.zooming||e.impulse.restored.willChange!=='auto'||!e.textComparison||e.textComparison.changed)errors.push(e.project+': text restoration');
  if(e.thresholds.byRound.some(n=>n!==2)||e.thresholds.maxTierWork>8)errors.push(e.project+': hysteresis');
  if(e.bounds.some(b=>b.range>0.000001))errors.push(e.project+': bounds');
  if(e.calibration&&e.calibration.renders===0)errors.push('Render counter calibration failed');
 }
}
await fs.writeFile(path.join(folder,'SUMMARY.json'),JSON.stringify({phase,cases:results.length,extraScenarios:extras.length,errors},null,2));
if(errors.length)throw Error(errors.join('\n'));
