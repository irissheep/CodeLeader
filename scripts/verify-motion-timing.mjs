import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import electron from 'electron';
import {chromium} from 'playwright';
import {build} from 'vite';
import {build as bundle} from 'esbuild';
import {guard,root} from './common.mjs';
guard();
const configFile=path.join(root,'tests/fixtures/u8-review.json'),config=JSON.parse(await fs.readFile(configFile,'utf8'));
const phase=process.argv.includes('--before')?'before':'after',out=path.join(root,config.output),run=phase+'-motion',folder=path.join(out,'layout',run);
await fs.mkdir(folder,{recursive:true});
await bundle({stdin:{contents:"export {collectAnalysisNotes} from './src/main/analysis-notes';",resolveDir:root},outfile:path.join(folder,'notes.cjs'),bundle:true,platform:'node',format:'cjs'});
await build({configFile:false,root:path.join(root,phase==='before'?config.output+'/source-before/src/renderer':'src/renderer'),base:'./',build:{outDir:path.join(folder,'renderer'),emptyOutDir:true,chunkSizeWarningLimit:4000},worker:{format:'es'}});
const server=net.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));
const env={...process.env,CODELEADER_LAYOUT_CONFIG:configFile,CODELEADER_LAYOUT_PHASE:run,CODELEADER_LAYOUT_PORT:String(port)};delete env.ELECTRON_RUN_AS_NODE;
const log=await fs.open(path.join(folder,'window.log'),'a'),child=spawn(electron,[path.join(root,'scripts/layout-window.cjs')],{cwd:root,env,windowsHide:true,stdio:['ignore',log.fd,log.fd]});
let browser,page;const evidence={phase,clock:'Each CSS animation is paused at creation, then document.getAnimations() currentTime is set in milliseconds. Layout/worker time precedes this visual clock.',views:[],hovers:[],errors:[]};
try{
 for(let i=0;i<80;i++){try{browser=await chromium.connectOverCDP('http://127.0.0.1:'+port,{timeout:1000});break;}catch{await new Promise(r=>setTimeout(r,100));}}
 if(!browser)throw Error('Review window did not start');page=browser.contexts()[0].pages()[0];page.on('pageerror',e=>evidence.errors.push(String(e)));
 await page.waitForSelector('[data-view=main]');const ready=page.waitForEvent('load');await page.evaluate(project=>window.codeleader.layoutLoad({mode:'static',project}),config.deliveryProject).catch(e=>{if(!String(e).includes('destroyed'))throw e;});await ready;
 await page.waitForSelector('[data-view=main]');await page.waitForFunction(()=>document.querySelector('.graph-canvas')?.dataset.layoutBusy==='false');
 await page.mouse.move(5,45);
 for(const [view,times]of [['main',[0,120,240,360,520,900]],['overview',[0,250,500,750,1000,1500]]]){
  await page.locator('[data-view=guide]').click();await page.waitForFunction(()=>document.querySelector('.graph-canvas')?.dataset.layoutBusy==='false');await page.waitForTimeout(1000);
  await page.evaluate(()=>{
   window.__timing={animations:new Set(),enabled:true,transitions:[]};
   const freeze=()=>{const state=window.__timing;if(!state.enabled)return;for(const a of document.getAnimations()){
    if(a.effect?.pseudoElement?.includes('view-transition')&&!state.transitions.some(x=>x.target===a.effect.pseudoElement&&x.name===a.animationName))state.transitions.push({target:a.effect.pseudoElement,name:a.animationName,timing:a.effect.getTiming(),keyframes:a.effect.getKeyframes()});
    const el=a.effect?.target;if(!el?.closest?.('.graph-canvas')||a.constructor.name==='CSSTransition')continue;
    if(!state.animations.has(a)){state.animations.add(a);a.pause();a.currentTime=0;}
   }requestAnimationFrame(freeze);};freeze();
  });
  await page.locator(`[data-view=${view}]`).click();await page.waitForFunction(view=>document.querySelector(`[data-view=${view}]`)?.getAttribute('aria-pressed')==='true'&&document.querySelector('.graph-canvas')?.dataset.layoutBusy==='false',view);await page.waitForTimeout(180);
  const item={view,times:[],viewTransitions:await page.evaluate(()=>window.__timing.transitions),animations:await page.evaluate(()=>[...window.__timing.animations].filter(a=>a.effect?.target?.isConnected).map(a=>({name:a.animationName||'WebAnimation',target:a.effect.target.getAttribute('class'),node:a.effect.target.closest('[data-id]')?.dataset.id,timing:a.effect.getTiming(),easings:a.effect.getKeyframes().map(k=>k.easing),properties:[...new Set(a.effect.getKeyframes().flatMap(k=>Object.keys(k).filter(p=>!['offset','computedOffset','easing','composite'].includes(p))))]})))};
  await page.evaluate(()=>window.__timing.nodes=new Map([...document.querySelectorAll('.react-flow__node')].map(n=>[n.dataset.id,n])));
  for(const time of times){
   await page.evaluate(time=>{for(const a of document.getAnimations()){if(window.__timing.animations.has(a)){a.pause();a.currentTime=time;}}},time);await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
   const measurement=await page.evaluate(()=>({viewport:document.querySelector('.react-flow__viewport')?.style.transform,nodes:[...document.querySelectorAll('.react-flow__node')].map(n=>({id:n.dataset.id,same:window.__timing.nodes.get(n.dataset.id)===n,transform:n.style.transform,cardOpacity:getComputedStyle(n.querySelector('.dependency-lane-card,.service-container,.graph-card')||n).opacity})),blocks:[...document.querySelectorAll('[data-module-block]')].map(n=>({id:n.dataset.moduleBlock,opacity:getComputedStyle(n).opacity,transform:getComputedStyle(n).transform,delay:getComputedStyle(n).animationDelay})),lines:[...document.querySelectorAll('.lane-edge-visual,.hierarchy-front-band,.main-context-edge')].map(n=>({name:n.getAttribute('class'),opacity:getComputedStyle(n).opacity})),outerAnimations:[...document.querySelectorAll('.react-flow__node')].flatMap(n=>n.getAnimations().map(a=>a.animationName||'WebAnimation'))}));
   const name=`frames/${view}-${time}`;await page.evaluate(name=>window.codeleader.capture(name),name);item.times.push({time,screenshot:name+'.png',...measurement});
  }
  await page.evaluate(()=>{window.__timing.enabled=false;for(const a of window.__timing.animations){if(a.effect?.getTiming().iterations===Infinity)a.play();else a.finish();}});
  if(view==='main'){
   await page.mouse.move(5,45);
   const samples=await page.locator('[data-module-block]').evaluateAll(es=>es.map(e=>({id:e.dataset.moduleBlock,count:Number(e.dataset.frontendCount)})));
   for(const kind of ['used','unused']){const m=samples.find(m=>kind==='used'?m.count>0:m.count===0);if(!m)continue;await page.locator(`[data-module-block="${m.id}"]`).hover();await page.waitForTimeout(190);await page.evaluate(name=>window.codeleader.capture(name),'hover/'+kind);evidence.hovers.push(await page.evaluate(kind=>({kind,blocks:[...document.querySelectorAll('[data-module-block]')].map(e=>({id:e.dataset.moduleBlock,hover:e.matches(':hover'),transform:getComputedStyle(e).transform,opacity:getComputedStyle(e).opacity,duration:getComputedStyle(e).transitionDuration})),tooltip:[...document.querySelectorAll('.module-tooltip')].map(e=>({open:e.dataset.open,opacity:getComputedStyle(e).opacity,duration:getComputedStyle(e).transitionDuration})),dots:[...document.querySelectorAll('.hierarchy-travel-dot')].map(e=>({r:e.getAttribute('r'),opacity:getComputedStyle(e).opacity,period:getComputedStyle(e).animationDuration,phase:getComputedStyle(e).animationDelay,state:getComputedStyle(e).animationPlayState}))}),kind));}
   await page.mouse.move(5,45);await page.waitForTimeout(180);
  }else{
   for(const [kind,selector]of [['dependency-card','.dependency-lane-card:not(.lane-common-chip)'],['common-chip','.lane-common-chip']]){const element=page.locator(selector).first();if(!await element.count())continue;await element.hover();await page.waitForTimeout(210);await page.evaluate(name=>window.codeleader.capture(name),'hover/'+kind);evidence.hovers.push(await page.evaluate(kind=>({kind,cards:[...document.querySelectorAll('.react-flow__node')].map(e=>({id:e.dataset.id,opacity:getComputedStyle(e).opacity})),lines:[...document.querySelectorAll('.react-flow__edge')].map(e=>({related:e.classList.contains('lane-related'),opacity:getComputedStyle(e.querySelector('.react-flow__edge-path')).opacity,duration:getComputedStyle(e.querySelector('.react-flow__edge-path')).transitionDuration}))}),kind));}await page.mouse.move(5,45);await page.waitForTimeout(210);
  }
  evidence.views.push(item);
 }
 await page.locator('[data-view=guide]').click();await page.waitForFunction(()=>document.querySelector('.graph-canvas')?.dataset.layoutBusy==='false');await page.waitForTimeout(1000);
 const largest=await page.locator('[data-module-block]').evaluateAll(es=>es.sort((a,b)=>Number(b.dataset.entryCount)-Number(a.dataset.entryCount))[0].dataset.moduleBlock);await page.locator(`[data-module-block="${largest}"]`).click();await page.waitForSelector('.hierarchy-interface-panel');await page.waitForTimeout(80);
 evidence.interfaceRows=await page.locator('.hierarchy-interface-item').evaluateAll(es=>es.map(e=>({duration:getComputedStyle(e).animationDuration,delay:getComputedStyle(e).animationDelay,easing:getComputedStyle(e).animationTimingFunction})));
 await page.waitForTimeout(1200);await page.evaluate(()=>window.codeleader.capture('hover/interface-selected'));
 // The live system preference overrides a saved full setting.
 await page.emulateMedia({reducedMotion:'reduce'});await page.waitForTimeout(150);
 evidence.reduced={running:[],views:[]};
 for(const view of ['main','overview']){await page.locator(`[data-view=${view}]`).click();await page.waitForFunction(view=>document.querySelector(`[data-view=${view}]`)?.getAttribute('aria-pressed')==='true'&&document.querySelector('.graph-canvas')?.dataset.layoutBusy==='false',view);await page.waitForTimeout(100);const result=await page.evaluate(()=>({running:document.getAnimations().filter(a=>a.playState==='running'&&a.effect?.target?.closest?.('.graph-canvas')).map(a=>a.animationName||'WebAnimation'),nodes:[...document.querySelectorAll('.dependency-lane-card,.hierarchy-unit,.graph-card')].map(n=>({opacity:getComputedStyle(n).opacity,transform:getComputedStyle(n).transform}))}));evidence.reduced.running.push(...result.running);evidence.reduced.views.push({view,...result});await page.evaluate(name=>window.codeleader.capture(name),'reduced-'+view);}
 if(phase==='after'){
  const fail=(ok,message)=>{if(!ok)evidence.errors.push(message);};
  const main=evidence.views.find(v=>v.view==='main'),dependency=evidence.views.find(v=>v.view==='overview');
  for(const v of evidence.views){fail(v.times.every(t=>t.nodes.every(n=>n.same)&&!t.outerAnimations.length),'Node identity/outer animation: '+v.view);fail(v.animations.every(a=>a.properties.every(p=>['transform','opacity','strokeDashoffset'].includes(p))),'Unexpected animated property: '+v.view);}
  const modules=main.animations.filter(a=>a.target.includes('module-block')).sort((a,b)=>a.timing.delay-b.timing.delay);
  fail(modules.every((a,i)=>a.timing.duration===380&&a.timing.delay===i*14&&a.timing.fill==='backwards'),'Module sequence');
  fail(main.animations.filter(a=>a.name==='up'&&!a.target.includes('module-block')).every(a=>a.timing.duration===400),'Card duration');
  const linksAfter=Math.max(500,...modules.map(a=>a.timing.delay+a.timing.duration));
  fail(main.animations.filter(a=>a.name==='fade').every(a=>a.timing.duration===400&&a.timing.delay===linksAfter),'Links follow last module');
  const cards=dependency.animations.filter(a=>a.name==='up').sort((a,b)=>a.timing.delay-b.timing.delay);
  fail(cards.every((a,i)=>a.timing.duration===400&&a.timing.delay===i*45),'Dependency sequence');
  fail(dependency.animations.filter(a=>a.name==='draw').every(a=>a.timing.duration===600&&a.timing.delay===400),'Path drawing');
  fail(dependency.animations.filter(a=>a.name==='fade').every(a=>a.timing.duration===400&&a.timing.delay===500),'Line fade');
  fail(evidence.interfaceRows.length>1&&evidence.interfaceRows.every((r,i)=>parseFloat(r.duration)===.35&&Math.abs(parseFloat(r.delay)-(.2+i*.03))<.00001),'Interface sequence');
  const used=evidence.hovers.find(h=>h.kind==='used');fail(used.blocks.find(b=>b.hover)?.transform==='matrix(1, 0, 0, 1, 0, -2)','Hover lift');
  fail(used.dots.filter(d=>d.state==='running').length===2&&used.dots.filter(d=>d.state==='running').every(d=>d.r==='2.6'&&d.period==='1.4s'&&d.opacity==='0.9'),'Hover dots');
  fail(!evidence.reduced.running.length&&evidence.reduced.views.every(v=>v.nodes.every(n=>n.opacity==='1'&&n.transform==='none')),'Reduced final state');
 }
 await fs.writeFile(path.join(folder,'TIMING.json'),JSON.stringify(evidence,null,2));
 // Compose the actual six full-size captures into one review sheet, with no image resampling beyond display size.
 for(const item of evidence.views){const html=`<!doctype html><meta charset="utf-8"><style>body{margin:0;padding:16px;background:#eee;font:16px system-ui}main{display:grid;grid-template-columns:repeat(3,620px);gap:16px}figure{margin:0}img{width:620px;height:auto}figcaption{padding:8px 0}</style><main>${item.times.map(t=>`<figure><img src="${pathToFileURL(path.join(folder,t.screenshot))}"><figcaption>${t.time} ms</figcaption></figure>`).join('')}</main>`;
  const file=path.join(folder,item.view+'-storyboard.html');await fs.writeFile(file,html);await page.setViewportSize({width:1908,height:850});await page.goto(pathToFileURL(file).href);await page.screenshot({path:path.join(folder,item.view+'-storyboard.png'),fullPage:true});
 }
 console.log(JSON.stringify({phase,views:evidence.views.map(v=>({view:v.view,animations:v.animations.length,frames:v.times.length})),reducedRunning:evidence.reduced.running,errors:evidence.errors}));if(evidence.errors.length)process.exitCode=1;
}finally{await page?.evaluate(()=>window.codeleader?.reviewClose()).catch(()=>{});await browser?.close().catch(()=>{});child.kill();await log.close();}
