import {scanLayout} from './layout-probe.mjs';
export function installLaneProbe(captureName){
 const tasks=[],frames=[],start=performance.now();let active=true,captured=false;
 const observer=new PerformanceObserver(list=>tasks.push(...list.getEntries().map(e=>({start:e.startTime,duration:e.duration}))));observer.observe({type:'longtask',buffered:false});
 const tick=()=>{if(!active)return;const root=document.querySelector('.graph-canvas'),nodes=[...document.querySelectorAll('.dependency-lane-card')],skeletons=nodes.filter(n=>n.classList.contains('lane-skeleton')).length;if(skeletons&&captureName&&!captured){captured=true;void window.codeleader.capture(captureName+'/skeleton');}frames.push({at:performance.now()-start,skeletons,nodes:nodes.map(n=>({id:n.closest('[data-id]').dataset.id,transform:n.closest('[data-id]').style.transform})),busy:root?.dataset.layoutBusy});requestAnimationFrame(tick);};requestAnimationFrame(tick);
 window.__laneProbe={finish:()=>{active=false;observer.disconnect();return{tasks,frames,elapsed:performance.now()-start,maxLongTask:Math.max(0,...tasks.map(t=>t.duration)),workerMs:Number(document.querySelector('.graph-canvas')?.dataset.laneWorkerMs||0)};}};
}
export function laneMetrics(){
 const root=document.querySelector('.graph-canvas'),nodes=[...root.querySelectorAll('.react-flow__node')].map(n=>({id:n.dataset.id,transform:n.style.transform,name:n.querySelector('.lane-card-name')?.textContent,lane:n.querySelector('[data-lane-id]')?.dataset.laneId}));
 const edges=[...root.querySelectorAll('.react-flow__edge')].map(e=>({id:e.dataset.id,main:e.classList.contains('is-main'),common:e.classList.contains('is-common'),opacity:Number(getComputedStyle(e.querySelector('.react-flow__edge-path')).opacity),points:JSON.parse(e.querySelector('[data-route-points]')?.getAttribute('data-route-points')||'[]')}));
 const cross=(a,b)=>{const hits=new Set();for(let i=1;i<a.length;i++)for(let j=1;j<b.length;j++){const p=a[i-1],q=a[i],r=b[j-1],s=b[j],h=p.y===q.y,k=r.y===s.y;if(h===k)continue;const x=h?r.x:p.x,y=h?p.y:r.y;if(x>Math.min(p.x,q.x)+.01&&x<Math.max(p.x,q.x)-.01&&y>Math.min(r.y,s.y)+.01&&y<Math.max(r.y,s.y)-.01||x>Math.min(r.x,s.x)+.01&&x<Math.max(r.x,s.x)-.01&&y>Math.min(p.y,q.y)+.01&&y<Math.max(p.y,q.y)-.01)hits.add(x+':'+y);}return hits.size;};
 const crossings=list=>list.reduce((n,e,i)=>n+list.slice(i+1).reduce((n,b)=>n+cross(e.points,b.points),0),0);
 return{orientation:root.dataset.dependencyLanes,nodes,edges,bright:edges.filter(e=>e.opacity>=.8).length,drawn:edges.filter(e=>e.opacity>0).length,folded:edges.filter(e=>e.opacity===0).length,memberCrossings:crossings(edges),mainCrossings:crossings(edges.filter(e=>e.main&&!e.common)),maxBends:Math.max(0,...edges.map(e=>e.points.length-2))};
}
export async function verifyLaneInteractions(page,policy,{name,capture}){
 const before=await page.evaluate(laneMetrics);await page.evaluate(()=>window.__laneNodes=new Map([...document.querySelectorAll('.react-flow__node')].map(n=>[n.dataset.id,n])));
 const common=page.locator('.lane-common-chip').first();let hover;
 if(await common.count()){await common.hover();await page.waitForTimeout(160);hover=await page.evaluate(laneMetrics);hover.effectiveUnrelated=await page.evaluate(()=>[...document.querySelectorAll('.react-flow__node.lane-unrelated .card-accessible')].map(e=>{let opacity=1;for(let n=e;n;n=n.parentElement)opacity*=Number(getComputedStyle(n).opacity);return opacity;}));hover.layout=await page.evaluate(scanLayout,policy);await capture(name+'/common-hover');await page.mouse.move(5,50);}
 const folded=page.locator('.react-flow__node:has([data-lane-fold=true])').first();let expansion;
 if(await folded.count()){
  const version=await page.locator('.graph-canvas').getAttribute('data-layout-version');await folded.click();await page.waitForFunction(v=>document.querySelector('.graph-canvas')?.dataset.layoutVersion!==v&&document.querySelector('.graph-canvas')?.dataset.layoutBusy==='false',version);await page.waitForTimeout(250);
  const after=await page.evaluate(laneMetrics),recreated=await page.evaluate(()=>[...window.__laneNodes].filter(([id,n])=>document.querySelector(`[data-id="${CSS.escape(id)}"]`)&&(!n.isConnected)).length);
  expansion={before:before.nodes.length,after:after.nodes.length,recreated,moved:before.nodes.filter(n=>after.nodes.some(a=>a.id===n.id&&a.transform!==n.transform)),layout:await page.evaluate(scanLayout,policy)};await capture(name+'/expanded');
  const expandedVersion=await page.locator('.graph-canvas').getAttribute('data-layout-version');await folded.click();await page.waitForFunction(v=>document.querySelector('.graph-canvas')?.dataset.layoutVersion!==v&&document.querySelector('.graph-canvas')?.dataset.layoutBusy==='false',expandedVersion);await page.waitForTimeout(250);
 }
 const bottom=before.nodes.at(-1),target=bottom&&page.locator(`.react-flow__node[data-id="${bottom.id.replaceAll('\\','\\\\').replaceAll('"','\\"')}"]`);let persistence;
 if(target&&await target.count()){
  const box=await target.boundingBox(),version=await page.locator('.graph-canvas').getAttribute('data-layout-version');await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+18,box.y+box.height/2+18,{steps:5});await page.mouse.up();await page.waitForFunction(v=>document.querySelector('.graph-canvas')?.dataset.layoutVersion!==v&&document.querySelector('.graph-canvas')?.dataset.layoutBusy==='false',version);
  const dragged=(await page.evaluate(laneMetrics)).nodes.find(n=>n.id===bottom.id);await capture(name+'/dragged');await page.reload();await page.waitForSelector('[data-view=overview]');await page.locator('[data-view=overview]').click();await page.waitForFunction(()=>document.querySelector('.graph-canvas')?.dataset.layoutBusy==='false'&&document.querySelector('.dependency-lane-card'));await page.waitForTimeout(300);
  const reopened=await page.evaluate(laneMetrics),restored=reopened.nodes.find(n=>n.id===bottom.id);persistence={id:bottom.id,before:bottom.transform,dragged:dragged?.transform,reopened:restored?.transform,changed:bottom.transform!==dragged?.transform,passed:!!restored&&restored.transform===dragged?.transform,orientation:reopened.orientation};await capture(name+'/reopened');
  await page.evaluate(id=>{for(const key of Object.keys(localStorage))if(key.startsWith('codeleader.dependency-positions.'))try{if(JSON.parse(localStorage.getItem(key)).positions[id])localStorage.removeItem(key);}catch{}},bottom.id);
  await page.reload();await page.waitForSelector('[data-view=overview]');await page.locator('[data-view=overview]').click();await page.waitForFunction(()=>document.querySelector('.graph-canvas')?.dataset.layoutBusy==='false'&&document.querySelector('.dependency-lane-card'));await page.waitForTimeout(250);
 }
 const scopes=[];
 for(const label of ['整个项目','当前接口链路']){
  const button=page.locator('.dependency-scope button').filter({hasText:label==='当前接口链路'?/当前.*链路/:label});if(!await button.count())continue;
  await page.evaluate(()=>window.__laneNodes=new Map([...document.querySelectorAll('.react-flow__node')].map(n=>[n.dataset.id,{node:n,transform:n.style.transform}])));
  const version=await page.locator('.graph-canvas').getAttribute('data-layout-version');await page.locator('.dependency-scope').evaluate(e=>e.open=true);await button.click();await page.waitForFunction(v=>document.querySelector('.graph-canvas')?.dataset.layoutVersion!==v&&document.querySelector('.graph-canvas')?.dataset.layoutBusy==='false',version);await page.waitForTimeout(250);
  scopes.push({scope:label,...await page.evaluate(()=>{const shared=[...document.querySelectorAll('.react-flow__node')].filter(n=>window.__laneNodes.has(n.dataset.id));return{common:shared.length,recreated:shared.filter(n=>window.__laneNodes.get(n.dataset.id).node!==n).length,moved:shared.filter(n=>window.__laneNodes.get(n.dataset.id).transform!==n.style.transform).map(n=>n.dataset.id)};}),layout:await page.evaluate(scanLayout,policy)});await capture(name+'/'+(label==='整个项目'?'project-scope':'chain-scope'));
 }
 return{hover,expansion,persistence,scopes};
}
