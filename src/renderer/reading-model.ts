import type { EntryPoint, ProjectIndex, Relation, ViewState } from '../shared/model';
import type { GraphCard, GraphLink } from './graph-model';

export interface Destination {id:string;name:string;via:string[];relationIds:string[];conditional:boolean}
export interface EntryOutcome {destinations:Destination[];pending:boolean;direct:boolean;relationIds:string[]}
const caches=new WeakMap<ProjectIndex,Map<string,EntryOutcome>>();
export const auxiliaryEntry=(e:EntryPoint)=>e.kind!=='http';
export const hasConditions=(r:Relation)=>r.rule?.applicability==='conditional'||!![...(r.rule?.conditions||[]),...(r.rule?.alternatives?.flatMap(a=>a.conditions)||[])].some(c=>!c.includes('静态关联；不是当前运行环境'));
const confirmed=(r:Relation)=>r.rule?.applicability!=='excluded'&&(r.rule?.outcome==='unique'||r.status==='resolved')&&!r.auxiliary;
export function entryOutcome(index:ProjectIndex,entry:EntryPoint):EntryOutcome{
 let cache=caches.get(index);if(!cache){cache=new Map();caches.set(index,cache);}const saved=cache.get(entry.id);if(saved)return saved;
 const all=index.relations.filter(r=>['CALLS','HTTP','READS','WRITES'].includes(r.type)&&!r.auxiliary&&r.rule?.applicability!=='excluded');
 const outgoing=new Map<string,Relation[]>();for(const r of all)outgoing.set(r.from,[...(outgoing.get(r.from)||[]),r]);
 const seen=new Set<string>(),active=new Set<string>(),used=new Map<string,Relation>(),found=new Map<string,Destination>();let pending=false;
 const visit=(id:string,via:string[],chain:Relation[],depth:number)=>{
  if(active.has(id)){pending=true;return;}if(seen.has(id))return;if(depth>32||seen.size>=400){pending=true;return;}seen.add(id);active.add(id);
  for(const r of outgoing.get(id)||[]){if(!confirmed(r)){pending=true;continue;}if(!r.to)continue;used.set(r.id,r);
   const entity=index.entities?.find(e=>e.id===r.to),symbol=index.symbols.find(s=>s.id===r.to),service=index.entities?.find(e=>e.id===symbol?.serviceId);
   const nextVia=r.type==='HTTP'&&service&&!via.includes(service.name)?[...via,service.name]:via;
   if(entity?.kind==='resource'){
    const parent=index.entities?.find(e=>e.id===entity.parentId),name=parent?.name||entity.name;
    const previous=found.get(entity.id),ids=[...chain,r].map(e=>e.id);
    found.set(entity.id,{id:entity.id,name,via:nextVia,relationIds:[...new Set([...(previous?.relationIds||[]),...ids])],conditional:!!previous?.conditional||[...chain,r].some(hasConditions)});
   }else visit(r.to,nextVia,[...chain,r],depth+1);
  }active.delete(id);
 };
 if(entry.symbolId)visit(entry.symbolId,[],[],0);else pending=true;
 // A known external library call is not an unknown target. Only a proven empty downstream is called direct.
 const usedLinks=[...used.values()].filter(r=>r.to).map(r=>({id:r.id,source:r.from,target:r.to!,type:r.type,label:'',status:r.status,relations:[r]}));
 const originService=index.symbols.find(s=>s.id===entry.symbolId)?.serviceId;
 const destinations=[...found.values()].map(d=>{const paths=pathLinks(usedLinks,entry.symbolId||'',d.id),owners=[...new Set(paths.filter(l=>l.target===d.id).map(l=>index.symbols.find(s=>s.id===l.source)?.serviceId).filter(Boolean))],owner=owners.length===1&&owners[0]!==originService?index.entities?.find(e=>e.id===owners[0]):undefined;
  return{...d,via:owner?[owner.name]:[],relationIds:paths.map(r=>r.id),conditional:paths.some(p=>p.relations.some(hasConditions))};
 });
 const duplicateNames=new Set(destinations.filter((d,i)=>destinations.some((other,j)=>j!==i&&other.name===d.name)).map(d=>d.name));
 for(const d of destinations)if(duplicateNames.has(d.name))d.name+=' · '+(index.entities?.find(e=>e.id===d.id)?.name||d.id);
 const value={destinations,pending,direct:!pending&&!(outgoing.get(entry.symbolId||'')||[]).length,relationIds:[...used.keys()]};cache.set(entry.id,value);return value;
}
export function pathLinks(links:GraphLink[],origin:string,target:string){
 const forward=new Set([origin]),backward=new Set([target]);let changed=true;
 while(changed){changed=false;for(const e of links){if(forward.has(e.source)&&!forward.has(e.target)){forward.add(e.target);changed=true;}if(backward.has(e.target)&&!backward.has(e.source)){backward.add(e.source);changed=true;}}}
 return links.filter(e=>forward.has(e.source)&&backward.has(e.target));
}
export function filterReading<T extends {cards:GraphCard[];links:GraphLink[];omitted:number}>(graph:T,view:ViewState):T{
 const reading=view.reading;if(!reading)return graph;let links=graph.links;
 if(reading.types?.length)links=links.filter(e=>reading.types!.includes(e.type)||reading.types!.includes('DATA')&&['READS','WRITES'].includes(e.type));
 if(reading.target&&!reading.isolate)links=links.filter(e=>e.target===reading.target);
 if(reading.isolate==='relation')links=links.filter(e=>e.id===view.relationSelection);
 if(reading.isolate==='path'&&reading.target&&reading.origin)links=pathLinks(links,reading.origin,reading.target);
 const ids=new Set(links.flatMap(e=>[e.source,e.target]));
 return {...graph,links,cards:reading.isolate?graph.cards.filter(c=>ids.has(c.id)||c.id===reading.origin||c.id===reading.target):graph.cards};
}
