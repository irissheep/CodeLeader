export function installZoomProbe(){
 let active,raf;const longTasks=[];
 new PerformanceObserver(list=>longTasks.push(...list.getEntries().map(t=>({start:t.startTime,duration:t.duration})))).observe({type:'longtask',buffered:true});
 const matrix=()=>{const e=document.querySelector('.graph-canvas .react-flow__viewport');return e?new DOMMatrixReadOnly(getComputedStyle(e).transform):new DOMMatrixReadOnly();};
 const wheel=e=>{if(!active||!e.target.closest?.('.graph-canvas .react-flow'))return;if(!active.events.length){const m=matrix();active.world={x:(active.anchor.x-active.area.x-m.e)/m.a,y:(active.anchor.y-active.area.y-m.f)/m.a};}active.events.push({time:performance.now()-active.start,deltaY:e.deltaY,deltaX:e.deltaX,mode:e.deltaMode,ctrl:e.ctrlKey,trusted:e.isTrusted});};
 document.addEventListener('wheel',wheel,{capture:true,passive:true});
 const api=window.__zoomStore.getState().panZoom;
 for(const name of ['setViewport','scaleTo','scaleBy','syncViewport']){const original=api[name];api[name]=function(...args){if(active)active.apiCalls.push({name,time:performance.now()-active.start,duration:args[1]?.duration||0});return original.apply(api,args);};}
 const graph=document.querySelector('.graph-canvas'),mutation=new MutationObserver(items=>{if(active)active.styleMutations+=items.length;});mutation.observe(graph,{attributes:true,attributeFilter:['style']});
 const frame=time=>{if(!active)return;const m=matrix(),graph=document.querySelector('.graph-canvas'),event=active.events.length-1;
  active.frames.push({time:time-active.start,zoom:m.a,x:m.e,y:m.f,event,semantic:graph.dataset.semantic,layout:graph.dataset.layoutDetail,lane:graph.dataset.laneDetail,zooming:graph.classList.contains('zooming')});raf=requestAnimationFrame(frame);
 };
 window.__zoomProbe={
  commit(detail){if(active){const clock=active.pendingClock;active.pendingClock=false;active.commits.push({time:performance.now()-active.start,event:active.events.length-1,clock,...detail});}},
  background(){if(active){active.pendingClock=true;active.clocks++;}},
  node(id){if(active)active.renders.push({time:performance.now()-active.start,event:active.events.length-1,id});},
  edge(id){if(active)active.edges.push({time:performance.now()-active.start,event:active.events.length-1,id});},
  tier(detail){if(active)active.tiers.push({time:performance.now()-active.start,...detail});},
  start(name,anchor){const m=matrix(),area=document.querySelector('.react-flow').getBoundingClientRect(),styles=[document.querySelector('.react-flow__viewport'),...document.querySelectorAll('.react-flow__node')].map(n=>{const s=getComputedStyle(n);return{element:n.className,transition:s.transitionProperty,duration:s.transitionDuration,shadow:s.boxShadow,backdrop:s.backdropFilter};});active={name,start:performance.now(),events:[],frames:[],commits:[],renders:[],edges:[],apiCalls:[],styleMutations:0,clocks:0,tiers:[],styles,nodes:new Map([...document.querySelectorAll('.react-flow__node')].map(n=>[n.dataset.id,n])),anchor,area:{x:area.x,y:area.y},world:{x:(anchor.x-area.x-m.e)/m.a,y:(anchor.y-area.y-m.f)/m.a}};raf=requestAnimationFrame(frame);},
  finish(){cancelAnimationFrame(raf);const a=active;active=undefined;const after=new Map([...document.querySelectorAll('.react-flow__node')].map(n=>[n.dataset.id,n]));return{...a,start:undefined,nodes:undefined,duration:performance.now()-a.start,identities:[...a.nodes].map(([id,n])=>({id,same:n===after.get(id),present:after.has(id)})),longTasks:longTasks.filter(t=>t.start>=a.start).map(t=>({...t,start:t.start-a.start}))};}
 };
}

export function zoomSummary(data){
 const gaps=data.frames.slice(1).map((f,i)=>f.time-data.frames[i].time),sorted=[...gaps].sort((a,b)=>a-b),percentile=p=>sorted[Math.min(sorted.length-1,Math.floor(sorted.length*p))]||0;
 const changes=data.frames.slice(1).map((f,i)=>Math.abs(f.zoom/data.frames[i].zoom-1)),commits=data.events.map((_,i)=>data.commits.filter(c=>c.event===i).length);
 const inputCommits=data.events.map((_,i)=>data.commits.filter(c=>c.event===i&&!c.clock).length);
 const drift=data.frames.filter(f=>f.event>=0).map(f=>Math.hypot(data.area.x+f.x+data.world.x*f.zoom-data.anchor.x,data.area.y+f.y+data.world.y*f.zoom-data.anchor.y));
 const switches=data.frames.flatMap((f,i)=>i&&f.semantic!==data.frames[i-1].semantic?[{time:f.time,event:f.event,from:data.frames[i-1].semantic,to:f.semantic}]:[]);
 return{name:data.name,requested:data.requested,received:data.events.length,fps:gaps.length?1000*gaps.length/gaps.reduce((a,b)=>a+b,0):0,p50:percentile(.5),p95:percentile(.95),maximum:Math.max(0,...gaps),longTasks:data.longTasks.length,commits:data.commits.length,clockCommits:data.commits.filter(c=>c.clock).length,commitsPerWheel:commits,maxCommitsPerWheel:Math.max(0,...commits),inputCommitsPerWheel:inputCommits,maxInputCommitsPerWheel:Math.max(0,...inputCommits),nodeRenders:data.renders.length,renderedNodes:[...new Set(data.renders.map(r=>r.id))],edgeRenders:data.edges.length,recreated:data.identities.filter(n=>n.present&&!n.same).length,styleMutations:data.styleMutations,timedViewportCalls:data.apiCalls.filter(c=>c.duration>0).length,maxZoomDeltaPercent:100*Math.max(0,...changes),anchorDrift:Math.max(0,...drift),switches,initialZoom:data.frames[0]?.zoom,finalZoom:data.frames.at(-1)?.zoom};
}
