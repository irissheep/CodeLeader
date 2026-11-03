import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {build} from 'vite';
import {build as bundle} from 'esbuild';
import electron from 'electron';
import {chromium} from 'playwright';
import {root,guard} from './common.mjs';
import {openSavedRuntime} from './open-saved-runtime.mjs';

for(const [key,relative]of Object.entries({TEMP:'.tmp',TMP:'.tmp',TMPDIR:'.tmp',npm_config_cache:'.cache/npm',ELECTRON_CACHE:'.cache/electron',PLAYWRIGHT_BROWSERS_PATH:'.cache/browsers'}))process.env[key]=path.join(root,relative);
guard();
const configFile=path.resolve(root,process.argv.find(a=>a.startsWith('--review-config='))?.slice('--review-config='.length)||'tests/fixtures/overlay-review.json'),config=JSON.parse(await fs.readFile(configFile,'utf8'));
const phase=process.argv.includes('--before')?'before':'after',layersOnly=process.argv.includes('--layers-only'),run=phase+(layersOnly?'-overlay-layers':'-overlay'),folder=path.join(root,config.output,'layout',run);
await fs.mkdir(folder,{recursive:true});
await bundle({stdin:{contents:"export {collectAnalysisNotes} from './src/main/analysis-notes';",resolveDir:root},outfile:path.join(folder,'notes.cjs'),bundle:true,platform:'node',format:'cjs'});
await build({configFile:false,root:path.join(root,phase==='before'?config.output+'/source-before/src/renderer':'src/renderer'),base:'./',build:{outDir:path.join(folder,'renderer'),emptyOutDir:true,chunkSizeWarningLimit:4000},worker:{format:'es'}});
const server=net.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));
const log=await fs.open(path.join(folder,'window.log'),'a'),env={...process.env,CODELEADER_LAYOUT_CONFIG:configFile,CODELEADER_LAYOUT_PHASE:run,CODELEADER_LAYOUT_PORT:String(port),CODELEADER_ZOOM_NATIVE:'1'};delete env.ELECTRON_RUN_AS_NODE;
const child=spawn(electron,[path.join(root,'scripts/layout-window.cjs')],{cwd:root,env,windowsHide:false,stdio:['ignore',log.fd,log.fd]});
let browser,page;const cases=[],errors=[],frames=[],tooltips=[],hovers=[],layers=[];
// Screen endpoints are read from the rendered path, never from a viewport API.
function measure(id){
 const overlay=document.querySelector('.hierarchy-focus-band'),line=overlay?.querySelector('[data-hover-path]')||overlay?.querySelector('path'),block=document.querySelector(`[data-module-block="${CSS.escape(id)}"]`),front=document.querySelector('.hierarchy-frontend[data-unit-id]');
 if(!line?.getAttribute('d')||!block||!front)return{error:'No measured line or anchor',id};
 const viewport=document.querySelector('.react-flow__viewport'),matrix=new DOMMatrix(getComputedStyle(viewport).transform),a=front.getBoundingClientRect(),b=block.getBoundingClientRect(),pseudo=getComputedStyle(block,'::before'),scale=b.width/block.offsetWidth;
 const stripe=(parseFloat(getComputedStyle(block).borderLeftWidth)+parseFloat(pseudo.width)/2)*scale;
 const at=t=>{const p=line.getPointAtLength(t*line.getTotalLength());return new DOMPoint(p.x,p.y).matrixTransform(line.getScreenCTM());},start=at(0),end=at(1),wantedStart={x:a.right,y:a.top+a.height/2},wantedEnd={x:b.left+stripe,y:b.top+b.height/2};
 const distance=(p,q)=>Math.hypot(p.x-q.x,p.y-q.y),rect=r=>({left:r.left,top:r.top,right:r.right,bottom:r.bottom});
 const allText=[...document.querySelectorAll('[data-module-block] .module-name,[data-module-block] .module-amount>span')].filter(e=>e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true})).map(e=>{const range=document.createRange();range.selectNodeContents(e);return{...rect(range.getBoundingClientRect()),text:e.textContent};});
 // A masked or below-card path is allowed; retain geometric and visible counts separately.
 const intersects=new Set(),visible=new Set(),length=line.getTotalLength(),masked=!!line.closest('[mask]')||!!line.getAttribute('mask');
 // Mask resources have no painted client rect. Transform the real SVG cutout geometry instead.
 const maskRects=[...overlay.querySelectorAll('[data-block-mask]')].map(e=>{const x=Number(e.getAttribute('x')),y=Number(e.getAttribute('y')),a=new DOMPoint(x,y).matrixTransform(overlay.getScreenCTM()),b=new DOMPoint(x+Number(e.getAttribute('width')),y+Number(e.getAttribute('height'))).matrixTransform(overlay.getScreenCTM());return{left:a.x,top:a.y,right:b.x,bottom:b.y};});
 for(let n=0;n<=400;n++){
  const p=line.getPointAtLength(length*n/400),q=new DOMPoint(p.x,p.y).matrixTransform(line.getScreenCTM());
  for(const t of allText)if(q.x>=t.left&&q.x<=t.right&&q.y>=t.top&&q.y<=t.bottom){intersects.add(t.text);if(!masked||!maskRects.some(r=>q.x>=r.left&&q.x<=r.right&&q.y>=r.top&&q.y<=r.bottom))visible.add(t.text);}
 }
 const dot=overlay.querySelector('.hierarchy-endpoint'),tip=document.querySelector('.module-tooltip'),moving=document.querySelector('.graph-canvas').dataset.overlayMoving==='true';
 return{id,zoom:matrix.a,pan:{x:matrix.e,y:matrix.f},start:{x:start.x,y:start.y},end:{x:end.x,y:end.y},wantedStart,wantedEnd,startError:distance(start,wantedStart),endError:distance(end,wantedEnd),lineVisible:getComputedStyle(overlay).opacity!=='0',blockVisible:block.checkVisibility({checkOpacity:true,checkVisibilityCSS:true})&&document.querySelector('.graph-canvas').dataset.semantic==='full',rawTextIntersections:[...intersects],visibleTextIntersections:[...visible],masked,strokeScreen:parseFloat(getComputedStyle(line).strokeWidth)*matrix.a,dotRadiusScreen:dot?parseFloat(getComputedStyle(dot).r)*matrix.a:undefined,moving,tooltipWhileMoving:!!(moving&&tip&&getComputedStyle(tip).visibility!=='hidden'&&Number(getComputedStyle(tip).opacity)>0),stripe:rect(b)};
}
async function load(input){const ready=page.waitForEvent('load');await page.evaluate(input=>window.codeleader.layoutLoad(input),input).catch(e=>{if(!String(e).includes('destroyed'))throw e;});await ready;await page.waitForSelector('[data-view=main]');await page.waitForFunction(()=>document.querySelector('.graph-canvas')?.dataset.layoutBusy==='false');await page.evaluate(()=>document.addEventListener('pointermove',e=>window.__overlayPointer={x:e.clientX,y:e.clientY}));await page.waitForTimeout(1700);}
async function hover(){const block=page.locator('[data-module-block][data-frontend-count]:not([data-frontend-count="0"])').first();await block.hover();await page.waitForTimeout(230);return block.getAttribute('data-module-block');}
async function zoomTo(target){
 for(let i=0;i<35;i++){
  const zoom=await page.locator('.react-flow__viewport').evaluate(e=>new DOMMatrix(getComputedStyle(e).transform).a);
  if(Math.abs(zoom-target)<.0003)return;
  await page.mouse.wheel(0,Math.max(-100,Math.min(100,-Math.log2(target/zoom)/.002)));await page.waitForTimeout(180);
 }
 throw Error('Real wheel did not reach '+target);
}
async function pan(dx,dy){
 const point=await page.evaluate(({dx,dy})=>{const r=document.querySelector('.react-flow').getBoundingClientRect();for(const y of [.85,.75,.55,.35,.18])for(const x of [.05,.15,.35,.55,.75,.9]){const p={x:r.left+r.width*x,y:r.top+r.height*y},end={x:p.x+dx,y:p.y+dy};if(end.x<r.left||end.x>r.right||end.y<r.top||end.y>r.bottom)continue;const e=document.elementFromPoint(p.x,p.y);if(e?.classList.contains('react-flow__pane'))return p;}},{dx,dy});
 if(!point)throw Error('No empty pane point for a real drag');await page.mouse.move(point.x,point.y);await page.mouse.down();await page.mouse.move(point.x+dx,point.y+dy,{steps:12});await page.mouse.up();await page.waitForTimeout(230);
}
async function tooltip(label){const check=await page.evaluate(()=>{const tip=document.querySelector('.module-tooltip[data-open=true]'),r=tip?.getBoundingClientRect(),p=window.__overlayPointer,hit=p&&document.elementFromPoint(p.x,p.y)?.closest('[data-module-block]'),visible=tip&&getComputedStyle(tip).visibility!=='hidden'&&Number(getComputedStyle(tip).opacity)>.9;const headings=[...document.querySelectorAll('.module-group-heading,.hierarchy-application-heading,.hierarchy-frontend-heading')];return{visible,shown:visible?tip.dataset.moduleTooltip:null,underPointer:hit?.dataset.moduleBlock||null,headingIntersections:visible?headings.filter(e=>{const b=e.getBoundingClientRect();return r.left<b.right&&r.right>b.left&&r.top<b.bottom&&r.bottom>b.top;}).map(e=>e.textContent):[]};});tooltips.push({label,...check});}
try{
 for(let i=0;i<80;i++){try{browser=await chromium.connectOverCDP('http://127.0.0.1:'+port,{timeout:1000});break;}catch{await new Promise(r=>setTimeout(r,100));}}if(!browser)throw Error('Real window unavailable');page=browser.contexts()[0].pages()[0];page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});await page.bringToFront();
 await page.waitForSelector('[data-view=main]');await page.waitForFunction(()=>document.querySelector('.graph-canvas')?.dataset.layoutBusy==='false');
 for(const scale of layersOnly?[]:config.overlayScales){
  await load({mode:'static',project:config.overlayProject});const id=await hover();
  await zoomTo(scale);await page.waitForTimeout(230);
  for(const [n,delta]of [[0,[0,0]],[1,config.overlayPan]]){
   if(n)await pan(...delta);const value=await page.evaluate(measure,id);cases.push({scale,translation:delta,...value});await tooltip(scale+'-'+n);await page.screenshot({path:path.join(folder,`scale-${scale}-${n}.png`)});
  }
 }
 if(!layersOnly){
 // Ten consecutive frames while a real inward notch is being interpolated.
 await load({mode:'static',project:config.overlayProject});const id=await hover();
 await page.evaluate(source=>{window.__overlayMeasure=(0,eval)('('+source+')');},measure.toString());
 await page.evaluate(id=>{window.__overlayFrames=[];let moving=false;document.querySelector('.graph-canvas').addEventListener('wheel',()=>{if(moving)return;moving=true;const sample=()=>{window.__overlayFrames.push(window.__overlayMeasure(id));if(window.__overlayFrames.length<10)requestAnimationFrame(sample);};requestAnimationFrame(sample);},{capture:true,once:true});},id);
 await page.mouse.wheel(0,-100);await page.waitForTimeout(250);frames.push(...await page.evaluate(()=>window.__overlayFrames));await tooltip('smooth-wheel');await page.screenshot({path:path.join(folder,'smooth-wheel.png')});
 // Hover each visible module to exercise above/below placement against all titles.
 await load({mode:'static',project:config.overlayProject});
 for(const block of await page.locator('[data-module-block]').all()) {const r=await block.boundingBox();if(!r||r.y<45||r.y+r.height>930)continue;await block.hover();await page.waitForTimeout(230);await tooltip(await block.getAttribute('data-module-name'));if(Number(await block.getAttribute('data-frontend-count'))>0){hovers.push(await page.evaluate(measure,await block.getAttribute('data-module-block')));if(hovers.at(-1).rawTextIntersections.length)await page.screenshot({path:path.join(folder,'hover-'+hovers.length+'.png')});}}
 await page.screenshot({path:path.join(folder,'tooltip.png')});
 }
 if(phase==='after')for(const scene of ['guide','overview','runtime']){
  await load({mode:scene==='runtime'?'runtime':'static',project:config.overlayProject});
  if(scene==='runtime'){
   await openSavedRuntime(page);const history=JSON.parse(await fs.readFile(path.join(root,config.output,'runtime-inputs.json'),'utf8')),op=history.record.operations.find(o=>o.id===history.operationId);await page.getByRole('button',{name:'操作历史',exact:true}).click();await page.getByRole('button',{name:`操作 ${op.number} · ${op.label}`,exact:true}).click();const pause=page.getByLabel('暂停回放',{exact:true});if(await pause.count())await pause.click();await page.locator('.dock-segment[data-step="8"]').click({force:true});
  }else{await page.locator(`[data-view=${scene}]`).click();await page.waitForFunction(()=>document.querySelector('.graph-canvas')?.dataset.layoutBusy==='false');}
  await page.waitForTimeout(1600);const selector=scene==='guide'?'[data-module-block]':'.react-flow__node .card-accessible';
  const hoverPoint=await page.evaluate(selector=>{const area=document.querySelector('.react-flow').getBoundingClientRect();for(const node of document.querySelectorAll(selector)){const r=node.getBoundingClientRect(),left=Math.max(r.left,area.left),right=Math.min(r.right,area.right),top=Math.max(r.top,area.top),bottom=Math.min(r.bottom,area.bottom);if(right-left<8||bottom-top<8)continue;const point={x:(left+right)/2,y:(top+bottom)/2},hit=document.elementFromPoint(point.x,point.y);if(hit&&node.contains(hit))return point;}},selector);
  if(!hoverPoint)throw Error('No visible anchor in '+scene);await page.mouse.move(hoverPoint.x,hoverPoint.y);await page.waitForTimeout(230);
  const scan=()=>page.evaluate(()=>{const root=document.querySelector('.graph-canvas'),viewport=root.querySelector('.react-flow__viewport'),selectors=['.hierarchy-focus-band','.module-block[aria-pressed=true]','.lane-edge-visual','.lane-implementation-label','.runtime-step-bubble','.runtime-current-ring','.motion-packet-overlay','.motion-data-arrival','.runtime-position'];return{zoom:new DOMMatrix(getComputedStyle(viewport).transform).a,objects:selectors.map(selector=>{const nodes=[...root.querySelectorAll(selector)];return{selector,count:nodes.length,outside:nodes.filter(n=>!viewport.contains(n)).length};})};});
  const initial=await scan();await page.mouse.wheel(0,-100);await page.waitForTimeout(260);await pan(...config.overlayPan);const final=await scan();layers.push({scene,initial,final});await page.screenshot({path:path.join(folder,'layer-'+scene+'.png')});
 }
}finally{await page?.evaluate(()=>window.codeleader?.reviewClose()).catch(()=>{});await browser?.close().catch(()=>{});child.kill();await log.close();}
const violations=[];if(phase==='after'){
 for(const c of [...cases,...frames,...hovers])if(c.error||c.startError>2||c.endError>2)violations.push({type:'endpoint',case:c});
 for(const c of [...cases,...frames,...hovers])if(c.visibleTextIntersections?.length)violations.push({type:'line-text',case:c});
 for(const t of tooltips)if(t.headingIntersections.length||t.visible&&t.shown!==t.underPointer)violations.push({type:'tooltip',case:t});
 for(const c of [...cases,...frames])if(c.strokeScreen<1.499||c.strokeScreen>4.001||c.tooltipWhileMoving)violations.push({type:'screen-size-or-moving-tooltip',case:c});
 if(!layersOnly&&frames.length!==10)violations.push({type:'missing-frames'});if(errors.length)violations.push({type:'console',errors});
 for(const scene of layers)if(scene.final.objects.some(o=>o.outside))violations.push({type:'outside-viewport',scene});
}
await fs.writeFile(path.join(folder,'RESULT.json'),JSON.stringify({phase,cases,frames,tooltips,hovers,layers,errors,violations},null,2));
await fs.writeFile(path.join(folder,'ENDPOINTS.md'),'|缩放|平移|起点 x,y|终点 x,y|起点误差 px|终点误差 px|线显示|模块显示|\n|---|---|---|---|---|---|---|---|\n'+cases.map(c=>`|${c.zoom?.toFixed(3)}|${c.translation.join(',')}|${c.start?.x.toFixed(2)},${c.start?.y.toFixed(2)}|${c.end?.x.toFixed(2)},${c.end?.y.toFixed(2)}|${c.startError?.toFixed(3)}|${c.endError?.toFixed(3)}|${c.lineVisible}|${c.blockVisible}|`).join('\n'));
console.log(JSON.stringify({phase,cases:cases.length,frames:frames.length,maxStart:Math.max(...cases.map(c=>c.startError)),maxEnd:Math.max(...cases.map(c=>c.endError)),violations:violations.length,errors}));if(violations.length)process.exitCode=1;
