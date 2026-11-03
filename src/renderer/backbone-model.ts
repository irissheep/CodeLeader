import type {DiscoveryEvidence,Evidence,ProjectIndex,ViewState} from '../shared/model';
import type {GraphCard,GraphLink} from './graph-model';
import policy from '../shared/backbone-policy.json';
import discovery from '../shared/discovery-signals.json';
import {applicable,entityCard,recommendations} from './flow-model';
import {isTestFile} from '../shared/source-roles';
import {auxiliaryEntry} from './reading-model';
import {withFrontendTargets} from '../shared/frontend-targets';

const inside=(file:string,root:string)=>!root||file===root||file.startsWith(root+'/');
const evidence=(items:DiscoveryEvidence[]):Evidence[]=>items.map(item=>({kind:item.source==='configuration'||item.source==='connection'||item.source==='compose'?'config':'declaration',location:item.location,note:item.note}));
const once=<T>(items:T[],key:(item:T)=>string)=>[...new Map(items.map(item=>[key(item),item])).values()];
export const visibleCapabilities=(card:GraphCard)=>card.compact===false?card.capabilities||[]:card.unit&&((card.capabilities?.length||0)>policy.thresholds.moduleRows.value)?[]:(card.capabilities||[]).filter(c=>!c.auxiliary).slice(0,policy.thresholds.moduleRows.value);
export const unitNoticeHeight=(card:GraphCard)=>card.unit?.notice?48:0;
export const capabilityHeight=(card:GraphCard)=>card.unit&&!card.inline&&!card.runtimeExpansion?Math.min(Math.ceil(visibleCapabilities(card).length/2)*52,policy.thresholds.detailsHeight.value):Math.ceil(visibleCapabilities(card).length/2)*52;

