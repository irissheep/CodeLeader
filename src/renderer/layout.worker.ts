import ELK from 'elkjs/lib/elk-api.js';
import engineURL from 'elkjs/lib/elk-worker.min.js?url';
import { cardSize, routeSnapshot, type Point } from './graph-geometry';
import type { GraphCard, GraphLink } from './graph-model';
import { placeExploration } from './exploration-graph';
import {mainPositions} from './runtime-layout';
import {dependencyPositions} from './dependency-layout';
import {adaptiveMainPositions} from './adaptive-layout';
import {hierarchyGuidePositions,hierarchyMainPositions} from './hierarchy-model';
import uiTokens from '../shared/ui-tokens';
import {dependencyLaneLayout,type LaneOrientation} from './dependency-lanes';
import {graphFor} from './graph-model';
import type {ProjectIndex,ViewState} from '../shared/model';
const elk=new ELK({workerFactory:()=>new Worker(engineURL)});
let newest=0;
let dependencyIndex:ProjectIndex|undefined;
self.onmessage=async({data}:{data:{kind?:string;requestId?:number;index?:ProjectIndex;view?:ViewState;id:number;cards:GraphCard[];links:GraphLink[];positions:Record<string,Point>;focus?:string;level:string;forceOrder?:boolean;runtimeColumn?:boolean;laneOrientation?:LaneOrientation}})=>{
  if(data.kind==='dependency-model'){
    try{if(data.index)dependencyIndex=data.index;if(!dependencyIndex)throw Error('项目内容尚未加载');const start=performance.now(),graph=graphFor(dependencyIndex,data.view!);self.postMessage({kind:data.kind,requestId:data.requestId,graph,modelMs:performance.now()-start});}catch(error){self.postMessage({kind:data.kind,requestId:data.requestId,error:String(error)});}return;
  }
  const {id,cards,links}=data;newest=id;
  try {
    if(data.level==='overview'&&cards.some(c=>c.dependencyLane)){
      const start=performance.now(),snapshot=dependencyLaneLayout(id,cards,links,data.positions,data.laneOrientation,skeleton=>{if(id===newest)self.postMessage({id,snapshot:skeleton,skeleton:true});});
      if(id===newest)self.postMessage({id,snapshot,workerMs:performance.now()-start});return;
    }
    const positions:Record<string,Point>={};
    if(cards.some(c=>c.inline||c.ownerId)){
      const snapshot=routeSnapshot(id,cards,links,placeExploration(cards,data.positions));
      if(id===newest)self.postMessage({id,snapshot});return;
    }
    if(data.level==='guide'&&cards.some(c=>c.hierarchy?.module)){
      Object.assign(positions,hierarchyGuidePositions(cards));
      const snapshot=routeSnapshot(id,cards,links,positions);if(id===newest)self.postMessage({id,snapshot});return;
    }else if(data.level==='main'){
      Object.assign(positions,cards.some(c=>c.hierarchy)?hierarchyMainPositions(cards,links):cards.some(c=>c.appearance)?adaptiveMainPositions(cards,links):mainPositions(cards,links));
    }else if(data.level==='function'&&cards.some(c=>c.serviceId&&c.summary)){
      const services=[...new Set(cards.map(c=>c.section||'当前应用'))].sort((a,b)=>Math.min(...cards.filter(c=>(c.section||'当前应用')===a).map(c=>c.lane||0))-Math.min(...cards.filter(c=>(c.section||'当前应用')===b).map(c=>c.lane||0)));
      let top=110;
      for(const service of services){const group=cards.filter(c=>(c.section||'当前应用')===service),min=Math.min(...group.map(c=>c.lane||0)),lanes=[...new Set(group.map(c=>c.lane||0))];let height=0;
       for(const lane of lanes){const members=group.filter(c=>(c.lane||0)===lane);members.forEach((c,i)=>{positions[c.id]={x:50+(lane-min)*300,y:top+i*180};height=Math.max(height,i*180+cardSize(c).height);});}top+=height+80;
      }
    }else if(data.level==='overview'){
      const initialX:Record<string,number>={};
      if(!cards.some(c=>data.positions[c.id])){
        const ordered=await elk.layout({id:'dependency',layoutOptions:{'elk.algorithm':'layered','elk.direction':'DOWN','elk.partitioning.activate':'true','elk.randomSeed':'42'},children:cards.map(c=>({id:c.id,...cardSize(c),layoutOptions:{'elk.partitioning.partition':String(c.dependency?.layer||0)}})),edges:links.map(e=>({id:e.id,sources:[e.source],targets:[e.target]}))});
        for(const node of ordered.children||[])initialX[node.id]=node.x||0;
      }
      Object.assign(positions,dependencyPositions(cards,links,data.positions,initialX));
    }else if(data.level==='function'){
      const lanes=[...new Set(cards.map(c=>c.lane||0))].sort((a,b)=>a-b);
      for(const lane of lanes){const members=cards.filter(c=>(c.lane||0)===lane);members.forEach((c,i)=>positions[c.id]={x:lane*380,y:(i-(members.length-1)/2)*190});}
    }else{
      const sections=[...new Set(cards.map(c=>c.section||'文件与类'))].sort((a,b)=>Number(a.startsWith('无已解析'))-Number(b.startsWith('无已解析'))||cards.filter(c=>c.section===b).length-cards.filter(c=>c.section===a).length);
      let top=70,left=50,rowHeight=0;
      for(const section of sections){
        const members=cards.filter(c=>(c.section||'文件与类')===section),ids=new Set(members.map(c=>c.id));
        const sectionTop=top;
        let height=0;
        if(section.startsWith('无已解析')||!links.some(e=>ids.has(e.source)&&ids.has(e.target))){
          const columns=data.level==='guide'?3:4,step=Math.max(...members.map(c=>cardSize(c).width))+54,row=Math.max(...members.map(c=>cardSize(c).height))+34;
          members.forEach((c,i)=>{const size=cardSize(c);positions[c.id]={x:50+(i%columns)*step,y:top+Math.floor(i/columns)*row};height=Math.max(height,positions[c.id].y-top+size.height);});
        }else{
          const graph=await elk.layout({id:'root',layoutOptions:{'elk.algorithm':'layered','elk.direction':'RIGHT','elk.edgeRouting':'ORTHOGONAL','elk.spacing.nodeNode':'36','elk.layered.spacing.nodeNodeBetweenLayers':'80','elk.layered.nodePlacement.strategy':'NETWORK_SIMPLEX','elk.layered.crossingMinimization.forceNodeModelOrder':String(!!data.forceOrder),'elk.randomSeed':'42','elk.padding':'[top=0,left=0,bottom=0,right=0]'},children:members.map(c=>({id:c.id,...cardSize(c)})),edges:links.filter(e=>ids.has(e.source)&&ids.has(e.target)).map(e=>({id:e.id,sources:[e.source],targets:[e.target]}))});
          const arranged=[...(graph.children||[])].sort((a,b)=>a.x!-b.x!||a.y!-b.y!);
          // Cyclic areas have no valid topological execution order. Compact their real members,
          // then route every directed relation on those actual positions instead of stretching a layered cycle.
          const compact=data.level==='overview'&&members.filter(c=>c.cycle).length>3;
          for(const [i,n] of arranged.entries())positions[n.id]=compact?{x:50+(i%4)*320,y:top+Math.floor(i/4)*196}:{x:n.x!+50,y:n.y!+top};
          height=Math.max(0,...arranged.map(n=>positions[n.id].y-top+n.height!));
        }
        const width=Math.max(0,...members.map(c=>positions[c.id].x+cardSize(c).width))-50;
        if(left>50&&left-50+width>1280){top+=rowHeight+90;left=50;rowHeight=0;}
        for(const card of members)positions[card.id]={x:positions[card.id].x+left-50,y:positions[card.id].y+top-sectionTop};
        left+=width+70;rowHeight=Math.max(rowHeight,height);
      }
    }
    if(id!==newest)return;
    const anchor=data.focus&&positions[data.focus],saved=data.focus&&data.positions[data.focus];
    const offset=anchor&&saved?{x:saved.x-anchor.x,y:saved.y-anchor.y}:{x:0,y:0};
    const placed:{x:number;y:number;width:number;height:number}[]=[],clearance=cards.some(c=>c.hierarchy)?uiTokens.hierarchy.groupGap:22;
    // Retained cards take precedence. New cards are moved clear; every edge is then rerouted.
    for(const card of [...cards].sort((a,b)=>Number(!!data.positions[b.id])-Number(!!data.positions[a.id]))){
      const size=cardSize(card),old=data.positions[card.id];let p=data.level==='main'&&card.kind==='resource'&&cards.some(c=>c.kind==='browser')?{x:positions[card.id].x+offset.x,y:positions[card.id].y+offset.y}:old||{x:positions[card.id].x+offset.x,y:positions[card.id].y+offset.y};
      if(!old||data.level==='main'&&card.kind==='resource')while(placed.some(r=>p.x<r.x+r.width+clearance&&p.x+size.width+clearance>r.x&&p.y<r.y+r.height+clearance&&p.y+size.height+clearance>r.y))p={x:p.x,y:p.y+size.height+38};
      positions[card.id]=p;placed.push({...p,...size});
    }
    const snapshot=routeSnapshot(id,data.cards,links,positions);
    if(id===newest)self.postMessage({id,snapshot});
  }catch(error){if(id===newest)self.postMessage({id,error:String(error)});}
};
