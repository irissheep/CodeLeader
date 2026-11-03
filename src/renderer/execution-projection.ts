import type { ProjectIndex } from '../shared/model';
import type { ReplayCall, ReplayState, ReplayModel } from '../runtime/replay';
import { callVisibility } from '../runtime/replay';
import {methodRows} from './method-list';
import {replayLabel} from '../runtime/replay';
import type { GraphCard, GraphLink } from './graph-model';
import {unitNoticeHeight} from './backbone-model';

export const browserNodeId='runtime:browser';
export function executionDomains(index:ProjectIndex,model:ReplayModel){
  const bySymbol=new Map(index.symbols.map(s=>[s.id,s])),entryDomains=new Map<string,string>(),domains=new Map<string,string>();
  for(const domain of index.entities?.filter(e=>e.kind==='domain')||[])for(const entry of index.entries||[])if(entry.symbolId&&domain.entryIds?.includes(entry.id))entryDomains.set(entry.symbolId,domain.id);
  const service=(call:ReplayCall)=>call.records.map(s=>s.versionMatch&&(bySymbol.get(s.symbolId||'')?.serviceId||s.attributes['codeleader.service_id'])).find(id=>typeof id==='string');
  const resolve=(call:ReplayCall,seen=new Set<string>()):string|undefined=>{
    if(call.kind==='browser')return;
    if(domains.has(call.id))return domains.get(call.id);if(seen.has(call.id))return;seen.add(call.id);
    const direct=call.records.flatMap(s=>s.versionMatch&&s.symbolId?[entryDomains.get(s.symbolId)]:[]).find(Boolean);
    const parent=call.parentId&&model.byCall[call.parentId];
    const inherited=parent&&(!service(call)||!service(parent)||service(call)===service(parent))?resolve(parent,seen):undefined;
    const serviceDomains=index.entities?.filter(e=>e.kind==='domain'&&e.serviceId===service(call))||[];
    const domain=direct||inherited||(serviceDomains.length===1?serviceDomains[0].id:undefined);if(domain)domains.set(call.id,domain);return domain;
  };
  for(const call of model.calls)resolve(call);return domains;
}
export function executionStepName(call:ReplayCall,phase:string){
  if(phase==='return')return '返回';
  if(call.kind==='sql'){const sql=String(call.span?.attributes['db.query.text']||call.span?.attributes['db.statement']||'');return /^\s*(INSERT|UPDATE|DELETE|REPLACE)/i.test(sql)?'写入数据':'读取数据';}
  if(call.kind==='chroma')return '向量检索';return phase==='enter'?'进入':'执行';
}
export function executionCallLabel(call:ReplayCall){
  if(call.kind!=='sql')return replayLabel(call);
  const sql=String(call.span?.attributes['db.query.text']||call.span?.attributes['db.statement']||''),table=sql.match(/\b(?:INTO|UPDATE|FROM)\s+([\w.]+)/i)?.[1];
  return `${executionStepName(call,'atomic')}${table?' · '+table:''}`;
}
export interface ExecutionProjection {
  active:Set<string>;current?:string;domains:Set<string>;currentDomain?:string;
  edges:Set<string>;asyncEdges:Set<string>;currentEdge?:string;returning:boolean;calls:Map<string,ReplayCall[]>;unmapped:ReplayCall[];
}
/** Uses exact source/resource identities. Service labels never establish a mapping. */
export function projectExecution(index:ProjectIndex,cards:GraphCard[],links:GraphLink[],state:ReplayState):ExecutionProjection {
  const current=state.model.steps[state.model.positions[state.cursor]],bySymbol=new Map(index.symbols.map(s=>[s.id,s])),byEntity=new Map(index.entities?.map(e=>[e.id,e])),domainOf=new Map<string,string>();
  for(const domain of index.entities?.filter(e=>e.kind==='domain')||[])for(const entry of index.entries?.filter(e=>domain.entryIds?.includes(e.id))||[])if(entry.symbolId)domainOf.set(entry.symbolId,domain.id);
  const mapped=new Map<string,string>(),domains=executionDomains(index,state.model),calls=new Map<string,ReplayCall[]>(),unmapped:ReplayCall[]=[];
  for(const call of state.model.calls){
    if(call.kind==='browser'){mapped.set(call.id,browserNodeId);calls.set(browserNodeId,[call]);continue;}
    const source=call.records.find(s=>s.versionMatch&&s.symbolId),resource=call.records.find(s=>s.versionMatch&&s.entityId),symbol=source&&bySymbol.get(source.symbolId!),entity=resource&&byEntity.get(resource.entityId!);
    let id=cards.find(c=>c.id===call.id||c.id===symbol?.id)?.id;
    if(entity)id=entity.parentId||entity.id;
    if(symbol){if(!id)id=symbol.serviceId;const domain=domainOf.get(symbol.id);if(domain)domains.set(call.id,domain);}
    const serviceId=call.records.find(s=>s.versionMatch&&typeof s.attributes['codeleader.service_id']==='string')?.attributes['codeleader.service_id'];
    if(!id&&typeof serviceId==='string'&&byEntity.get(serviceId)?.kind==='service')id=serviceId;
    if(id&&cards.some(c=>c.id===id)){mapped.set(call.id,id);calls.set(id,[...calls.get(id)||[],call]);}else unmapped.push(call);
  }
  // Class members inherit the uniquely identified active entry domain within the same service.
  for(const call of state.model.calls){if(domains.has(call.id))continue;let parent=call.parentId;const seen=new Set<string>();while(parent&&!seen.has(parent)){seen.add(parent);if(domains.has(parent)&&mapped.get(parent)===mapped.get(call.id)){domains.set(call.id,domains.get(parent)!);break;}parent=state.model.byCall[parent]?.parentId;}}
  const active=new Set<string>([browserNodeId]),activeDomains=new Set<string>(),edges=new Set<string>(),asyncEdges=new Set<string>();let currentEdge:string|undefined;
  for(const call of state.model.calls){if(!callVisibility(state,call.id).reached)continue;const id=mapped.get(call.id);if(id){active.add(id);const owner=cards.find(c=>c.id===id)?.ownerId;if(owner)active.add(owner);}const domain=domains.get(call.id);if(domain)activeDomains.add(domain);
    let parent=call.parentId,from:string|undefined;const seen=new Set<string>();while(parent&&!seen.has(parent)){seen.add(parent);from=mapped.get(parent);if(from&&from!==id)break;parent=state.model.byCall[parent]?.parentId;}
    if(!from||!id||from===id)continue;
    const macroFrom=cards.find(c=>c.id===from)?.ownerId||from,macroTo=cards.find(c=>c.id===id)?.ownerId||id;
    const matches=links.filter(l=>(l.source===from&&l.target===id||l.source===macroFrom&&l.target===macroTo)&&(!l.relations.length||l.relations.some(r=>call.records.some(s=>s.entityId===r.to||s.symbolId===r.to||s.symbolId===r.from))));
    for(const link of matches){edges.add(link.id);if(call.asynchronous)asyncEdges.add(link.id);}if(current?.callId===call.id)currentEdge=matches.find(l=>l.source===from&&l.target===id)?.id||matches[0]?.id;
  }
  const currentId=current&&mapped.get(current.callId);
  return {active,current:currentId,domains:activeDomains,currentDomain:current?domains.get(current.callId):undefined,edges,asyncEdges,currentEdge,returning:current?.phase==='return',calls,unmapped};
}
export function runtimeGraph(index:ProjectIndex,base:{cards:GraphCard[];links:GraphLink[];omitted:number},model:ReplayModel|undefined,domainId:string|undefined){
  const cards=base.cards.map(c=>({...c,...(c.kind==='service'&&!c.frontend?{compact:false}:{})})),links=[...base.links];
  cards.push({id:browserNodeId,kind:'browser',name:'浏览器',subtitle:'',tag:'',callers:0,callees:0,canvasSize:{width:210,height:94}});
  for(const service of cards.filter(c=>c.kind==='service'&&!c.frontend))links.push({id:`runtime:request:${service.id}`,source:browserNodeId,target:service.id,label:'HTTP',status:'recorded',relations:[],type:'HTTP'});
  const domain=index.entities?.find(e=>e.id===domainId),owner=cards.find(c=>c.id===domain?.serviceId);
  if(model&&owner){
    const domains=executionDomains(index,model),selected=model.calls.filter(call=>domains.get(call.id)===domainId&&call.kind!=='browser').sort((a,b)=>model.positions[a.enterId]-model.positions[b.enterId]);
    const height=methodRows(model,selected.map(c=>c.id)).length*54+12;
    owner.runtimeExpansion={domainId:domainId!,calls:selected.map(c=>c.id),height};
    owner.canvasSize={width:460,height:82+Math.ceil((owner.capabilities?.length||0)/2)*52+height+20+unitNoticeHeight(owner)};
  }
  return {cards,links,omitted:base.omitted};
}
