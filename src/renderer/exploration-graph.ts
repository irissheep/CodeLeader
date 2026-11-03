import type { ProjectIndex, ViewState } from '../shared/model';
import type { GraphCard, GraphLink } from './graph-model';
import { mainGraph, sceneGraph } from './flow-model';
import { entryOutcome } from './reading-model';
import { inlinePanelHeight } from './entry-geometry';
import {visibleCapabilities,unitNoticeHeight} from './backbone-model';
import {cardSize} from './graph-geometry';
import tokens from '../shared/ui-tokens';
import {explorationFlow} from './exploration-layout';

export { interfaceRowHeight } from './entry-geometry';
export function explorationGraph(index:ProjectIndex,view:ViewState){
 const task=view.exploration!,graph=mainGraph(index,view);
 const domain=index.entities?.find(e=>e.id===task.domainId),entry=index.entries?.find(e=>e.id===task.entryId);
 const entries=(index.entries||[]).filter(e=>domain?.entryIds?.includes(e.id));
 const source=graph.cards.find(c=>c.id===task.serviceId);
 if(source&&domain){
  // The selected row keeps its original slot, including auxiliary capabilities opened by search.
  const capabilities=source.capabilities||[],shown=visibleCapabilities(source);
  if(!shown.some(c=>c.id===domain.id)){source.compact=false;view={...view,expanded:[...view.expanded,source.id]};}
  const list=source.compact===false?capabilities:shown,slot=list.findIndex(c=>c.id===domain.id);
  source.inline={domainId:domain.id,name:list[slot]?.name||domain.name,entries,top:66+(Math.floor(slot/2)+1)*52,height:inlinePanelHeight(entries.length),stage:task.stage,entryId:task.entryId};
  source.destinations=Object.fromEntries(entries.map(e=>[e.id,entryOutcome(index,e)]));
 }
 if(task.stage==='chain'&&entry?.symbolId){
  const scene=sceneGraph(index,{...view,level:'function',focus:entry.symbolId,entryId:entry.id},8);
  const canonical=(id:string)=>index.entities?.find(e=>e.id===id)?.parentId||id;
  for(const card of scene.cards){
   const id=canonical(card.id);if(graph.cards.some(c=>c.id===id))continue;
   if(card.kind==='resource'){graph.cards.push({...card,id,section:undefined});continue;}
   const owner=graph.cards.find(c=>c.id===card.serviceId&&c.kind==='service');
   graph.cards.push({...card,section:undefined,ownerId:owner?.id});
  }
  // Keep the exact source call and resource identity; tables are details of the existing database.
  const isolated=view.reading?.isolate==='relation'?new Set(graph.links.find(l=>l.id===view.relationSelection)?.relations.map(r=>r.id)):new Set<string>();
  const details=scene.links.flatMap(link=>{const relations=link.relations.filter(r=>!isolated.has(r.id));return relations.length?[{...link,relations,source:canonical(link.source),target:canonical(link.target)}]:[];});
  const detailed=new Set(details.flatMap(link=>link.relations.map(r=>r.id)));
  const context=graph.links.flatMap(link=>{const relations=link.relations.filter(r=>!detailed.has(r.id));return relations.length?[{...link,relations,context:true}]:[];});
  graph.links=[...context,...details];
 }
 for(const service of graph.cards.filter(c=>c.kind==='service')){
  const count=graph.cards.filter(c=>c.ownerId===service.id&&c.kind!=='anchor').length;
  if(service.inline||count){const rows=Math.ceil((service.compact===false?service.capabilities?.length||0:Math.min(6,service.capabilities?.filter(c=>!c.auxiliary).length||0))/2);
   service.canvasSize={width:service.inline&&count?780:460,height:Math.max(82+rows*52+(service.inline?.height||0)+40,(service.inline?.top||82+rows*52)+count*190+50)+unitNoticeHeight(service)};
  }
 }
 return graph;
}

export function placeExploration(cards:GraphCard[],saved:Record<string,{x:number;y:number}>,links:GraphLink[]=[]){
 const positions:Record<string,{x:number;y:number}>={};
 const services=cards.filter(c=>c.kind==='service').sort((a,b)=>(saved[a.id]?.x||0)-(saved[b.id]?.x||0));
 for(const [i,c] of services.entries()){
  const p=saved[c.id]||{x:70+i*700,y:110},left=services[i-1];
  positions[c.id]={...p,x:Math.max(p.x,left?positions[left.id].x+(left.appearance?cardSize(left).width:left.canvasSize?.width||460)+70:p.x)};
  const members=cards.filter(member=>member.ownerId===c.id&&member.kind!=='anchor');
  const scale=c.appearance?.scale||1;
  if(c.explorationFlowOrigin){const local=explorationFlow(members,links,c.explorationFlowOrigin,saved,saved[c.id]);for(const member of members){const point=local.positions[member.id];positions[member.id]={x:positions[c.id].x+point.x*scale,y:positions[c.id].y+point.y*scale};}}
  else members.forEach((member,n)=>positions[member.id]={x:positions[c.id].x+(c.inline?500:30)*scale,y:positions[c.id].y+((c.inline?.top||82+Math.ceil((c.capabilities?.length||0)/2)*52)+n*(member.runtimeCall?126:190)+20)*scale});
 }
 for(const c of cards.filter(c=>c.kind==='anchor')){const parent=positions[c.ownerId!],scale=cards.find(card=>card.id===c.ownerId)?.appearance?.scale||1;positions[c.id]={x:parent.x+c.local!.x*scale,y:parent.y+c.local!.y*scale};}
 let bottom=Math.max(400,...services.map(c=>positions[c.id].y+(c.appearance?cardSize(c).height:c.canvasSize?.height||240)))+100;
 for(const [i,c] of cards.filter(c=>!positions[c.id]).entries()){
  const p=saved[c.id]||{x:70+(i%4)*260,y:bottom};
  const owners=c.kind==='resource'?links.filter(l=>l.target===c.id).map(l=>cards.find(item=>item.id===l.source)).map(item=>item?.ownerId||item?.id):[];
  const owner=services.find(service=>owners.includes(service.id)),expanded=owner?.inline?owner:undefined,displacement=owner&&saved[owner.id]?positions[owner.id].x-saved[owner.id].x:0;
  positions[c.id]=c.kind==='browser'?saved[c.id]||{x:(positions[services[0]?.id]?.x||70)+125,y:(positions[services[0]?.id]?.y||110)-160}:expanded?{...p,x:p.x+displacement,y:Math.max(p.y,positions[expanded.id].y+cardSize(expanded).height+tokens.continuity.resourceGap)}:owner?{...p,x:p.x+displacement}:!links.length&&!services.some(service=>service.hierarchy)?{...p,y:Math.max(p.y,bottom)}:p;
 }
 return positions;
}
