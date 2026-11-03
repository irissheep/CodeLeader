import {inspectCollisions} from './u11-collision.mjs';

// The observer has a fixed lifetime and removes its own rAF when sampling ends.
export async function beginSampling(page){
 await page.evaluate(({collision})=>{
  const inspect=(0,eval)(`(${collision})`),identity=new WeakMap(),samples=[];let serial=0,start;
  const idFor=e=>{if(!identity.has(e))identity.set(e,++serial);return identity.get(e);};
  const rect=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,opacity:Number(getComputedStyle(e).opacity)};};
  const distance=(point,r)=>{const dx=point.x<r.left?r.left-point.x:point.x>r.right?point.x-r.right:0,dy=point.y<r.top?r.top-point.y:point.y>r.bottom?point.y-r.bottom:0;return dx||dy?Math.hypot(dx,dy):Math.min(Math.abs(point.x-r.left),Math.abs(point.x-r.right),Math.abs(point.y-r.top),Math.abs(point.y-r.bottom));};
  window.__u11Done=false;window.__u11Samples=samples;
  const tick=now=>{
   if(start===undefined)start=now;const nodes={};
   for(const e of document.querySelectorAll('.react-flow__node[data-id],[data-module-block],[data-domain-id],[data-entry-id]')){
    const key=e.hasAttribute('data-id')?`card:${e.getAttribute('data-id')}`:e.hasAttribute('data-module-block')?`module:${e.getAttribute('data-module-block')}`:e.hasAttribute('data-domain-id')?`panel:${e.getAttribute('data-domain-id')}`:`row:${e.getAttribute('data-entry-id')}`;nodes[key]={...rect(e),identity:idFor(e)};
   }
   const edges=[];
   for(const edge of document.querySelectorAll('[data-continuity-source][data-continuity-target]')){
    const path=edge.querySelector('.react-flow__edge-path'),from=edge.getAttribute('data-continuity-source'),to=edge.getAttribute('data-continuity-target'),source=document.querySelector(`.react-flow__node[data-id="${CSS.escape(from)}"]`),target=document.querySelector(`.react-flow__node[data-id="${CSS.escape(to)}"]`);
    if(!(path instanceof SVGPathElement)||!source||!target){edges.push({from,to,unavailable:true});continue;}
    try{const matrix=path.getScreenCTM(),length=path.getTotalLength(),a=path.getPointAtLength(0),b=path.getPointAtLength(length);if(!matrix)throw Error('matrix');const first=new DOMPoint(a.x,a.y).matrixTransform(matrix),last=new DOMPoint(b.x,b.y).matrixTransform(matrix);edges.push({from,to,source:distance(first,source.getBoundingClientRect()),target:distance(last,target.getBoundingClientRect())});}catch{edges.push({from,to,unavailable:true});}
   }
   const collision=inspect();samples.push({time:now-start,nodes,edges,overlaps:collision.text.length});
   if(now-start<900)requestAnimationFrame(tick);else window.__u11Done=true;
  };requestAnimationFrame(tick);
 },{collision:inspectCollisions.toString()});
}
export async function finishSampling(page){
 await page.waitForFunction(()=>window.__u11Done,undefined,{timeout:10000});
 const frames=await page.evaluate(()=>window.__u11Samples),errors=[];
 if(frames.length<2)return{frames,errors:['没有足够的逐帧数据']};
 const first=frames[0],last=frames.at(-1),common=Object.keys(first.nodes).filter(id=>last.nodes[id]),durations=[];
 for(const id of common){const initial=first.nodes[id],end=last.nodes[id],total=Math.hypot(end.x-initial.x,end.y-initial.y),moving=[];
  for(let i=1;i<frames.length;i++){const previous=frames[i-1].nodes[id],current=frames[i].nodes[id];if(!current||!previous||current.identity!==initial.identity){errors.push(`${id}: 元素消失或重建`);break;}const step=Math.hypot(current.x-previous.x,current.y-previous.y);if(step>.5)moving.push(frames[i].time);if(total>2&&step>total*.45+1)errors.push(`${id}: 单帧位移过大`);}
  if(moving.length)durations.push(moving.at(-1)-moving[0]);
 }
 const collisions=frames.filter(frame=>frame.overlaps>0).length;if(collisions)errors.push(`${collisions} 帧存在文字相交`);
 const missingEdges=frames.reduce((n,frame)=>n+frame.edges.filter(e=>e.unavailable).length,0),farEdges=frames.reduce((n,frame)=>n+frame.edges.filter(e=>!e.unavailable&&(e.source>2||e.target>2)).length,0);
 if(missingEdges)errors.push(`${missingEdges} 条帧内连线无法定位端点`);if(farEdges)errors.push(`${farEdges} 条帧内连线端点偏离超过 2px`);
 const duration=durations.length?Math.max(...durations):0;if(duration<200||duration>450)errors.push(`位置变化持续 ${Math.round(duration)}ms，不在 200–450ms`);
 const intervals=frames.slice(1).map((f,i)=>f.time-frames[i].time).sort((a,b)=>a-b),p95=intervals[Math.floor((intervals.length-1)*.95)]||0;
 return{frames,errors,duration,p95,common:common.length,missingEdges,farEdges};
}
