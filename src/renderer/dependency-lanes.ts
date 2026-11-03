import type {GraphCard,GraphLink,GraphResult} from './graph-model';
import type {LayoutEdge,LayoutNode,LayoutSnapshot,Point,Port,Rect} from './graph-geometry';
import {pathCrossings,pathOverlap} from './dependency-routing';
import tokens from '../shared/ui-tokens';
import policy from '../shared/dependency-policy.json';
import appearance from '../shared/adaptive-look.json';
const t=tokens.lanes,p=policy.thresholds;
export const laneNames={entry:'入口',business:'业务',data:'数据',object:'对象',common:'公共'};
export type LaneId=keyof typeof laneNames;
export type LaneOrientation='rows'|'columns';
export function laneRole(card:GraphCard):LaneId{return (appearance.dependencyRoles as Record<string,{lane:LaneId}>)[card.dependency?.role||'other']?.lane||'business';}
export function presentDependencyLanes(graph:GraphResult):GraphResult{
 const users=(id:string)=>[...new Set(graph.links.filter(l=>l.target===id).map(l=>l.source))];
 const bases=new Set(graph.links.filter(l=>(l.kinds||[l.type]).includes('EXTENDS')).map(l=>l.target));
 const shared=new Set(graph.cards.filter(c=>laneRole(c)==='common'||bases.has(c.id)||c.dependency?.side||users(c.id).length>=graph.cards.length*p.sharedIncomingRatio.value).map(c=>c.id));
 const groups=new Map<string,number>();for(const card of graph.cards){const lane=shared.has(card.id)?'common':laneRole(card);groups.set(lane,(groups.get(lane)||0)+1);}
 return{...graph,cards:graph.cards.map((card,order)=>{
  const common=shared.has(card.id),id=common?'common':laneRole(card),compact=!common&&groups.get(id)!>p.laneCompactCount.value;
  return{...card,appearance:card.appearance&&{...card.appearance,scale:1,tiles:false},dependencyLane:{id,common,users:users(card.id),uses:[...new Set(graph.links.filter(l=>l.source===card.id&&shared.has(l.target)).map(l=>l.target))],compact,order},canvasSize:{width:common?t.commonWidth:compact?t.compactWidth:t.cardWidth,height:common?t.commonHeight:compact?t.compactHeight:t.cardHeight}};
 })};
}
export function primaryKind(link:GraphLink){return ['CALLS','IMPLEMENTS','MAPS'].find(type=>(link.kinds||[link.type]).includes(type));}
export function laneMainLinks(cards:GraphCard[],links:GraphLink[]){
 const common=new Set(cards.filter(c=>c.dependencyLane?.common).map(c=>c.id));
 return new Set(links.filter(l=>primaryKind(l)&&!common.has(l.source)&&!common.has(l.target)).sort((a,b)=>Number(primaryKind(b)==='CALLS')-Number(primaryKind(a)==='CALLS')||b.relations.length-a.relations.length||a.id.localeCompare(b.id)).slice(0,cards.length).map(l=>l.id));
}
const size=(card:GraphCard)=>card.canvasSize||{width:t.cardWidth,height:t.cardHeight};
const transpose=(point:Point,column:boolean)=>column?{x:point.y,y:point.x}:point;
const clean=(points:Point[])=>{
 const out:Point[]=[];for(const point of points){if(out.length&&out.at(-1)!.x===point.x&&out.at(-1)!.y===point.y)continue;while(out.length>1&&((out.at(-2)!.x===out.at(-1)!.x&&out.at(-1)!.x===point.x)||(out.at(-2)!.y===out.at(-1)!.y&&out.at(-1)!.y===point.y)))out.pop();out.push(point);}return out;
};
function hits(a:Point,b:Point,r:Rect){return a.x===b.x?a.x>r.x+.01&&a.x<r.x+r.width-.01&&Math.max(a.y,b.y)>r.y+.01&&Math.min(a.y,b.y)<r.y+r.height-.01:a.y===b.y?a.y>r.y+.01&&a.y<r.y+r.height-.01&&Math.max(a.x,b.x)>r.x+.01&&Math.min(a.x,b.x)<r.x+r.width-.01:true;}
function route(cards:GraphCard[],links:GraphLink[],positions:Record<string,Point>,column:boolean,refine=false){
 const nodes=cards.map(c=>{const point=transpose(positions[c.id],column),s=size(c);return{id:c.id,...point,width:column?s.height:s.width,height:column?s.width:s.height};}),byId=new Map(nodes.map(n=>[n.id,n])),main=laneMainLinks(cards,links);
 const bounds={left:Math.min(...nodes.map(n=>n.x)),right:Math.max(...nodes.map(n=>n.x+n.width)),top:Math.min(...nodes.map(n=>n.y)),bottom:Math.max(...nodes.map(n=>n.y+n.height))};
 const ordered=[...links].sort((a,b)=>Number(main.has(b.id))-Number(main.has(a.id))||Math.abs(byId.get(a.source)!.y-byId.get(a.target)!.y)-Math.abs(byId.get(b.source)!.y-byId.get(b.target)!.y)||a.id.localeCompare(b.id));
 const edges:LayoutEdge[]=[],invalid:string[]=[],choices=new Map<string,Point[][]>();
 const related=(first:string,second:string)=>{const a=links.find(l=>l.id===first)!,b=links.find(l=>l.id===second)!;return a.source===b.source||a.source===b.target||a.target===b.source||a.target===b.target;};
 const overlapCost=(first:string,second:string,length:number)=>length*(related(first,second)||!main.has(first)||!main.has(second)?1:p.laneMainOverlapCost.value);
 const activeLanes=(Object.keys(laneNames) as LaneId[]).filter(id=>cards.some(c=>c.dependencyLane?.id===id)),laneOf=(id:string)=>activeLanes.indexOf(cards.find(c=>c.id===id)!.dependencyLane!.id as LaneId);
 for(const link of ordered){
  const a=byId.get(link.source)!,b=byId.get(link.target)!,adjacent=Math.abs(laneOf(a.id)-laneOf(b.id))<=1,candidates:Point[][]=[];
  const peers=(node:typeof a)=>links.filter(l=>l.source===node.id||l.target===node.id).sort((x,y)=>{const other=(l:GraphLink)=>byId.get(l.source===node.id?l.target:l.source)!;return other(x).x-other(y).x||x.id.localeCompare(y.id);});
  const offset=(node:typeof a)=>{const list=peers(node);return Math.max(-node.width*t.portSpread,Math.min(node.width*t.portSpread,(list.findIndex(l=>l.id===link.id)-(list.length-1)/2)*t.channelGap));};
  const sx=a.x+a.width/2+offset(a),tx=b.x+b.width/2+offset(b),forward=a.y+a.height/2<=b.y+b.height/2;
  const sy=forward?a.y+a.height:a.y,ty=forward?b.y:b.y+b.height;
  const start={x:sx,y:sy},end={x:tx,y:ty};
  if(a===b){const x=a.x+a.width+t.channelEscape;candidates.push([{x:a.x+a.width,y:a.y+a.height/3},{x,y:a.y+a.height/3},{x,y:a.y+a.height*2/3},{x:a.x+a.width,y:a.y+a.height*2/3}]);}
  else if(a.y===b.y){
   const right=a.x<b.x,cx=right?a.x+a.width:a.x,dx=right?b.x:b.x+b.width;
   candidates.push([{x:cx,y:a.y+a.height/2},{x:dx,y:b.y+b.height/2}]);
   for(const y of [Math.min(a.y,b.y)-t.channelEscape,Math.max(a.y+a.height,b.y+b.height)+t.channelEscape])candidates.push([{x:sx,y:y<a.y?a.y:a.y+a.height},{x:sx,y},{x:tx,y},{x:tx,y:y<b.y?b.y:b.y+b.height}]);
  }else if(adjacent){
   for(let i=1;i<=p.laneRouteChoices.value;i++){const y=sy+(ty-sy)*i/(p.laneRouteChoices.value+1);candidates.push([start,{x:sx,y},{x:tx,y},end]);}
  }
  // Long relations use the same bounded side corridor. No edge is dropped.
  for(let i=1;i<=p.laneRouteChoices.value;i++){
   const x=bounds.right+t.outerMargin*i/(p.laneRouteChoices.value+1),escape=i*t.channelGap,ay=sy+(forward?1:-1)*escape,by=ty+(forward?-1:1)*escape;
   candidates.push([start,{x:sx,y:ay},{x,y:ay},{x,y:by},{x:tx,y:by},end]);
  }
  const ports=(node:typeof a)=>[
   {point:{x:node.x+node.width,y:node.y+node.height/2},out:{x:1,y:0}},
   {point:{x:node.x,y:node.y+node.height/2},out:{x:-1,y:0}},
   {point:{x:node.x+node.width/2,y:node.y},out:{x:0,y:-1}},
   {point:{x:node.x+node.width/2,y:node.y+node.height},out:{x:0,y:1}}
  ];
  if(a!==b&&adjacent)for(const s of ports(a))for(const target of ports(b)){
   const first={x:s.point.x+s.out.x*t.channelEscape,y:s.point.y+s.out.y*t.channelEscape},last={x:target.point.x+target.out.x*t.channelEscape,y:target.point.y+target.out.y*t.channelEscape};
   candidates.push([s.point,first,{x:first.x,y:last.y},last,target.point],[s.point,first,{x:last.x,y:first.y},last,target.point]);
  }
  if(a!==b&&!adjacent)for(const s of ports(a).filter(port=>port.out.x>=0))for(const target of ports(b).filter(port=>port.out.x>=0))for(let i=1;i<=p.laneRouteChoices.value;i++){
   const escape=i*t.channelGap,first={x:s.point.x+s.out.x*escape,y:s.point.y+s.out.y*escape},last={x:target.point.x+target.out.x*escape,y:target.point.y+target.out.y*escape},x=bounds.right+t.outerMargin*i/(p.laneRouteChoices.value+1);
   candidates.push([s.point,first,{x,y:first.y},{x,y:last.y},last,target.point]);
  }
  const normalized=candidates.map(clean).filter(path=>path.length-2<=p.laneMaxBends.value&&path.every(q=>q.x>=bounds.left-t.outerMargin&&q.x<=bounds.right+t.outerMargin&&q.y>=bounds.top-t.outerMargin&&q.y<=bounds.bottom+t.outerMargin));
  const valid=normalized.filter(path=>!path.slice(1).some((point,i)=>nodes.some(n=>!(n.id===a.id&&i===0)&&!(n.id===b.id&&i===path.length-2)&&hits(path[i],point,n))));
  choices.set(link.id,valid);
  const cost=(path:Point[])=>{const crossings=edges.reduce((n,e)=>n+pathCrossings(path,e.points)*(main.has(link.id)&&main.has(e.id)?p.laneMainCrossingCost.value:p.laneMemberCrossingCost.value),0),overlap=edges.reduce((n,e)=>n+overlapCost(link.id,e.id,pathOverlap(path,e.points)),0),length=path.slice(1).reduce((n,q,i)=>n+Math.hypot(q.x-path[i].x,q.y-path[i].y),0);return crossings+overlap+length/p.laneMemberCrossingCost.value;};
  const points=(valid.length?valid:normalized).map(points=>({points,cost:cost(points)})).sort((a,b)=>a.cost-b.cost)[0]?.points||[start,end];if(!valid.length)invalid.push(link.id);
  const middle=points[Math.floor(points.length/2)];edges.push({id:link.id,sourcePort:link.id+':source',targetPort:link.id+':target',points,label:middle,labelWidth:0,feedback:false});
 }
 if(refine)for(let pass=0;pass<p.routePasses.value;pass++){
  let changed=false;
  for(const edge of edges){const others=edges.filter(e=>e!==edge),cost=(path:Point[])=>others.reduce((n,e)=>n+pathCrossings(path,e.points)*(main.has(edge.id)&&main.has(e.id)?p.laneMainCrossingCost.value:p.laneMemberCrossingCost.value)+overlapCost(edge.id,e.id,pathOverlap(path,e.points)),0),current=cost(edge.points),best=(choices.get(edge.id)||[]).map(points=>({points,value:cost(points)})).sort((a,b)=>a.value-b.value)[0];
   if(best&&best.value<current){edge.points=best.points;edge.label=best.points[Math.floor(best.points.length/2)];changed=true;}
  }
  if(!changed)break;
 }
 return{nodes,edges,invalid};
}
export function dependencyLaneLayout(version:number,cards:GraphCard[],links:GraphLink[],saved:Record<string,Point>={},orientation:LaneOrientation='rows',skeleton?:(snapshot:LayoutSnapshot)=>void):LayoutSnapshot{
 if(!cards.length)return{version,nodes:[],edges:[],regions:[]};
 const column=orientation==='columns',lanes=(Object.keys(laneNames) as LaneId[]).map(id=>({id,cards:cards.filter(c=>c.dependencyLane?.id===id).sort((a,b)=>a.name.localeCompare(b.name)||a.id.localeCompare(b.id))})).filter(l=>l.cards.length),main=laneMainLinks(cards,links);
 const crossStep=Math.max(...cards.map(c=>column?size(c).height:size(c).width),t.cardHeight)+t.cardGap;
 const starts=new Map<string,number>();let flow=t.padding;
 for(const lane of lanes){starts.set(lane.id,flow);flow+=Math.max(...lane.cards.map(c=>column?size(c).width:size(c).height))+2*t.padding+t.header+t.gap;}
 const arrange=(rows:typeof lanes)=>Object.fromEntries(rows.flatMap(l=>l.cards.map((card,i)=>[card.id,transpose({x:t.padding+i*crossStep,y:starts.get(l.id)!+t.header+t.padding},column)])));
 let permutations=1;for(const lane of lanes)for(let n=2;n<=lane.cards.length;n++)permutations*=n;
 const score=(positions:Record<string,Point>)=>{const r=route(cards,links,positions,column,permutations<=p.laneExactPermutations.value);let primary=0,all=0,overlap=0;for(let i=0;i<r.edges.length;i++)for(const edge of r.edges.slice(i+1)){const first=r.edges[i],c=pathCrossings(first.points,edge.points),length=pathOverlap(first.points,edge.points),a=links.find(l=>l.id===first.id)!,b=links.find(l=>l.id===edge.id)!,unrelated=![a.source,a.target].some(id=>id===b.source||id===b.target);all+=c;if(main.has(first.id)&&main.has(edge.id)){primary+=c;if(unrelated)overlap+=length*p.laneMainOverlapCost.value;}overlap+=length;}return r.invalid.length*p.laneInvalidCost.value+primary*p.laneMainCrossingCost.value+all*p.laneMemberCrossingCost.value+overlap;};
 const retained=cards.some(c=>saved[c.id]);let positions=arrange(lanes);
 if(!retained&&cards.length>1){
  // Stable barycentric sweep provides the initial order for both exact and bounded search.
  for(let pass=0;pass<p.orderPasses.value;pass++){
   const ranks=new Map(lanes.flatMap(l=>l.cards.map((c,i)=>[c.id,i] as const)));
   for(const lane of pass%2?[...lanes].reverse():lanes)lane.cards.sort((a,b)=>{
    const rank=(card:GraphCard)=>{const values=links.filter(l=>l.source===card.id||l.target===card.id).map(l=>ranks.get(l.source===card.id?l.target:l.source)!).filter(x=>x!==undefined);return values.length?values.reduce((a,b)=>a+b,0)/values.length:ranks.get(card.id)!;};return rank(a)-rank(b)||ranks.get(a.id)!-ranks.get(b.id)!;
   });
  }
  positions=arrange(lanes);let best=score(positions);
  const accept=()=>{const next=arrange(lanes),value=score(next);if(value<best){best=value;positions=next;}return value;};
  if(permutations<=p.laneExactPermutations.value){
   const permute=(list:GraphCard[],at:number,done:()=>void)=>{if(at===list.length){done();return;}for(let i=at;i<list.length;i++){[list[at],list[i]]=[list[i],list[at]];permute(list,at+1,done);[list[at],list[i]]=[list[i],list[at]];}};
   const visit=(at:number)=>at===lanes.length?accept():permute(lanes[at].cards,0,()=>visit(at+1));visit(0);
  }else{
   let seed=p.laneSeed.value,current=best;const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
   const mutable=lanes.filter(l=>l.cards.length>1);
   for(let i=0;mutable.length&&i<p.laneAnnealIterations.value;i++){
    const list=mutable[Math.floor(random()*mutable.length)].cards,a=Math.floor(random()*list.length),b=Math.floor(random()*list.length);if(a===b)continue;
    [list[a],list[b]]=[list[b],list[a]];const value=accept(),temperature=p.laneAnnealTemperature.value*(1-i/p.laneAnnealIterations.value);
    if(value<=current||random()<Math.exp((current-value)/Math.max(1,temperature)))current=value;else [list[a],list[b]]=[list[b],list[a]];
   }
  }
 }
 // Saved cards win. New cards fill the nearest free slot within their own lane.
 const placed:Rect[]=[];
 for(const card of [...cards].sort((a,b)=>Number(!!saved[b.id])-Number(!!saved[a.id])||a.id.localeCompare(b.id))){
  let point=saved[card.id]||positions[card.id];const s=size(card);
  if(!saved[card.id]){
   const preferred=transpose(point,column),parent=card.dependency?.parent&&saved[card.dependency.parent],anchor=cards.find(c=>c.dependencyLane?.id===card.dependencyLane!.id&&saved[c.id]);
   if(parent)preferred.x=transpose(parent,column).x;if(anchor)preferred.y=transpose(saved[anchor.id],column).y;
   const free=(candidate:Point)=>!placed.some(r=>candidate.x<r.x+r.width+t.gap&&candidate.x+s.width+t.gap>r.x&&candidate.y<r.y+r.height+t.gap&&candidate.y+s.height+t.gap>r.y);
   point=transpose(preferred,column);
   if(!free(point)){const slots=Array.from({length:cards.length+placed.length+1},(_,i)=>t.padding+i*crossStep).sort((a,b)=>Math.abs(a-preferred.x)-Math.abs(b-preferred.x)||a-b);point=slots.map(x=>transpose({x,y:preferred.y},column)).find(free)||point;}
  }
  positions[card.id]=point;placed.push({...point,...s});
 }
 const nodes:LayoutNode[]=cards.map(c=>({id:c.id,...positions[c.id],...size(c),ports:[]}));
 const regions=lanes.map(l=>{const members=nodes.filter(n=>l.cards.some(c=>c.id===n.id)),x=Math.min(...members.map(n=>n.x))-t.padding,y=Math.min(...members.map(n=>n.y))-t.padding-t.header;return{id:'lane:'+l.id,label:laneNames[l.id],x,y,width:Math.max(...members.map(n=>n.x+n.width))-x+t.padding,height:Math.max(...members.map(n=>n.y+n.height))-y+t.padding};});
 skeleton?.({version,nodes,edges:[],regions});
 const result=route(cards,links,positions,column,true);
 for(const edge of result.edges){edge.points=edge.points.map(point=>transpose(point,column));edge.label=transpose(edge.label,column);const link=links.find(l=>l.id===edge.id)!;
  for(const [id,point,next,type,portId]of [[link.source,edge.points[0],edge.points[1],'source',edge.sourcePort],[link.target,edge.points.at(-1)!,edge.points.at(-2)!,'target',edge.targetPort]] as const){const node=nodes.find(n=>n.id===id)!,side:Port['side']=point.x===node.x?'left':point.x===node.x+node.width?'right':point.y===node.y?'top':'bottom';node.ports.push({id:portId,type,side,x:point.x-node.x,y:point.y-node.y});void next;}
 }
 return{version,nodes,edges:result.edges,regions};
}