/** Rendering projection only. R2/R4/R5 facts and backend identities remain untouched. */
export function unitBackbone(index:ProjectIndex,view:ViewState){
 index=withFrontendTargets(index,view.frontendTargets);
 const units=index.units||[],applications=units.filter(u=>u.kind==='application'),shown=units.filter(u=>(u.kind==='application'||u.kind==='frontend')&&(view.filter==='all'||u.language===view.filter));
 const unitCard=new Map(shown.map(u=>[u.id,u.serviceId&&applications.filter(a=>a.serviceId===u.serviceId).length===1?u.serviceId:u.id]));
 const owner=(file:string)=>{const u=units.filter(u=>inside(file,u.root)).sort((a,b)=>b.root.length-a.root.length)[0];return u?.kind==='library'?u.usedBy:u?[u.id]:[];};
 const symbol=new Map(index.symbols.map(s=>[s.id,s])),entities=index.entities||[],byEntity=new Map(entities.map(e=>[e.id,e]));
 const from=(id:string)=>{const s=symbol.get(id);return s?owner(s.file).map(id=>unitCard.get(id)).find(Boolean)||shown.find(u=>u.serviceId===s.serviceId)&&s.serviceId:unitCard.get(id);};
 const rank=recommendations(index),cards:GraphCard[]=[],links:GraphLink[]=[],domainScores=new Map<string,number>();for(const domain of entities.filter(e=>e.kind==='domain'))domainScores.set(domain.id,Math.max(0,...rank.filter(r=>domain.entryIds?.includes(r.entry.id)).map(r=>r.score)));
 for(const unit of shown){const id=unitCard.get(unit.id)!,service=entities.find(e=>e.id===unit.serviceId),name=unit.root||index.name;
  if(unit.kind==='frontend'){
   const modules=index.frontend?.modules.filter(m=>(m.unitId===unit.id||!m.unitId&&owner(m.file).includes(unit.id))&&!m.test)||[],moduleIds=new Set(modules.map(m=>m.id)),calls=index.frontend?.httpCalls.filter(c=>moduleIds.has(c.moduleId)&&!c.test)||[],pages=index.frontend?.pages.filter(p=>!p.test&&p.componentModuleIds.some(id=>moduleIds.has(id)))||[],results=index.frontendLinks?.calls.filter(c=>calls.some(call=>call.id===c.callId))||[];
   const matched=results.filter(c=>c.outcome==='matched').length,tools=(index.buildDeclarations||[]).filter(b=>unit.buildIds.includes(b.id)).flatMap(b=>b.declaredDependencies.map(d=>d.name)),tool=policy.frontendTools.find(t=>tools.includes(t.dependency));
   cards.push({id,kind:'service',name,subtitle:unit.root,tag:'前端',stack:[unit.framework,tool?.name].filter(Boolean).join(' · '),unit:{id:unit.id,kind:'frontend',interfaceCount:calls.length},frontend:{pages:pages.map(p=>({id:p.id,name:p.paths.join(' / ')||p.name,callIds:calls.filter(c=>c.pageIds.includes(p.id)).map(c=>c.id)})),calls:calls.map(c=>({id:c.id,name:(c.method==='UNKNOWN'?'方法未知':c.method)+' '+c.url,location:c.methodLocation,targets:(results.find(r=>r.callId===c.id)?.targets||[]).map(t=>({name:t.method+' '+t.path,location:t.location,entry:index.entries?.find(e=>e.id===t.entryId)})),state:results.find(r=>r.callId===c.id)?.outcome||'unmatched'})),matched,unmatched:calls.length-matched,reason:calls.length&&results.every(c=>c.reason==='unknown-address')?'没法确定调用了哪个后端':undefined},compact:!view.expanded.includes(id),callers:0,callees:0});continue;
  }
  const entries=(index.entries||[]).filter(e=>e.kind==='http'&&owner(e.location.file).includes(unit.id)&&!isTestFile(e.location.file,index)),domains=entities.filter(d=>d.kind==='domain'&&entries.some(e=>d.entryIds?.includes(e.id)));
  const capabilities=domains.map(d=>{const group=entries.filter(e=>d.entryIds?.includes(e.id));return{id:d.id,name:d.name,count:group.length,auxiliary:group.every(auxiliaryEntry)};}).sort((a,b)=>(domainScores.get(b.id)||0)-(domainScores.get(a.id)||0)||a.name.localeCompare(b.name));
  const controllers=once(entries.flatMap(e=>{const s=symbol.get(e.symbolId||'');return s?[symbol.get(s.parent||'')||s]:[];}),s=>s.file+':'+s.id),notice=capabilities.length===1?(unit.language==='java'&&controllers.length===1?'后端只有 1 个控制器，所以只有 1 个业务模块':unit.language==='python'?'只有 1 个路由文件，所以只有 1 个业务模块':undefined):undefined;
  cards.push({...(service?entityCard(index,service):{id,kind:'service' as const,name,subtitle:'',tag:unit.framework,callers:0,callees:0}),id,name,stack:unit.framework,capabilities,unit:{id:unit.id,kind:'application',interfaceCount:entries.length,notice},compact:view.expanded.includes(id)?false:undefined});
 }
 const raw=index.relations.filter(r=>['HTTP','READS','WRITES'].includes(r.type)&&r.to&&applicable(r,view)&&(view.showTests||!isTestFile(symbol.get(r.from)?.file||'',index))),resourceIds=new Map<string,string>();
 for(const resource of index.resources||[]){
  if(!resource.unitIds.some(id=>unitCard.has(id)||units.find(u=>u.id===id)?.usedBy.some(id=>unitCard.has(id))))continue;
  const signal=discovery.engines.find(e=>e.engine===resource.engine),matches=entities.filter(e=>e.kind==='resource'&&!e.parentId&&(e.id===resource.id||e.name.toLowerCase().startsWith(resource.engine.toLowerCase())||!!signal?.images&&new RegExp(signal.images,'i').test(e.name))).sort((a,b)=>raw.filter(r=>r.to===b.id||byEntity.get(r.to!)?.parentId===b.id).length-raw.filter(r=>r.to===a.id||byEntity.get(r.to!)?.parentId===a.id).length);
  const original=matches[0],id=original?.id||resource.id;resourceIds.set(resource.id,id);for(const e of matches)resourceIds.set(e.id,id);
  cards.push({...original?entityCard(index,original):{id,kind:'resource' as const,name:resource.engine,subtitle:'',tag:resource.kind,callers:0,callees:0},id,name:resource.engine,summary:policy.resourceLabels[resource.kind],resource:resource,vertical:true});
 }
 const root=(id:string)=>byEntity.get(id)?.parentId||id;
 for(const r of raw){const source=from(r.from),resource=byEntity.get(root(r.to!));let target=resource?resourceIds.get(resource.id)||resource.id:from(r.to!),inferred=false,basis:Evidence[]=[];
  if(resource?.id.endsWith(':unbound')){const candidates=(index.resources||[]).filter(r=>r.kind==='database'&&r.unitIds.some(id=>unitCard.get(id)===source||units.find(u=>u.id===id)?.usedBy.some(id=>unitCard.get(id)===source)));if(candidates.length===1){target=resourceIds.get(candidates[0].id);basis=evidence(candidates[0].basis);inferred=true;}}
  if(!source||!target||source===target)continue;
  if(resource&&!cards.some(c=>c.id===target))cards.push({...entityCard(index,resource),vertical:true});
  const type=r.type==='HTTP'?'HTTP':'DATA',id=`backbone:${source}:${target}:${type}`;let link=links.find(l=>l.id===id);if(!link){link={id,source,target,type,label:inferred?'配置推测':'',status:inferred?'candidate':'resolved',optional:inferred,tooltip:inferred?'表和读写位置有源码，数据库指向按项目设置推测':undefined,relations:[],entryIds:[]};links.push(link);}link.relations.push(inferred?{...r,rule:{id:'backbone.database-target',version:policy.version,outcome:'candidate',basis:[...r.rule?.basis||[],...basis],conditions:r.rule?.conditions||[]}}:r);
 }
 for(const resource of index.resources||[])for(const usage of resource.usages){const owners=units.find(u=>u.id===usage.unitId)?.kind==='library'?units.find(u=>u.id===usage.unitId)!.usedBy:[usage.unitId];for(const unitId of owners){const source=unitCard.get(unitId),target=resourceIds.get(resource.id);if(!source||!target||links.some(l=>l.source===source&&l.target===target))continue;const basis=evidence(usage.basis);if(!basis.length)continue;
  links.push({id:`backbone:usage:${source}:${target}`,source,target,type:'DATA',label:'配置推测',status:'candidate',optional:true,relations:[{id:`backbone:usage:${source}:${target}`,from:source,to:target,target:resource.engine,type:'IMPORTS',source:'framework-rules',status:'candidate',locations:basis.map(b=>b.location),rule:{id:'backbone.resource-usage',version:policy.version,outcome:'candidate',basis,conditions:[]}}]});
 }}
 for(const unitLink of index.frontendLinks?.units||[]){if(unitLink.kind==='embedded')continue;const source=unitCard.get(unitLink.from),target=unitCard.get(unitLink.to);if(!source||!target)continue;
  const calls=(index.frontendLinks?.calls||[]).filter(c=>[...unitLink.matched,...unitLink.unmatched,...unitLink.ambiguous].includes(c.callId));
  links.push({id:unitLink.id,source,target,type:'HTTP',label:unitLink.userSpecified?'用户指定':unitLink.matched.length?`调用 ${unitLink.matched.length} 处`:unitLink.pathOnly?.length?'按路径对上，地址未确认':'配置推测',status:unitLink.lineStyle==='solid'?'resolved':'candidate',optional:unitLink.lineStyle!=='solid',tooltip:unitLink.userSpecified?'用户指定的后端；没有写回项目源码':unitLink.pathOnly?.length?'按路径对上，地址未确认':undefined,relations:calls.flatMap(c=>{const targets=c.targets.length?c.targets:[undefined];return targets.map(t=>({id:c.id+':'+(t?.id||target),from:index.frontend?.httpCalls.find(a=>a.id===c.callId)?.symbolId||source,to:t?.symbolId||target,target:t?.path||target,type:'HTTP' as const,source:'framework-rules' as const,status:c.userTarget||c.outcome==='matched'?'resolved' as const:'candidate' as const,locations:[c.source],rule:{id:'backbone.frontend-link',version:policy.version,outcome:c.userTarget||c.outcome==='matched'?'unique' as const:'candidate' as const,basis:c.basis,conditions:[...t?.conditions||[],...c.userTarget?['用户指定，原始地址可能仍未写明']:[]]}}));})});
 }
 for(const unit of shown.filter(u=>u.kind==='frontend')){
  const calls=(index.frontendLinks?.calls||[]).filter(c=>c.fromUnitId===unit.id&&c.external),groups=new Map<string,typeof calls>();for(const call of calls){const key=call.external!.origin;groups.set(key,[...groups.get(key)||[],call]);}
  for(const [origin,group]of groups){const address=group[0].external!,id='backbone:external:'+origin,source=unitCard.get(unit.id)!;if(!cards.some(c=>c.id===id))cards.push({id,kind:'resource',name:`项目外接口 · ${address.host}:${address.port}`,subtitle:origin,summary:'项目外接口',tag:'external',callers:0,callees:0,vertical:true,external:{origin,location:address.location}});
   links.push({id:`backbone:external:${source}:${origin}`,source,target:id,type:'HTTP',label:`调用 ${group.length} 处`,status:'resolved',relations:group.map(c=>({id:c.id,from:index.frontend?.httpCalls.find(a=>a.id===c.callId)?.symbolId||source,to:id,target:origin,type:'HTTP',source:'framework-rules',status:'resolved',locations:[c.source],rule:{id:'backbone.external',version:policy.version,outcome:'unique',basis:c.basis,conditions:[]}}))});
  }
 }
 for(const link of links){if(link.type==='DATA'&&!link.optional){const places=once(link.relations.flatMap(r=>r.locations.map(l=>({r,l}))),({r,l})=>r.type+':'+l.file+':'+JSON.stringify(l.range));link.label=`读写 ${places.length} 处`;link.tooltip=link.relations.some(r=>r.rule?.information?.some(i=>i.code==='table-default')||r.rule?.basis.some(b=>/默认.*表名|表名.*默认/.test(b.note)))?'表名按框架默认规则推得，没读外部配置':undefined;}else if(!link.label)link.label='HTTP';}
 for(const card of cards){if(!links.some(l=>l.source===card.id||l.target===card.id))card.explanation=card.frontend?.reason||'这个单元没有发现与其他单元的连接';if(card.frontend&&card.unit&&(view.frontendTargets?.[card.unit.id]||index.frontendLinks?.calls.some(c=>c.fromUnitId===card.unit!.id&&c.addresses.some(a=>!a.known))))card.backendChoice={selected:view.frontendTargets?.[card.unit.id],units:applications.map(u=>({id:u.id,name:u.root||index.name})),addresses:index.frontendLinks?.servers||[]};}
 if(cards.length>policy.thresholds.topCards.value){const kept=cards.slice(0,policy.thresholds.topCards.value-1),rest=cards.slice(kept.length),ids=new Set(rest.map(c=>c.id)),id='backbone:more',grouped=new Map<string,GraphLink>();kept.push({id,kind:'group',name:`另有 ${rest.length} 个单元与资源`,subtitle:'',tag:'',callers:0,callees:0,foldedCards:rest,foldedLinks:links.filter(l=>ids.has(l.source)&&ids.has(l.target)),compact:!view.expanded.includes(id)});for(const link of links){const source=ids.has(link.source)?id:link.source,target=ids.has(link.target)?id:link.target,key=source+':'+target+':'+link.type;if(source===target)continue;const old=grouped.get(key);if(old)old.relations.push(...link.relations);else grouped.set(key,{...link,source,target,relations:[...link.relations]});}return{cards:kept,links:[...grouped.values()],omitted:rest.length};}
 return{cards,links,omitted:0};
}
