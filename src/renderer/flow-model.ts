import type { Entity, EntryPoint, ProjectIndex, Relation, SymbolInfo, ViewState } from '../shared/model';
import type { GraphCard, GraphLink } from './graph-model';
import { entryGroups, isCallable, isTestFile } from './entry-model';
import { auxiliaryEntry, entryOutcome, pathLinks, hasConditions } from './reading-model';
import {unitBackbone} from './backbone-model';
export const relationLabels:Record<string,string>={CALLS:'调用',HTTP:'HTTP',READS:'读取',WRITES:'写入',IMPORTS:'导入',EXTENDS:'继承',IMPLEMENTS:'实现',INJECTS:'注入'};
const flowTypes=new Set(['CALLS','HTTP','READS','WRITES']);
export const applicable=(r:Relation,view:ViewState)=>view.showAll||r.rule?.applicability!=='excluded';
export function reach(index:ProjectIndex,start:string,max=6){
 const seen=new Set<string>(),queue:{id:string;depth:number}[]=[{id:start,depth:0}];
 while(queue.length){const {id,depth}=queue.shift()!;if(seen.has(id))continue;seen.add(id);if(depth>=max)continue;for(const r of index.relations.filter(r=>flowTypes.has(r.type)&&r.from===id&&r.to&&!r.auxiliary&&r.rule?.applicability!=='excluded'))queue.push({id:r.to!,depth:depth+1});}return seen;
}
const rankedEntries=new WeakMap<ProjectIndex,{entry:EntryPoint;score:number;reason:string}[]>();
export function recommendations(index:ProjectIndex,entries=index.entries||[]){
 const cached=rankedEntries.get(index);if(cached)return cached.filter(r=>entries.some(e=>e.id===r.entry.id));
 const localReach=(start:string)=>{const seen=new Set<string>(),queue=[start];while(queue.length){const id=queue.shift()!;if(seen.has(id))continue;seen.add(id);for(const r of index.relations)if(r.type==='CALLS'&&r.from===id&&r.to&&!r.auxiliary)queue.push(r.to);}return seen;};
 const httpSources=(index.entries||[]).filter(e=>e.kind==='http'&&e.symbolId).map(e=>localReach(e.symbolId!));
 const ranked=(index.entries||[]).map(entry=>{
  const reached=entry.symbolId?reach(index,entry.symbolId):new Set<string>(),relations=index.relations.filter(r=>reached.has(r.from)&&applicable(r,{} as ViewState));
  const cross=relations.some(r=>r.type==='HTTP'&&!!r.to&&index.symbols.some(s=>s.id===r.to)),write=relations.some(r=>r.type==='WRITES'),read=relations.some(r=>r.type==='READS');
  const auxiliary=entry.kind!=='http'||isTestFile(entry.location.file,index);
  const unknown=relations.filter(r=>(r.status==='unresolved'||r.status==='candidate')&&!r.auxiliary).length;
  const roles=new Set(index.symbols.filter(s=>reached.has(s.id)).map(s=>s.role||index.symbols.find(p=>p.id===s.parent)?.role).filter(Boolean));
  const bridged=index.relations.some(r=>r.type==='HTTP'&&r.to===entry.symbolId&&httpSources.some(s=>s.has(r.from))),creates=entry.name.startsWith('POST ')&&index.symbols.find(s=>s.id===entry.symbolId)?.name==='create'&&relations.some(r=>r.type==='WRITES'&&r.data?.sql&&/^\s*INSERT\b/i.test(r.data.sql));
  return {entry,score:(cross?100:0)+(bridged?40:0)+(write?35:0)+(read?20:0)+Math.min(roles.size,3)*4+(entry.name.startsWith('POST ')?12:0)+(creates?8:0)-Math.min(unknown,8)-(auxiliary?200:0),reason:cross||bridged?'跨服务 HTTP 与数据来源':write?'包含真实数据写入':read?'包含真实数据读取':auxiliary?'辅助 / 健康入口':'HTTP 业务入口'};
 }).sort((a,b)=>b.score-a.score||b.entry.name.localeCompare(a.entry.name));
 rankedEntries.set(index,ranked);return ranked.filter(r=>entries.some(e=>e.id===r.entry.id));
}
export function entityCard(_index:ProjectIndex,entity:Entity):GraphCard{
 const summary=entity.kind==='resource'?({database:'业务数据',table:'数据表',vector:'向量检索',cache:'缓存',queue:'消息队列',search:'搜索',file:'本地状态',model:'模型调用',external:'外部系统'}[entity.resourceKind||'external']):undefined;
 return {id:entity.id,kind:entity.kind,name:entity.name,subtitle:entity.summary,summary,tag:entity.resourceKind||entity.kind,entity,serviceId:entity.serviceId,callers:0,callees:0};
}
export function guideGraph(index:ProjectIndex,view:ViewState){
 const scope=index.entities?.find(e=>e.id===view.focus),rank=recommendations(index),service=(id?:string)=>index.symbols.find(s=>s.id===id)?.serviceId;
 const allowed=scope?new Set((index.entries||[]).filter(e=>scope.kind==='domain'?scope.entryIds?.includes(e.id):service(e.symbolId)===scope.id).map(e=>e.id)):undefined;
 const cards=entryGroups(index,view.filter,view.showTests).map(g=>({...g,entries:g.entries.filter(e=>!allowed||allowed.has(e.id))})).filter(g=>g.entries.length&&(view.showAll||g.entries[0].kind==='http')).map(group=>{
  const entries=rank.filter(r=>group.entries.some(e=>e.id===r.entry.id)).map(r=>r.entry),symbol=index.symbols.find(s=>s.id===entries[0]?.symbolId),serviceName=index.entities?.find(e=>e.id===symbol?.serviceId)?.name;
  const main=entries.filter(e=>!auxiliaryEntry(e)),paths=(main.length?main:entries).map(e=>e.name.split(' · ')[0].split(' ')[1]?.split('/')||[]);let common=0;if(paths.length)while(common<paths[0].length&&paths.every(p=>p[common]===paths[0][common]))common++;const name=entries[0].moduleName||paths[0]?.slice(0,common).join('/')||group.name;
  return {id:group.id,name,subtitle:group.owner,tag:'',kind:'entry-group' as const,entries,destinations:Object.fromEntries(entries.map(e=>[e.id,entryOutcome(index,e)])),section:serviceName||group.area,callers:0,callees:0,compact:false};
 });return cards.length?{cards,links:[],omitted:0}:mainGraph(index,view);
}
export function symbolCard(index:ProjectIndex,s:SymbolInfo,depth=0):GraphCard{
 const parent=index.symbols.find(p=>p.id===s.parent),entry=index.entries?.find(e=>e.symbolId===s.id&&e.kind==='http');
 return {id:s.id,kind:isCallable(s)?'symbol':'type',name:parent&&isCallable(parent)||!parent?s.name:parent.name+'.'+s.name,subtitle:s.file,summary:s.summary||parent&&['class','interface'].includes(parent.kind)&&parent.summary||(index.relations.some(r=>r.from===s.id&&['READS','WRITES'].includes(r.type))?'数据访问':undefined),tag:s.role||parent?.role||'方法',symbol:s,serviceId:s.serviceId,lane:depth,route:entry?.name.split(' · ')[0],callers:0,callees:0};
}
export function linksFor(relations:Relation[],representative:(id:string)=>string|undefined,view:ViewState,keepSelf=false):GraphLink[]{
 const groups=new Map<string,GraphLink>();
 for(const r of relations){if(!r.to||!applicable(r,view))continue;const source=representative(r.from),target=representative(r.to);if(!source||!target||source===target&&!(keepSelf&&r.from===r.to))continue;const key=`${source}|${target}|${r.type}`;
  const previous=groups.get(key);if(previous){if(!previous.relations.some(v=>v.id===r.id))previous.relations.push(r);if(previous.status!==r.status)previous.status='mixed';}
  else groups.set(key,{id:key,source,target,type:r.type,label:relationLabels[r.type]||r.type,status:r.status,relations:[r]});
 }return [...groups.values()];
}
export function mainGraph(index:ProjectIndex,view:ViewState){
 if(index.units?.length)return unitBackbone(index,view);
 const entities=index.entities||[],services=entities.filter(e=>e.kind==='service'),domains=entities.filter(e=>e.kind==='domain');
 const rank=recommendations(index),score=(d:Entity)=>Math.max(0,...rank.filter(r=>d.entryIds?.includes(r.entry.id)).map(r=>r.score));
 const bySymbol=new Map(index.symbols.map(s=>[s.id,s])),byEntity=new Map(entities.map(e=>[e.id,e]));
 const scope=domains.find(d=>d.id===view.reading?.scope),scopeEntries=(index.entries||[]).filter(e=>scope?.entryIds?.includes(e.id));
 const scopeRelations=scope?new Set(scopeEntries.flatMap(e=>entryOutcome(index,e).relationIds)):undefined;
 const raw=index.relations.filter(r=>['HTTP','READS','WRITES'].includes(r.type)&&r.to&&applicable(r,view)&&(view.showAll||view.showTests||!isTestFile(bySymbol.get(r.from)?.file||'',index))&&(!scopeRelations||scopeRelations.has(r.id)));
 const cards:GraphCard[]=services.map(service=>{
  const capabilities=domains.filter(d=>d.serviceId===service.id).sort((a,b)=>score(b)-score(a)||a.name.localeCompare(b.name)).map(d=>{
   const entries=(index.entries||[]).filter(e=>d.entryIds?.includes(e.id)),major=entries.filter(e=>!auxiliaryEntry(e));
   const paths=major.map(e=>e.name.split(' · ')[0].split(' ')[1]?.split('/')||[]);let common=0;if(paths.length)while(common<paths[0].length&&paths.every(p=>p[common]===paths[0][common]))common++;
   const prefix=paths[0]?.slice(0,common).join('/');return{id:d.id,name:prefix?.split('/').filter(Boolean).at(-1)||d.name,count:entries.length,auxiliary:!major.length};
  });
  return{...entityCard(index,service),capabilities,compact:view.expanded.includes(service.id)?false:undefined,stack:/FastAPI/.test(service.summary)?'FastAPI':/Spring/.test(service.summary)?'Spring Boot':undefined,section:undefined};
 });
 const grouped=new Map<string,GraphLink>();
 for(const r of raw){
  const source=bySymbol.get(r.from)?.serviceId,resource=byEntity.get(r.to!),target=resource?.kind==='resource'?(resource.parentId||resource.id):bySymbol.get(r.to!)?.serviceId;
  if(!source||!target||source===target||!services.some(s=>s.id===source))continue;
  const type=r.type==='HTTP'?'HTTP':'DATA',configuration=r.rule?.configuration||index.configurationId;
  const conditional=hasConditions(r);
  const signature=JSON.stringify([configuration,r.rule?.outcome==='unique'?'resolved':r.status]);
  const id=`system:${source}|${target}|${type}|${signature}`;
  let link=grouped.get(id);if(!link){link={id,source,target,type,label:type==='HTTP'?'HTTP':'数据访问',status:r.rule?.outcome==='unique'?'resolved':r.status,conditional,optional:conditional,configuration,relations:[],entryIds:[]};grouped.set(id,link);}else{link.conditional ||= conditional;link.optional &&= conditional;}
  if(!link.relations.some(e=>e.id===r.id))link.relations.push(r);
 }
 const links=[...grouped.values()];
 for(const link of links){link.entryIds=(index.entries||[]).filter(e=>e.symbolId&&entryOutcome(index,e).relationIds.some(id=>link.relations.some(r=>r.id===id))).map(e=>e.id);link.feedback=false;if(link.optional)link.label='配置推测';}
 const resources=entities.filter(e=>e.kind==='resource'&&links.some(l=>l.target===e.id));
 cards.push(...resources.map(e=>({...entityCard(index,e),vertical:true})));
 if(!domains.length){
  const modules=[...new Set(index.files.filter(f=>!isTestFile(f.path,index)).map(f=>f.module))];
  for(const module of modules.slice(0,8))cards.push({id:`module:${module}`,kind:'module',name:module.split('.').slice(-2).join('.'),subtitle:module,tag:'文件',count:index.files.filter(f=>f.module===module).length,callers:0,callees:0});
  if(!modules.length)for(const file of (index.frontendFiles||[]).slice(0,8))cards.push({id:`file:${file.path}`,kind:'file',name:file.path.split('/').at(-1)!,subtitle:file.path,tag:'前端文件',callers:0,callees:0});
 }
 return {cards,links,omitted:0};
}
export function sceneGraph(index:ProjectIndex,view:ViewState,initialBudget=15){
 const byId=new Map(index.symbols.map(s=>[s.id,s])),entities=new Map((index.entities||[]).map(e=>[e.id,e])),pathTarget=view.reading?.isolate==='path'?view.reading.target:undefined,root=byId.get(pathTarget?view.reading?.origin||view.focus||'':view.focus||'');if(!root)return {cards:[],links:[],omitted:0};
 const cards:GraphCard[]=[],visible=new Set<string>(),depths=new Map<string,number>(),hidden=new Map<string,string[]>(),expanded=new Set(view.expanded);
 let relations=index.relations.filter(r=>flowTypes.has(r.type)&&applicable(r,view));
 if(pathTarget){const allowed=new Set(pathLinks(relations.filter(r=>r.to).map(r=>({id:r.id,source:r.from,target:entities.get(r.to!)?.parentId===pathTarget?pathTarget:r.to!,type:r.type,label:'',status:r.status,relations:[r]})),root.id,pathTarget).map(r=>r.id));relations=relations.filter(r=>allowed.has(r.id));}
 const leads=(id:string,seen=new Set<string>(),depth=0):boolean=>{if(depth>6||seen.has(id))return false;seen.add(id);return relations.some(r=>r.from===id&&(r.type==='HTTP'||r.type==='READS'||r.type==='WRITES'||!!r.to&&leads(r.to,new Set(seen),depth+1)));};
 const eligible=(id:string)=>{const s=byId.get(id);return !!entities.get(id)||!!s&&(view.showAll||isCallable(s)&&!s.auxiliary&&s.kind!=='constructor'&&!['record_declaration','enum_declaration'].includes(byId.get(s.parent||'')?.declaration||''));};
 const queue=[{id:root.id,depth:0}],budget=view.showAll||pathTarget?60:Math.min(60,initialBudget+expanded.size*5);
 while(queue.length){const {id,depth}=queue.shift()!;if(visible.has(id)||visible.size>=budget)continue;visible.add(id);depths.set(id,depth);
  const outgoing=[...new Set(relations.filter(r=>r.from===id&&r.to&&(view.showAll||!r.auxiliary)&&(r.status==='resolved'||r.rule?.outcome==='unique'||view.showAll||expanded.has(id)||expanded.has(r.to))).map(r=>r.to!))].filter(target=>eligible(target)||expanded.has(target));
  outgoing.sort((a,b)=>Number(leads(b))-Number(leads(a))||Number(!!entities.get(b))-Number(!!entities.get(a)));
  const limit=expanded.has(id)||view.showAll?60:5;
  const boundary=outgoing.some(target=>entities.has(target)||leads(target));
  for(const [i,target] of outgoing.entries())if((!boundary||leads(target)||entities.has(target)||expanded.has(id)||expanded.has(target)||view.showAll||pathTarget)&&(depth<(pathTarget?32:6)||expanded.has(id))&&(i<limit||expanded.has(target)||pathTarget)&&visible.size+queue.length<budget)queue.push({id:target,depth:depth+1});else hidden.set(id,[...(hidden.get(id)||[]),target]);
 }
 for(const id of visible){const symbol=byId.get(id),entity=entities.get(id),card=entity?entityCard(index,entity):symbolCard(index,symbol!,depths.get(id));card.lane=depths.get(id);card.focus=id===root.id;card.entry=id===root.id;card.compact=false;
  card.section=index.entities?.find(e=>e.id===(symbol?.serviceId||entity?.serviceId))?.name;
  const calls=relations.filter(r=>r.from===id),unknown=calls.filter(r=>(r.status==='unresolved'||r.status==='candidate')&&r.rule?.outcome!=='unique'&&!r.auxiliary);
  const models=calls.filter(r=>!r.to&&r.status==='resolved'&&index.symbols.some(s=>['class','interface'].includes(s.kind)&&(r.target.startsWith(s.qualifiedName+'.')||r.target.startsWith(s.qualifiedName+'('))));
  card.unknownRelations=unknown.map(r=>r.id);card.modelRelations=models.map(r=>r.id);card.toolRelations=calls.filter(r=>!r.to&&r.status==='resolved'&&!models.includes(r)).map(r=>r.id);card.hidden=(hidden.get(id)||[]).filter(id=>!visible.has(id));
  card.leaf=!calls.some(r=>r.to&&eligible(r.to))&&!unknown.length;card.entry=index.entries?.find(e=>e.id===view.entryId)?.symbolId===id;
  cards.push(card);
 }
 const links=linksFor(relations,id=>visible.has(id)?id:undefined,view,true);
 const reaches=(start:string,target:string,seen=new Set<string>()):boolean=>{if(start===target)return true;if(seen.has(start))return false;seen.add(start);return links.filter(l=>l.source===start).some(l=>reaches(l.target,target,seen));};
 for(const link of links)link.feedback=reaches(link.target,link.source);
 return {cards,links,omitted:0};
}
export function readingPath(index:ProjectIndex,links:GraphLink[],start?:string){
 const chosen=new Set<string>(),seen=new Set<string>();let current=start;
 while(current&&!seen.has(current)&&seen.size<15){seen.add(current);const options=links.filter(l=>l.source===current&&!seen.has(l.target));
  const score=(link:GraphLink)=>{const reached=reach(index,link.target),cross=index.relations.some(r=>reached.has(r.from)&&r.type==='HTTP'&&r.to&&r.rule?.applicability!=='excluded');return(link.type==='HTTP'?400:0)+(cross?200:0)+(['READS','WRITES'].includes(link.type)?80:0);};
  options.sort((a,b)=>score(b)-score(a));const next=options[0];if(!next)break;chosen.add(next.id);current=next.target;
 }return chosen;
}
