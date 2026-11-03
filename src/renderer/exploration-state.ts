import type { EntryPoint, ExplorationSnapshot, ProjectIndex, ViewState } from '../shared/model';
import { reach } from './flow-model';

export function snapshot(view:ViewState):ExplorationSnapshot{
 const {level,focus,positions,viewport,expanded,reading,selected,entryId,direction,filter,density,showAll,relationSelection}=view;
 return {level,focus,positions,viewport,expanded,reading,selected,entryId,direction,filter,density,showAll,relationSelection};
}
export function collapse(view:ViewState):ViewState{
 const task=view.exploration;if(!task)return view;
 const chain=task.stage==='chain'&&task.interfaces;
 return {...view,...(chain||task.base),locateRequest:undefined,inspector:undefined,relationIds:undefined,exploration:chain?{...task,stage:'interfaces',interfaces:undefined}:undefined,cameraRevision:(view.cameraRevision||0)+1};
}
export function openDomain(index:ProjectIndex,view:ViewState,id:string):ViewState{
 if(view.exploration?.domainId===id)return collapse(view.exploration.stage==='chain'?collapse(view):view);
 const domain=index.entities?.find(e=>e.id===id&&e.kind==='domain');if(!domain)return view;
 const base=view.exploration?.base||snapshot(view);
 return {...view,...base,locateRequest:undefined,level:'main',focus:undefined,inspector:undefined,entryId:undefined,reading:view.reading,relationSelection:view.relationSelection,exploration:{serviceId:domain.serviceId,domainId:id,stage:'interfaces',base}};
}
export function openEntry(index:ProjectIndex,view:ViewState,entry:EntryPoint,target?:string):ViewState{
 if(view.exploration?.stage==='chain'&&view.exploration.entryId===entry.id&&(!target||view.reading?.isolate==='path'&&view.reading.target===target))return view;
 const domain=index.entities?.find(e=>e.kind==='domain'&&e.entryIds?.includes(entry.id));
 let next=view;
 if(domain&&view.exploration?.domainId!==domain.id)next=openDomain(index,view,domain.id);
 const base=next.exploration?.base||snapshot(view),interfaces={...(next.exploration?.interfaces||snapshot(next)),selected:entry.symbolId};
 return {...next,locateRequest:undefined,level:'main',focus:undefined,entryId:entry.id,selected:entry.symbolId,direction:'callees',inspector:undefined,reading:target?{target,isolate:'path',origin:entry.symbolId}:next.reading,relationSelection:next.relationSelection,exploration:{serviceId:domain?.serviceId||index.symbols.find(s=>s.id===entry.symbolId)?.serviceId,domainId:domain?.id,entryId:entry.id,stage:'chain',base,interfaces}};
}
export function relatedToExploration(index:ProjectIndex,view:ViewState,id:string){
 const entry=index.entries?.find(e=>e.id===view.exploration?.entryId);
 return !!entry?.symbolId&&reach(index,entry.symbolId,32).has(id);
}
export function continuationIds(index:ProjectIndex,view:ViewState,target:string){
 const start=index.entries?.find(e=>e.id===view.exploration?.entryId)?.symbolId;if(!start)return[];
 const previous=new Map<string,string|undefined>([[start,undefined]]),queue=[start];
 while(queue.length&&!previous.has(target)){const id=queue.shift()!;for(const r of index.relations)if(r.from===id&&r.to&&['CALLS','HTTP','READS','WRITES'].includes(r.type)&&!r.auxiliary&&r.rule?.applicability!=='excluded'&&!previous.has(r.to)){previous.set(r.to,id);queue.push(r.to);}}
 const result:string[]=[];if(previous.has(target))for(let id:string|undefined=target;id;id=previous.get(id))result.push(id);return result;
}
