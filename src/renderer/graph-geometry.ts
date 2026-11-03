import type { GraphCard, GraphLink } from './graph-model';
import { interfaceRowHeight } from './entry-geometry';
import dependencyPolicy from '../shared/dependency-policy.json';
import backbonePolicy from '../shared/backbone-policy.json';
import {visibleCapabilities,unitNoticeHeight,capabilityHeight} from './backbone-model';
import {look} from './adaptive-look';
import {pathCrossings,pathOverlap,sharedDependencyNodes} from './dependency-routing';
import tokens from '../shared/ui-tokens';
import {resourceWidth} from './layout-metrics';
export type Point={x:number;y:number};
export type Rect=Point&{width:number;height:number};
export interface Port extends Point {id:string;type:'source'|'target';side:'left'|'right'|'top'|'bottom'}
export interface LayoutNode extends Rect {id:string;ports:Port[]}
export interface LayoutEdge {id:string;sourcePort:string;targetPort:string;points:Point[];label:Point;labelWidth:number;feedback:boolean;labelVisible?:boolean;bundle?:{id:string;members:string[];users:number;leader:boolean}}
export interface LayoutRegion extends Rect {id:string;label:string}
export interface LayoutSnapshot {version:number;nodes:LayoutNode[];edges:LayoutEdge[];regions:LayoutRegion[];junctions?:Point[]}
export function cardSize(card:GraphCard){
 const size=baseCardSize(card),scale=card.appearance?.scale||1;
 return{width:size.width*scale,height:size.height*scale};
}
function baseCardSize(card:GraphCard){
 if(card.dependencyLane&&card.canvasSize)return card.canvasSize;
 if(card.appearance?.tiles&&!card.inline)return{width:460,height:82+Math.min(Math.ceil((card.capabilities?.length||0)/look.tileColumns),look.tileMaxRows)*look.tileStep+20+unitNoticeHeight(card)};
 if(card.dependency)return{width:dependencyPolicy.thresholds.cardWidth.value,height:dependencyPolicy.thresholds.cardHeight.value};
 if(card.canvasSize)return card.canvasSize;
 if(card.frontend||card.foldedCards)return{width:card.frontend?backbonePolicy.thresholds.frontendWidth.value:460,height:184+(card.backendChoice?48:0)+(card.explanation?28:0)+(card.compact===false?backbonePolicy.thresholds.detailsHeight.value:0)};
 if(card.external)return{width:backbonePolicy.thresholds.externalWidth.value,height:94};
 if(card.capabilities&&!card.unit){const major=card.capabilities.filter(c=>!c.auxiliary);return{width:460,height:82+Math.ceil((card.compact===false?card.capabilities.length:Math.min(major.length,6))/2)*52+(card.capabilities.some(c=>c.auxiliary)||major.length>6?40:0)};}
 if(card.capabilities){const shown=visibleCapabilities(card);return{width:460,height:82+capabilityHeight(card)+(shown.length<card.capabilities.length||card.compact===false?40:0)+unitNoticeHeight(card)};}
 if(card.kind==='resource'&&!card.section)return{width:resourceWidth(card.name,card.summary),height:tokens.layout.resourceHeight};
 if(card.kind==='entry-group')return{width:344,height:card.appearance?.density==='compact'?96:tokens.layout.guideHeading+Math.min(tokens.layout.guideRows,card.entries?.length||0)*interfaceRowHeight};
 return {width:card.kind==='file'||card.kind==='type'?290:236,height:card.compact?96:card.kind==='file'||card.kind==='type'?124+(card.rows?.length||0)*32:142+(card.route?24:0)};
}
export function segmentHits(a:Point,b:Point,r:Rect,margin=0){
  const l=r.x-margin,t=r.y-margin,rr=r.x+r.width+margin,bb=r.y+r.height+margin;
  if(Math.abs(a.x-b.x)<0.01)return a.x>l+0.01&&a.x<rr-0.01&&Math.max(a.y,b.y)>t+0.01&&Math.min(a.y,b.y)<bb-0.01;
  if(Math.abs(a.y-b.y)<0.01)return a.y>t+0.01&&a.y<bb-0.01&&Math.max(a.x,b.x)>l+0.01&&Math.min(a.x,b.x)<rr-0.01;
  return true;
}
function simplify(points:Point[]){
  const out:Point[]=[];
  for(const p of points){if(out.length&&out.at(-1)!.x===p.x&&out.at(-1)!.y===p.y)continue;
    while(out.length>1){const a=out.at(-2)!,b=out.at(-1)!;if((a.x===b.x&&b.x===p.x)||(a.y===b.y&&b.y===p.y))out.pop();else break;}
    out.push(p);
  }return out;
}
// A rectilinear visibility grid routes around the actual card rectangles, including restored/dragged positions.
// Direction is part of the search state, so a bend has a cost rather than being added after routing.
type Segment={a:Point;b:Point};
function occupation(a:Point,b:Point,occupied:Segment[],crossingCost?:number){
 let cost=0;
 for(const s of occupied){const horizontal=a.y===b.y,otherHorizontal=s.a.y===s.b.y;
  if(horizontal===otherHorizontal){const gap=Math.abs(horizontal?a.y-s.a.y:a.x-s.a.x),overlap=Math.min(Math.max(horizontal?a.x:a.y,horizontal?b.x:b.y),Math.max(horizontal?s.a.x:s.a.y,horizontal?s.b.x:s.b.y))-Math.max(Math.min(horizontal?a.x:a.y,horizontal?b.x:b.y),Math.min(horizontal?s.a.x:s.a.y,horizontal?s.b.x:s.b.y));
   if(overlap>0&&gap<14)cost+=overlap*(14-gap)*3;
  }else{const x=horizontal?s.a.x:a.x,y=horizontal?a.y:s.a.y;
   // A search step ending exactly on another channel still crosses it. Count
   // that grid junction once (half-open), rather than giving it a free pass.
   const coordinate=horizontal?x:y,start=horizontal?a.x:a.y,end=horizontal?b.x:b.y;
   const crossesCandidate=(crossingCost===undefined?coordinate>Math.min(start,end):coordinate>=Math.min(start,end))&&coordinate<Math.max(start,end);
   const crossesOther=horizontal?y>Math.min(s.a.y,s.b.y)&&y<Math.max(s.a.y,s.b.y):x>Math.min(s.a.x,s.b.x)&&x<Math.max(s.a.x,s.b.x);
   if(crossesCandidate&&crossesOther)cost+=crossingCost??32;
  }
 }return cost;
}
function orthogonal(start:Point,end:Point,rects:Rect[],clearance:number,occupied:Segment[],crossingCost?:number):Point[]{
  const clear=(a:Point,b:Point)=>!rects.some(r=>segmentHits(a,b,r,clearance));
  for(const bend of [{x:end.x,y:start.y},{x:start.x,y:end.y}])if(clear(start,bend)&&clear(bend,end)&&!occupation(start,bend,occupied,crossingCost)&&!occupation(bend,end,occupied,crossingCost))return simplify([start,bend,end]);
  const xs=[...new Set([start.x,end.x,...rects.flatMap(r=>[r.x-clearance,r.x+r.width+clearance]),...occupied.filter(s=>s.a.x===s.b.x).flatMap(s=>[s.a.x-14,s.a.x+14])])].sort((a,b)=>a-b);
  const ys=[...new Set([start.y,end.y,...rects.flatMap(r=>[r.y-clearance,r.y+r.height+clearance]),...occupied.filter(s=>s.a.y===s.b.y).flatMap(s=>[s.a.y-14,s.a.y+14])])].sort((a,b)=>a-b);
  const width=xs.length,total=width*ys.length;
  const point=(id:number)=>({x:xs[id%width],y:ys[Math.floor(id/width)]});
  const source=ys.indexOf(start.y)*width+xs.indexOf(start.x),target=ys.indexOf(end.y)*width+xs.indexOf(end.x);
  const costs=new Float64Array(total*2).fill(Infinity),parent=new Int32Array(total*2).fill(-1);
  const heap:{id:number;cost:number;score:number}[]=[];
  const push=(entry:typeof heap[number])=>{heap.push(entry);let i=heap.length-1;while(i){const p=(i-1)>>1;if(heap[p].score<=entry.score)break;heap[i]=heap[p];i=p;}heap[i]=entry;};
  const pop=()=>{const first=heap[0],last=heap.pop()!;if(heap.length){let i=0;while(i*2+1<heap.length){let c=i*2+1;if(c+1<heap.length&&heap[c+1].score<heap[c].score)c++;if(heap[c].score>=last.score)break;heap[i]=heap[c];i=c;}heap[i]=last;}return first;};
  const heuristic=(p:Point)=>Math.abs(p.x-end.x)+Math.abs(p.y-end.y);
  for(const dir of [0,1]){costs[source*2+dir]=0;push({id:source*2+dir,cost:0,score:heuristic(start)});}
  let found=-1;
  while(heap.length){
    const state=pop();if(state.cost!==costs[state.id])continue;
    const cell=state.id>>1,dir=state.id%2;if(cell===target){found=state.id;break;}
    const p=point(cell),x=cell%width,y=Math.floor(cell/width);
    const neighbors:[number,number][]=[];
    if(x)neighbors.push([cell-1,0]);if(x+1<width)neighbors.push([cell+1,0]);if(y)neighbors.push([cell-width,1]);if(y+1<ys.length)neighbors.push([cell+width,1]);
    for(const [next,axis] of neighbors){const q=point(next);if(!clear(p,q))continue;
      const cost=state.cost+Math.abs(p.x-q.x)+Math.abs(p.y-q.y)+(dir!==axis?24:0)+occupation(p,q,occupied,crossingCost),id=next*2+axis;
      if(cost<costs[id]){costs[id]=cost;parent[id]=state.id;push({id,cost,score:cost+heuristic(q)});}
    }
  }
  if(found<0)throw new Error('卡片互相遮挡，无法生成有效正交路由；请分开重叠卡片或整理布局。');
  const points:Point[]=[];for(let id=found;id>=0;id=parent[id])points.push(point(id>>1));
  return simplify(points.reverse());
}
export function routeSnapshot(version:number,cards:GraphCard[],links:GraphLink[],positions:Record<string,Point>):LayoutSnapshot{
  const nodes:LayoutNode[]=cards.map(c=>({id:c.id,...positions[c.id],...cardSize(c),ports:[]}));
  const byId=new Map(nodes.map(n=>[n.id,n]));
  const shared=sharedDependencyNodes(cards,links),bundleTargets=new Set([...shared].filter(id=>links.filter(l=>l.target===id).length>1));
  const detailedDependencies=cards.some(c=>c.dependency&&c.kind!=='group');
  const obstacles=nodes.flatMap(n=>{const c=cards.find(c=>c.id===n.id)!;if(c.kind!=='service'||!cards.some(k=>k.ownerId===c.id))return[n];
    const top=c.inline?.top||82+Math.ceil((c.capabilities?.length||0)/2)*52;
    return[{...n,width:460,height:top},...(c.inline?[{...n,y:n.y+top+c.inline.height,width:460,height:n.height-top-c.inline.height}]:[])];
  });
  const assignments=new Map<string,{node:LayoutNode;side:Port['side'];type:'source'|'target';id:string}[]>();
  const pairs=links.map(link=>{
    const a=byId.get(link.source)!,b=byId.get(link.target)!;
    const dependency=cards.some(c=>c.id===a.id&&c.dependency),short=dependency&&cards.some(c=>c.appearance);
    const sourceCard=cards.find(c=>c.id===a.id),targetCard=cards.find(c=>c.id===b.id),flowOwner=sourceCard?.ownerId&&cards.find(c=>c.id===sourceCard.ownerId&&c.explorationFlowOrigin),sameOwner=!!flowOwner&&sourceCard?.ownerId===targetCard?.ownerId;
    const methodResource=!!flowOwner&&targetCard?.kind==='resource',vertical=short||methodResource||link.type==='DATA'||sourceCard?.vertical,forward=vertical?a.y+a.height/2<=b.y+b.height/2:a.x+a.width/2<=b.x+b.width/2,loop=a===b;
    const sameRow=dependency&&Math.abs(a.y-b.y)<1;
    const sameColumn=sameOwner&&Math.abs(a.x-b.x)<1;
    // A sibling directly below can block a resource edge's bottom port. Choose a
    // clear side before routing instead of failing the whole scene.
    const resourcePort=methodResource?(['bottom','right','left','top'] as const).find(side=>{const distance=11,x=side==='left'?a.x-distance:side==='right'?a.x+a.width+distance:a.x+a.width/2,y=side==='top'?a.y-distance:side==='bottom'?a.y+a.height+distance:a.y+a.height/2;return !obstacles.some(n=>n.id!==a.id&&x>n.x-10&&x<n.x+n.width+10&&y>n.y-10&&y<n.y+n.height+10);}):undefined;
    const source={node:a,side:(dependency?(sameRow?(a.x<b.x?'right':'left'):forward?'bottom':'top'):sameOwner?(loop?'right':sameColumn?(a.y<b.y?'bottom':'top'):(a.x<b.x?'right':'left')):resourcePort|| (vertical?'bottom':'right')) as Port['side'],type:'source' as const,id:`${link.id}:source`};
    const target={node:b,side:(dependency?(sameRow?(a.x<b.x?'left':'right'):forward?'top':'bottom'):sameOwner?(loop?'top':sameColumn?(a.y<b.y?'top':'bottom'):(a.x<b.x?'left':'right')):vertical?'top':'left') as Port['side'],type:'target' as const,id:`${link.id}:target`};
    for(const port of [source,target]){const key=`${port.node.id}:${port.side}`;assignments.set(key,[...(assignments.get(key)||[]),port]);}
    return {link,source,target,feedback:link.feedback??(loop||!forward)};
  });
  for(const ports of assignments.values()){
    ports.sort((a,b)=>{if(cards.find(c=>c.id===a.node.id)?.dependency){const other=(port:typeof a)=>{const pair=pairs.find(p=>p.source.id===port.id||p.target.id===port.id)!;return pair.source.id===port.id?pair.target.node:pair.source.node;};return other(a).x-other(b).x||other(a).y-other(b).y||a.id.localeCompare(b.id);}return a.id.localeCompare(b.id);});
    ports.forEach(p=>{const pair=pairs.find(pair=>pair.source.id===p.id||pair.target.id===p.id),from=pair&&cards.find(c=>c.id===pair.link.source),to=pair&&cards.find(c=>c.id===pair.link.target),serviceEntrance=p.type==='target'&&p.side==='left'&&!!from?.frontend&&!!to?.hierarchy?.groups&&pair?.link.type==='HTTP';p.node.ports.push({id:p.id,type:p.type,side:p.side,x:p.side==='left'?0:p.side==='right'?p.node.width:p.node.width/2,y:p.side==='top'?0:p.side==='bottom'?p.node.height:serviceEntrance?Math.min(p.node.height/2,tokens.hierarchy.applicationHeader):p.node.height/2});});
  }
  pairs.sort((a,b)=>cards.some(c=>c.dependency)?Math.abs(a.source.node.y-a.target.node.y)-Math.abs(b.source.node.y-b.target.node.y)||Math.abs(a.source.node.x-a.target.node.x)-Math.abs(b.source.node.x-b.target.node.x)||a.link.id.localeCompare(b.link.id):a.link.id.localeCompare(b.link.id));const displayLinks=pairs.map(p=>p.link),occupied:Segment[]=[];
  type RouteChoice={points:Point[];s:Pick<Port,'side'|'x'|'y'>;t:Pick<Port,'side'|'x'|'y'>;length:number};
  const choices=new Map<string,RouteChoice[]>();
  const edges:LayoutEdge[]=pairs.map(({link,source,target,feedback})=>{
    const s=source.node.ports.find(p=>p.id===source.id)!,t=target.node.ports.find(p=>p.id===target.id)!;
    const start={x:source.node.x+s.x,y:source.node.y+s.y},end={x:target.node.x+t.x,y:target.node.y+t.y};
    const sourceOwner=cards.find(c=>c.id===link.source)?.ownerId,targetOwner=cards.find(c=>c.id===link.target)?.ownerId;
    const clearance=sourceOwner&&sourceOwner===targetOwner&&cards.some(c=>c.id===sourceOwner&&c.explorationFlowOrigin)?4:10;
    const offset=(p:Point,side:Port['side'],own:LayoutNode,portId:string)=>{
      const peers=assignments.get(`${own.id}:${side}`)!,escape=cards.some(c=>c.appearance&&c.dependency)?look.routeEscape:24+peers.findIndex(p=>p.id===portId)*14;
      for(let distance=Math.max(escape,clearance+1);distance>=clearance+1;distance--){const point={x:p.x+(side==='left'?-distance:side==='right'?distance:0),y:p.y+(side==='top'?-distance:side==='bottom'?distance:0)};
        if(!obstacles.some(n=>n.id!==own.id&&point.x>n.x-clearance&&point.x<n.x+n.width+clearance&&point.y>n.y-clearance&&point.y<n.y+n.height+clearance))return point;
      }throw new Error('连接口附近没有安全路由空间：'+own.id+' / '+side);
    };
    const a=offset(start,s.side,source.node,s.id),b=offset(end,t.side,target.node,t.id);
    let points=simplify([start,...orthogonal(a,b,obstacles,clearance,cards.some(c=>c.id===source.node.id&&c.dependency)?[]:occupied,link.id.startsWith('dependency:')?dependencyPolicy.thresholds.crossingCost.value:undefined),end]);
    if(cards.some(c=>c.dependency)){
      const length=(points:Point[])=>points.slice(1).reduce((sum,p,i)=>sum+Math.hypot(p.x-points[i].x,p.y-points[i].y),0);
      const crosses=(path:Point[])=>path.slice(1).reduce((count,b,i)=>{const a=path[i],horizontal=a.y===b.y;return count+occupied.filter(edge=>{if(horizontal===(edge.a.y===edge.b.y))return false;const x=horizontal?edge.a.x:a.x,y=horizontal?a.y:edge.a.y;return x>Math.min(a.x,b.x)&&x<Math.max(a.x,b.x)&&y>Math.min(edge.a.y,edge.b.y)&&y<Math.max(edge.a.y,edge.b.y)||y>Math.min(a.y,b.y)&&y<Math.max(a.y,b.y)&&x>Math.min(edge.a.x,edge.b.x)&&x<Math.max(edge.a.x,edge.b.x);}).length;},0);
      const port=(node:LayoutNode,side:Port['side'])=>{
        const vertical=side==='left'||side==='right',peers=links.filter(l=>l.source===node.id||l.target===node.id).sort((a,b)=>{const other=(l:GraphLink)=>byId.get(l.source===node.id?l.target:l.source)!;return(vertical?other(a).y-other(b).y:other(a).x-other(b).x)||a.id.localeCompare(b.id);});
        const span=(vertical?node.height:node.width)/2-look.routeEscape,offset=bundleTargets.has(node.id)&&link.target===node.id?0:Math.max(-span,Math.min(span,(peers.findIndex(l=>l.id===link.id)-(peers.length-1)/2)*dependencyPolicy.thresholds.channelGap.value));
        return{side,x:side==='left'?0:side==='right'?node.width:node.width/2+offset,y:side==='top'?0:side==='bottom'?node.height:node.height/2+offset};
      };
      const alternatives:{points:Point[];s:ReturnType<typeof port>;t:ReturnType<typeof port>;length:number;crossings:number}[]=[];
      const sides:Port['side'][]=['top','bottom','left','right'];
      const pairs:[Port['side'],Port['side']][]=sides.flatMap(a=>sides.map(b=>[a,b] as [Port['side'],Port['side']]));
      for(const [sourceSide,targetSide]of pairs){
          if(bundleTargets.has(target.node.id)&&targetSide!==(source.node.x<target.node.x?'left':'right'))continue;
          const sp=port(source.node,sourceSide),tp=port(target.node,targetSide),p={x:source.node.x+sp.x,y:source.node.y+sp.y},q={x:target.node.x+tp.x,y:target.node.y+tp.y};
          const escape=(p:Point,side:Port['side'])=>({x:p.x+(side==='left'?-look.routeEscape:side==='right'?look.routeEscape:0),y:p.y+(side==='top'?-look.routeEscape:side==='bottom'?look.routeEscape:0)}),aa=escape(p,sourceSide),bb=escape(q,targetSide);
          if(obstacles.some(r=>r.id!==source.node.id&&segmentHits(p,aa,r,clearance)||r.id!==target.node.id&&segmentHits(bb,q,r,clearance)))continue;
          try{const candidate=simplify([p,...orthogonal(aa,bb,obstacles,clearance,[]),q]),size=length(candidate);if(size<=Math.hypot(q.x-p.x,q.y-p.y)*look.maxRouteRatio)alternatives.push({points:candidate,s:sp,t:tp,length:size,crossings:crosses(candidate)});}catch{/* A blocked alternative cannot replace an existing safe route. */}
      }
      const best=alternatives.sort((a,b)=>a.crossings-b.crossings||a.length-b.length)[0];
      if(best){points=best.points;Object.assign(s,best.s);Object.assign(t,best.t);}
      for(const choice of detailedDependencies?[...alternatives]:[])for(let i=1;i<choice.points.length-2;i++)for(const offset of [-dependencyPolicy.thresholds.channelGap.value,dependencyPolicy.thresholds.channelGap.value]){
        const candidate=choice.points.map(p=>({...p})),horizontal=candidate[i].y===candidate[i+1].y;
        if(horizontal){candidate[i].y+=offset;candidate[i+1].y+=offset;}else{candidate[i].x+=offset;candidate[i+1].x+=offset;}
        const size=length(candidate),first=candidate[0],last=candidate.at(-1)!;
        if(size>Math.hypot(first.x-last.x,first.y-last.y)*look.maxRouteRatio||candidate.some((p,k)=>k>0&&obstacles.some(r=>segmentHits(candidate[k-1],p,r))))continue;
        alternatives.push({...choice,points:simplify(candidate),length:size});
      }
      choices.set(link.id,alternatives);
    }
    for(let k=1;k<points.length;k++)if(Math.abs(points[k].x-points[k-1].x)+Math.abs(points[k].y-points[k-1].y)>48)occupied.push({a:points[k-1],b:points[k]});
    // Keep labels on a horizontal channel, reserving their actual rendered dimensions.
    let longest=-1,label={x:start.x,y:start.y},labelWidth=Math.max(64,link.label.length*12+20);
    for(let j=0;j<points.length-1;j++){const p=points[j],q=points[j+1];const length=Math.abs(q.x-p.x);if(p.y===q.y&&length>longest){longest=length;label={x:(p.x+q.x)/2,y:p.y};}}
    labelWidth=Math.min(labelWidth,Math.max(40,longest-8));
    return {id:link.id,sourcePort:s.id,targetPort:t.id,points,label,labelWidth,feedback};
  });
  // Resolve route choices together: a later edge can otherwise cross an earlier
  // short route even when that earlier edge has an equally short clear channel.
  for(let pass=0;pass<(detailedDependencies?dependencyPolicy.thresholds.routePasses.value:0);pass++){
    let improved=false;
    for(const edge of edges){
      const candidates=choices.get(edge.id);if(!candidates?.length)continue;
      const target=pairs.find(p=>p.link.id===edge.id)!.link.target;
      const cost=(points:Point[])=>edges.reduce((n,other)=>{if(other===edge)return n;const peer=pairs.find(p=>p.link.id===other.id)!.link;return n+pathCrossings(points,other.points)+(bundleTargets.has(target)&&peer.target===target?0:pathOverlap(points,other.points)/dependencyPolicy.thresholds.channelGap.value);},0);
      const old=cost(edge.points);let best:RouteChoice|undefined,bestCost=old;
      for(const candidate of candidates){const value=cost(candidate.points);if(value<bestCost){best=candidate;bestCost=value;}}
      if(!best)continue;
      edge.points=best.points;
      const pair=pairs.find(p=>p.link.id===edge.id)!;
      Object.assign(pair.source.node.ports.find(p=>p.id===edge.sourcePort)!,best.s);
      Object.assign(pair.target.node.ports.find(p=>p.id===edge.targetPort)!,best.t);
      improved=true;
    }
    if(!improved)break;
  }
  for(const target of bundleTargets){
    const members=links.filter(l=>l.target===target).map(l=>l.id).sort(),users=new Set(links.filter(l=>l.target===target).map(l=>l.source)).size;
    for(const edge of edges.filter(e=>members.includes(e.id)))edge.bundle={id:'dependency:bundle:'+target,members,users,leader:edge.id===members[0]};
  }
  const labels:Rect[]=[];
  const overlap=(a:Rect,b:Rect)=>a.x<b.x+b.width+4&&a.x+a.width+4>b.x&&a.y<b.y+b.height+4&&a.y+a.height+4>b.y;
  const order=edges.map((edge,i)=>({edge,i})).sort((a,b)=>Number(['HTTP','DATA','READS','WRITES'].includes(displayLinks[b.i].type))-Number(['HTTP','DATA','READS','WRITES'].includes(displayLinks[a.i].type)));
  for(const {edge,i} of order){
    const desired=Math.max(64,(displayLinks[i].label.length+(displayLinks[i].conditional&&!displayLinks[i].optional?6:0))*12+20),candidates:{point:Point;width:number}[]=[];
    for(let j=1;j<edge.points.length;j++){const a=edge.points[j-1],b=edge.points[j],length=Math.abs(a.x-b.x)+Math.abs(a.y-b.y);if(length<30)continue;
      for(const ratio of [.5,.3,.7]){const width=desired;if(a.y===b.y&&length<width+8)continue;candidates.push({point:{x:a.x+(b.x-a.x)*ratio,y:a.y+(b.y-a.y)*ratio},width});}
    }
    const chosen=candidates.find(c=>{const box={x:c.point.x-c.width/2,y:c.point.y-11,width:c.width,height:22};return ![...obstacles,...labels].some(r=>overlap(box,r))&&!edges.some(other=>other!==edge&&other.points.some((p,k)=>k>0&&segmentHits(other.points[k-1],p,box,2)));});
    edge.labelVisible=!!chosen;if(chosen){edge.label=chosen.point;edge.labelWidth=chosen.width;labels.push({x:chosen.point.x-chosen.width/2,y:chosen.point.y-11,width:chosen.width,height:22});}
  }
  const regions:LayoutRegion[]=[];
  const sections=[...new Set(cards.map(c=>c.section).filter((s):s is string=>!!s))];
  for(const section of sections){const members=cards.filter(c=>c.section===section).map(c=>byId.get(c.id)!);const x=Math.min(...members.map(n=>n.x))-22,y=Math.min(...members.map(n=>n.y))-46;
    regions.push({id:section,label:section,x,y,width:Math.max(...members.map(n=>n.x+n.width))-x+22,height:Math.max(...members.map(n=>n.y+n.height))-y+22});
  }
  const junctions:Point[]=[];
  for(const edge of edges){const p=edge.points[1],start=edge.points[0];if(!p)continue;for(const other of edges){if(other===edge||other.points[0].x!==start.x||other.points[0].y!==start.y)continue;const q=other.points[1];if(!q)continue;if((start.x===p.x&&start.x===q.x&&p.y>Math.min(start.y,q.y)&&p.y<Math.max(start.y,q.y)||start.y===p.y&&start.y===q.y&&p.x>Math.min(start.x,q.x)&&p.x<Math.max(start.x,q.x))&&!junctions.some(j=>j.x===p.x&&j.y===p.y))junctions.push(p);}}
  return {version,nodes,edges,regions,junctions};
}
export function nearestEdges(snapshot:LayoutSnapshot,point:Point,tolerance=12){
 const ranked=snapshot.edges.map(edge=>({id:edge.id,distance:Math.min(...edge.points.slice(1).map((b,i)=>{const a=edge.points[i],x=Math.max(Math.min(a.x,b.x),Math.min(Math.max(a.x,b.x),point.x)),y=Math.max(Math.min(a.y,b.y),Math.min(Math.max(a.y,b.y),point.y));return Math.hypot(point.x-x,point.y-y);} ))})).filter(e=>e.distance<=tolerance).sort((a,b)=>a.distance-b.distance);
 return ranked.filter(e=>e.distance-ranked[0].distance<2).map(e=>e.id);
}
export function roundedPath(points:Point[],radius=7){
  if(!points.length)return '';
  let path=`M${points[0].x},${points[0].y}`;
  for(let i=1;i<points.length-1;i++){
    const a=points[i-1],b=points[i],c=points[i+1];const ab=Math.hypot(b.x-a.x,b.y-a.y),bc=Math.hypot(c.x-b.x,c.y-b.y),r=Math.min(radius,ab/2,bc/2);
    if(!ab||!bc)continue;
    path+=`L${b.x+(a.x-b.x)*r/ab},${b.y+(a.y-b.y)*r/ab}Q${b.x},${b.y} ${b.x+(c.x-b.x)*r/bc},${b.y+(c.y-b.y)*r/bc}`;
  }
  return path+`L${points.at(-1)!.x},${points.at(-1)!.y}`;
}
