import type {EntryPoint,Location,ProjectIndex,Relation,ViewState} from '../shared/model';
import {graphFor} from './graph-model';
import {withFrontendTargets} from '../shared/frontend-targets';

export interface ViewIssue {id:string;title:string;reason:string;location:Location;entry?:EntryPoint}
export interface ViewIssues {label:string;items:ViewIssue[]}
const position=(relation:Relation)=>relation.locations[0];
const key=(location:Location)=>`${location.file}:${JSON.stringify(location.range)}`;

export function viewIssues(project:ProjectIndex,view:ViewState):ViewIssues {
 const index=withFrontendTargets(project,view.frontendTargets);
 if(view.level==='main')return {label:'个请求没对上',items:(index.frontendLinks?.calls||[]).filter(link=>link.outcome==='unmatched'&&link.reason!=='external-backend').map(link=>({id:link.callId,title:`${link.method} ${index.frontend?.httpCalls.find(call=>call.id===link.callId)?.url||''}`,reason:({'unknown-address':'地址没有写明','path-mismatch':'路径不一致','missing-endpoint':'后端没有找到对应接口','multiple-paths':'这个路径对应多个接口'} as Record<string,string>)[link.reason]||'暂时没有找到对应接口',location:link.source}))};
 const local=new Set(index.symbols.map(symbol=>symbol.id)),confirmed=new Set<string>();
 for(const relation of index.relations)if(relation.to&&local.has(relation.to)&&(relation.status==='resolved'||relation.rule?.outcome==='unique'))for(const location of relation.locations)confirmed.add(key(location));
 const candidates=index.relations.filter(relation=>relation.type==='CALLS'&&relation.to&&local.has(relation.to)&&relation.status!=='resolved'&&relation.rule?.outcome!=='unique'&&!relation.auxiliary&&relation.rule?.applicability!=='excluded'&&position(relation)&&!confirmed.has(key(position(relation)!)));
 if(view.level==='guide'){
  if(view.filter==='frontend')return {label:'个接口的后续待确认',items:[]};
  const outgoing=new Map<string,string[]>();for(const relation of index.relations)if(relation.to&&local.has(relation.to)&&['CALLS','HTTP'].includes(relation.type)&&!relation.auxiliary&&relation.rule?.applicability!=='excluded'&&(relation.status==='resolved'||relation.rule?.outcome==='unique')){const rows=outgoing.get(relation.from)||[];rows.push(relation.to);outgoing.set(relation.from,rows);}
  const scope=index.entities?.find(entity=>entity.id===view.focus),entries=(index.entries||[]).filter(entry=>entry.kind==='http'&&(!scope||scope.kind==='domain'&&scope.entryIds?.includes(entry.id)||scope.kind==='service'&&(scope.entryIds?.includes(entry.id)||index.symbols.find(symbol=>symbol.id===entry.symbolId)?.serviceId===scope.id)));
  const items:ViewIssue[]=[];for(const entry of entries){if(!entry.symbolId){items.push({id:entry.id,title:entry.name,reason:'没有定位到处理这个接口的方法',location:entry.location,entry});continue;}const seen=new Set<string>(),queue=[entry.symbolId];while(queue.length){const id=queue.shift()!;if(seen.has(id))continue;seen.add(id);queue.push(...(outgoing.get(id)||[]).filter(next=>!seen.has(next)));}const relation=candidates.find(row=>seen.has(row.from));if(relation)items.push({id:entry.id,title:entry.name,reason:'后续调用的项目内目标还不能确定',location:position(relation)!,entry});}
  return {label:'个接口的后续待确认',items};
 }
 if(view.level==='overview'){
  const graph=graphFor(index,view),visible=new Set(graph.cards.flatMap(card=>[card.id,card.symbol?.id,...card.members||[],...card.rows?.map(row=>row.id)||[]].filter((value):value is string=>!!value)));
  const represented=new Set([...graph.links,...graph.cards.flatMap(card=>card.foldedLinks||[])].flatMap(link=>link.relations.flatMap(relation=>relation.locations.map(key))));
  const inView=(id:string)=>visible.has(id)||visible.has(index.symbols.find(symbol=>symbol.id===id)?.parent||'');
  const seen=new Set<string>(),items:ViewIssue[]=[];for(const relation of candidates){if(!inView(relation.from)||!relation.to||!inView(relation.to))continue;const location=position(relation)!,id=key(location);if(seen.has(id)||represented.has(id))continue;seen.add(id);items.push({id,title:relation.target,reason:'项目内目标尚不能唯一确定',location});}
  return {label:'处连接待确认',items};
 }
 return {label:'处待确认',items:[]};
}
