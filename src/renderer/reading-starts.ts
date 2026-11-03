import type {EntryPoint, ProjectIndex, Relation} from '../shared/model';

export interface ReadingStart {entry:EntryPoint;calls:number;steps:number;methods:number;tables:string[];databases:string[];readOnly:boolean;uncertain:boolean}

// The hash only breaks ties; it does not express business importance.
function stableHash(value:string){let hash=2166136261;for(const char of value){hash^=char.charCodeAt(0);hash=Math.imul(hash,16777619);}return hash>>>0;}

export function readingStarts(index:ProjectIndex,entries:EntryPoint[]):ReadingStart[]{
 const outgoing=new Map<string,Relation[]>();
 for(const relation of index.relations){
  if(!['CALLS','HTTP','READS','WRITES'].includes(relation.type)||relation.auxiliary||relation.rule?.applicability==='excluded'||!relation.to)continue;
  const list=outgoing.get(relation.from)||[];list.push(relation);outgoing.set(relation.from,list);
 }
 const resources=new Map((index.entities||[]).filter(entity=>entity.kind==='resource'&&['database','table'].includes(entity.resourceKind||'')).map(entity=>[entity.id,entity]));
 const symbols=new Set(index.symbols.map(symbol=>symbol.id));
 return entries.filter(entry=>entry.kind==='http').map(entry=>{
  const seen=new Map<string,boolean>(),queue=entry.symbolId?[{id:entry.symbolId,uncertain:false}]:[],tables=new Map<string,boolean>(),databases=new Map<string,boolean>(),steps=new Set<string>();let reads=false,writes=false;
  while(queue.length){const {id,uncertain}=queue.shift()!;if(seen.has(id)&&(!seen.get(id)||uncertain))continue;seen.set(id,uncertain);
   for(const relation of outgoing.get(id)||[]){
    const maybe=uncertain||relation.rule?.applicability==='conditional'||(relation.status!=='resolved'&&relation.rule?.outcome!=='unique'),resource=relation.to&&resources.get(relation.to);
    if(resource||relation.to&&symbols.has(relation.to)){const location=relation.locations[0];steps.add(location?`${relation.type}:${location.file}:${JSON.stringify(location.range)}`:relation.id);}
    if(resource&&['READS','WRITES'].includes(relation.type)){const table=relation.data?.table||(resource.resourceKind==='table'?resource.name:undefined),destinations=table?tables:databases,name=table||resource.name;destinations.set(name,!!destinations.get(name)||!maybe);reads ||=relation.type==='READS';writes ||=relation.type==='WRITES';}
    if(relation.to&&symbols.has(relation.to))queue.push({id:relation.to,uncertain:maybe});
   }
  }
  const calls=index.frontendLinks?.calls.filter(link=>link.outcome==='matched'&&link.targets.some(target=>target.entryId===entry.id)).length||0;
  const ordered=(values:Map<string,boolean>)=>[...values].sort((a,b)=>Number(b[1])-Number(a[1]));const tableList=ordered(tables),databaseList=ordered(databases);
  return {entry,calls,steps:steps.size+(entry.symbolId?1:0),methods:seen.size,tables:tableList.map(([name])=>name),databases:databaseList.map(([name])=>name),readOnly:reads&&!writes,uncertain:!(tableList[0]?.[1]??databaseList[0]?.[1]??false)};
 }).sort((a,b)=>Number(!!(b.tables.length+b.databases.length))-Number(!!(a.tables.length+a.databases.length))||b.steps-a.steps||b.calls-a.calls||Number(b.readOnly)-Number(a.readOnly)||stableHash(a.entry.id)-stableHash(b.entry.id));
}

export function selectReadingStarts(index:ProjectIndex,entries:EntryPoint[],limit:number):ReadingStart[]{
 const ranked=readingStarts(index,entries),withData=ranked.filter(row=>row.tables.length||row.databases.length);
 return (withData.length?withData:ranked).slice(0,limit);
}
