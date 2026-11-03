import type { ProjectIndex, ViewState, SymbolInfo, Relation, Language, EntryPoint, Entity, Location } from '../shared/model';
import { mainGraph, sceneGraph, guideGraph } from './flow-model';
import { dependencyGraph } from './dependency-model';
import { isCallable, isTestFile, symbolCategory } from './entry-model';
import { filterReading } from './reading-model';
import { explorationGraph } from './exploration-graph';
export interface GraphCard {
  dependencyLane?:{id:string;common:boolean;users:string[];uses:string[];compact:boolean;order:number};
  hierarchy?:{module?:import('./hierarchy-model').HierarchyModule;groups?:import('./hierarchy-model').HierarchyGroup[];frontend?:boolean;resource?:import('./hierarchy-model').ResourceUsage};
  backendChoice?:{selected?:import('../shared/frontend-links').FrontendTarget;units:{id:string;name:string}[];addresses:{unitId:string;address:string;profile:string;location:Location}[]};
  appearance?:{density:import('./adaptive-look').GraphDensity;role:import('./adaptive-look').CardRole;scale:number;tiles:boolean};
  unit?:{id:string;kind:'application'|'frontend';interfaceCount:number;notice?:string};
  resource?:import('../shared/model').DiscoveredResource;external?:{origin:string;location:import('../shared/model').Location};explanation?:string;
  foldedCards?:GraphCard[];foldedLinks?:GraphLink[];
  frontend?:{pages:{id:string;name:string;callIds:string[]}[];calls:{id:string;name:string;location:import('../shared/model').Location;targets:{name:string;location:import('../shared/model').Location;entry?:EntryPoint}[];state:string}[];matched:number;unmatched:number;reason?:string};
  dependency?:{role:string;layer:number;color:string;classes:number;unitIds:string[];location?:import('../shared/model').Location;basis:string;folded?:boolean;side?:boolean;parent?:string};
  id:string; name:string; subtitle:string; tag:string; kind:'module'|'symbol'|'group'|'file'|'type'|'entry-group'|'more'|'service'|'domain'|'resource'|'anchor'|'browser';
  runtimeCall?:string;
  runtimeExpansion?:{domainId:string;calls:string[];height:number};
  ownerId?:string;local?:{x:number;y:number};canvasSize?:{width:number;height:number};
  explorationFlowOrigin?:{x:number;y:number};
  inline?:{domainId:string;name:string;entries:EntryPoint[];top:number;height:number;stage:'interfaces'|'chain';entryId?:string};
  symbol?:SymbolInfo; members?:string[]; rows?:SymbolInfo[]; count?:number; focus?:boolean;
  callers:number; callees:number; language?:Language; section?:string; lane?:number; cycle?:boolean;
  entries?:EntryPoint[]; compact?:boolean; boundary?:string; entry?:boolean;
  entity?:Entity;serviceId?:string;summary?:string;route?:string;recommended?:boolean;unknownRelations?:string[];toolRelations?:string[];hidden?:string[];leaf?:boolean;
  vertical?:boolean;innerRelations?:string[];
  entryPoint?:EntryPoint;
  modelRelations?:string[];
  capabilities?:{id:string;name:string;count:number;auxiliary:boolean}[]; stack?:string;
  destinations?:Record<string,import('./reading-model').EntryOutcome>;
}
export interface GraphLink {id:string;source:string;target:string;label:string;status:string;relations:Relation[];type:string;tooltip?:string;kinds?:string[];context?:boolean;feedback?:boolean;conditional?:boolean;optional?:boolean;configuration?:string;entryIds?:string[]}
export const relationNames:Record<string,string>={CALLS:'调用',IMPORTS:'导入',EXTENDS:'继承',IMPLEMENTS:'实现',HTTP:'HTTP 通信',READS:'读取',WRITES:'写入',INJECTS:'注入',MAPS:'对应'};
const shortModule=(name:string)=>name.includes(' · ')?name.split(' · ').at(-1)!.split('.').slice(-2).join('.'):name.includes('/')?name:name.split('.').slice(-2).join('.');
export interface GraphResult {cards:GraphCard[];links:GraphLink[];omitted:number;dependencyRelations?:Relation[];dependencyUnitIds?:string[];dependencyScope?:ViewState['dependencyScope']}
export function graphFor(index:ProjectIndex,view:ViewState):GraphResult {
  const target=view.exploration&&index.entities?.find(e=>e.id===view.reading?.target)?.parentId;
  const graph=baseGraphFor(index,view),filtered=filterReading(graph,target?{...view,reading:{...view.reading,target}}:view);
  if(view.exploration&&view.reading?.isolate){const owners=new Set(filtered.cards.map(c=>c.ownerId));for(const card of graph.cards)if(owners.has(card.id)&&!filtered.cards.some(c=>c.id===card.id))filtered.cards.push(card);}
  return filtered;
}
function baseGraphFor(index:ProjectIndex,view:ViewState):GraphResult {
  if(view.level==='main')return view.exploration?explorationGraph(index,view):mainGraph(index,view);
  if(view.level==='overview')return dependencyGraph(index,view);
  if(view.level==='guide')return guideGraph(index,view);
  if(view.level==='function'&&view.entryId&&view.direction!=='callers')return sceneGraph(index,view);
  const cards:GraphCard[]=[], links:GraphLink[]=[];
  const representatives=new Map<string,string>();
  const symbols=index.symbols.filter(s=>view.filter==='all'||s.language===view.filter);
  const byId=new Map(index.symbols.map(s=>[s.id,s]));
  const files=index.files.filter(f=>view.filter==='all'||f.language===view.filter);
  const entityFile=(id:string)=>id.startsWith('file:')?id.slice(5):byId.get(id)?.file;
  const count=(id:string,direction:'from'|'to')=>new Set(index.relations.filter(r=>r.type==='CALLS'&&r[direction]===id&&r.to).map(r=>direction==='to'?r.from:r.to)).size;
  const addSymbol=(s:SymbolInfo,focus=false,lane=0)=>{
    if(cards.some(c=>c.id===s.id))return;
    const parent=byId.get(s.parent||'');
    cards.push({id:s.id,name:isCallable(s)&&parent?`${parent.name}.${s.name}`:s.name,subtitle:`${s.file.split('/').at(-1)}:${s.selection.start.line+1}`,tag:isCallable(s)&&parent?.role?`${parent.role} · 方法`:symbolCategory(index,s),kind:isCallable(s)?'symbol':'type',symbol:s,focus,lane,language:s.language,callers:count(s.id,'to'),callees:count(s.id,'from'),entry:!!view.entryId&&!!index.entries?.some(e=>e.symbolId===s.id&&e.id===view.entryId)});
  };
  if(view.level==='file'||view.level==='class'){
    const owner=symbols.find(s=>s.id===view.focus);
    if(view.level==='class'&&owner&&view.relationFilter==='types'){
      const relations=index.relations.filter(r=>['EXTENDS','IMPLEMENTS'].includes(r.type)&&(r.from===owner.id||r.to===owner.id));const ids=new Set([owner.id,...relations.flatMap(r=>[r.from,r.to||''])]);for(const s of symbols.filter(s=>ids.has(s.id)))addSymbol(s,s.id===owner.id);
      return {cards,links:relations.filter(r=>r.to&&ids.has(r.to)).map(r=>({id:r.id,source:r.from,target:r.to!,label:relationNames[r.type],status:r.status,relations:[r],type:r.type})),omitted:0};
    }
    const members=view.level==='file'?symbols.filter(s=>s.file===view.focus&&!s.parent):symbols.filter(s=>s.parent===view.focus);
    if(!members.length&&owner)addSymbol(owner,true);
    for(const s of members.slice(0,24)){addSymbol(s);if(!isCallable(s))cards.at(-1)!.rows=symbols.filter(child=>child.parent===s.id).slice(0,6);}
    if(members.length>24)cards.push({id:'more',name:`另有 ${members.length-24} 个成员`,subtitle:'在搜索或详情中查看全部',tag:'按需聚焦',kind:'more',callers:0,callees:0});
  } else if(view.level==='module') {
    const moduleFiles=files.filter(f=>f.module===view.focus&&(view.showTests||!isTestFile(f.path,index)));
    for(const file of moduleFiles.slice(0,20)){
      const members=symbols.filter(s=>s.file===file.path);
      const rows=[...members].sort((a,b)=>Number(!!b.routes.length)-Number(!!a.routes.length)||a.selection.start.line-b.selection.start.line).slice(0,6);
      const id=`file:${file.path}`;
      const roots=members.filter(s=>!s.parent),types=roots.length>0&&roots.every(s=>s.kind==='interface'||['enum_declaration','record_declaration'].includes(s.declaration||'')||symbolCategory(index,s)==='异常类型');
      cards.push({id,name:file.path.split('/').at(-1)!,subtitle:file.path,tag:file.language==='java'?'JAVA · 文件':'PYTHON · 文件',kind:'file',language:file.language,rows,count:members.length,callers:0,callees:0,section:isTestFile(file.path,index)?'测试':types?'类型 / 接口':'实现'});
      for(const symbol of members)representatives.set(symbol.id,id);
    }
    if(moduleFiles.length>20)cards.push({id:'more',name:`另有 ${moduleFiles.length-20} 个文件`,subtitle:'在左侧搜索文件或方法以继续',tag:'按需聚焦',kind:'more',callers:0,callees:0});
  } else {
    const focused=symbols.find(s=>s.id===view.focus);if(!focused||!isCallable(focused))return {cards,links,omitted:0};
    addSymbol(focused,true);
    const seeds=new Set([focused.id,...view.expanded]);
    const direction=view.direction||'both';
    const adjacent=index.relations.filter(r=>r.type==='CALLS'&&r.to&&((direction!=='callers'&&seeds.has(r.from))||(direction!=='callees'&&seeds.has(r.to))));
    const candidates=new Set(adjacent.flatMap(r=>[r.from,r.to!]).filter(id=>symbols.some(s=>s.id===id)));
    const lanes=new Map<string,number>([[focused.id,0]]);
    for(const r of adjacent)if(r.from===focused.id&&r.to!==focused.id)lanes.set(r.to!,1);
    for(const r of adjacent)if(r.to===focused.id&&r.from!==focused.id&&!lanes.has(r.from))lanes.set(r.from,-1);
    for(let i=0;i<seeds.size;i++)for(const r of adjacent){
      if(seeds.has(r.from)&&lanes.has(r.from)&&!lanes.has(r.to!))lanes.set(r.to!,Math.max(1,lanes.get(r.from)!+1));
      if(seeds.has(r.to!)&&lanes.has(r.to!)&&!lanes.has(r.from))lanes.set(r.from,Math.min(-1,lanes.get(r.to!)!-1));
    }
    const lane=(id:string)=>lanes.get(id)||0;
    const limit=candidates.size>60?59:60;
    const priority=(id:string)=>{const s=byId.get(id)!,parent=byId.get(s.parent||'');return parent?.kind==='interface'?3:count(id,'from')>0?2:parent?.role?1:0;};
    const collapsed=[...candidates].filter(id=>id!==focused.id&&!seeds.has(id));
    if(view.entryId)collapsed.sort((a,b)=>priority(b)-priority(a));
    const grouped=candidates.size>6?new Set(collapsed.slice(view.entryId?3:2)):new Set<string>();
    for(const id of candidates){const s=byId.get(id)!;if(!grouped.has(id)&&cards.length<limit)addSymbol(s,false,lane(id));}
    const buckets=new Map<string,SymbolInfo[]>();
    for(const id of grouped){const s=byId.get(id)!;const key=`group:${s.language}:${s.module}:${lane(id)}`;buckets.set(key,[...(buckets.get(key)||[]),s]);}
    for(const [id,members] of buckets){
      if(cards.length>=limit)break;if(members.length===1){addSymbol(members[0],false,lane(members[0].id));continue;}
      cards.push({id,name:shortModule(members[0].module),subtitle:`${members.length} 个相邻代码项 · 展开查看`,tag:'相邻代码项组',kind:'group',language:members[0].language,members:members.map(s=>s.id),count:members.length,lane:members.some(s=>lane(s.id)>0)?1:-1,callers:0,callees:0});
      for(const member of members)representatives.set(member.id,id);
    }
    const remaining=[...candidates].filter(id=>!representatives.has(id)&&!cards.some(c=>c.id===id)).length;
    if(remaining)cards.push({id:'more',name:`另有 ${remaining} 个相关代码项`,subtitle:'请搜索并聚焦继续追踪',tag:'图预算 · 60 节点',kind:'more',callers:0,callees:0,lane:2});
  }
  const cardIds=new Set(cards.map(c=>c.id)), groups=new Map<string,GraphLink>();
  for(const r of index.relations){
    if(!r.to)continue;let from=r.from,to=r.to;
    if(view.level==='module'){from=`file:${entityFile(from)}`;to=`file:${entityFile(to)}`;if(from===to)continue;if(!['CALLS','IMPORTS','EXTENDS','IMPLEMENTS'].includes(r.type))continue;}
    else {
      if(r.type!=='CALLS')continue;
      if(view.direction==='callers'&&!new Set([view.focus,...view.expanded]).has(r.to))continue;
      if(view.direction==='callees'&&!new Set([view.focus,...view.expanded]).has(r.from))continue;
      from=representatives.get(from)||from;to=representatives.get(to)||to;
    }
    if(!cardIds.has(from)||!cardIds.has(to))continue;
    const aggregate=view.level!=='function';
    const key=aggregate?`${from}|${to}|${r.type}`:`${from}|${to}|${r.type}|${r.status}`;
    let link=groups.get(key);
    if(!link){link={id:key,source:from,target:to,label:relationNames[r.type],status:r.status,relations:[],type:r.type};groups.set(key,link);}
    link.relations.push(r);if(link.status!==r.status)link.status='mixed';
  }
  for(const link of groups.values()){
    const n=link.relations.reduce((sum,r)=>sum+r.locations.length,0);
    if(n>1)link.label+=` ×${n}`;links.push(link);
  }
  for(const card of cards){card.compact=view.density==='compact';if(card.symbol&&isCallable(card.symbol)){const calls=index.relations.filter(r=>r.type==='CALLS'&&r.from===card.id);const unknown=calls.filter(r=>!r.to&&r.status==='unresolved').length,unmapped=calls.filter(r=>!r.to&&r.status!=='unresolved').length;card.boundary=unknown?`${unknown} 未解析`:unmapped?`${unmapped} 无本地定义`:!calls.some(r=>r.to)?'未见已解析内部调用':undefined;}}
  return {cards,links:links.slice(0,120),omitted:Math.max(0,links.length-120)};
}
