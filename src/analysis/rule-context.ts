import crypto from 'node:crypto';
import type { Entity, Location, Relation, RuleEvidence, SymbolInfo } from '../shared/model';
import type { StructureResult } from './structure';
import { configFacts } from './config-facts';
import { basis } from './code-facts';
import { isTestFile } from '../shared/source-roles';
export type RuleContext=ReturnType<typeof ruleContext>;
export function ruleContext(result:StructureResult,selection?:string){
 const {index,facts}=result,config=configFacts(result,selection),byId=new Map(index.symbols.map(s=>[s.id,s]));
 for(const component of index.components||[])if(component.kind==='java'){const ports=config.values.filter(v=>v.key==='server.port'&&(!component.root||v.location.file.startsWith(component.root+'/'))).map(v=>Number(v.value));if(new Set(ports).size===1&&ports[0]>0&&ports[0]<65536)component.port=ports[0];}
 index.entities=[];
 const entity=(item:Entity)=>{const old=index.entities!.find(e=>e.id===item.id);if(old){old.basis=[...old.basis,...item.basis.filter(b=>!old.basis.some(a=>JSON.stringify(a)===JSON.stringify(b)))];if(item.discoveredOnly===false){old.discoveredOnly=false;old.summary=item.summary;}return old;}index.entities!.push(item);return item;};
 for(const deployment of config.deployments){
  const resource=/^(mysql|postgres|mariadb|redis|mongo)(?::|$)/i.test(deployment.image||'');
  if(deployment.roots.length)entity({id:deployment.id,kind:'service',name:deployment.name,summary:deployment.module?`FastAPI · ${deployment.module}`:index.symbols.some(s=>['Controller','Service'].includes(s.role||'')&&deployment.roots.some(root=>s.file.startsWith(root+'/')))?'Spring 应用 · 独立部署声明':'应用部署 · 启动绑定待确认',sourceRoots:deployment.roots,basis:deployment.basis,location:deployment.basis[0].location});
  else if(resource)entity({id:`resource:${deployment.id}`,kind:'resource',name:deployment.image!.split(':')[0],resourceKind:deployment.image!.startsWith('redis')?'cache':'database',summary:'部署配置发现；是否访问取决于调用与条件',basis:deployment.basis,discoveredOnly:true,location:deployment.basis[0].location});
 }
 for(const s of index.symbols){const services=index.entities.filter(e=>e.kind==='service'&&e.sourceRoots?.some(root=>s.file.startsWith(root+'/')));s.serviceId=services.length===1?services[0].id:undefined;}
 // Without a deployment declaration, retain an application group; multiple source roots alone are not services.
 const unassigned=(index.entries||[]).filter(e=>e.symbolId&&!byId.get(e.symbolId)?.serviceId&&!isTestFile(e.location.file,index));
 const production=index.files.filter(f=>!isTestFile(f.path,index));
 if(unassigned.length||!index.entities.some(e=>e.kind==='service')&&(production.length||index.frontendFiles?.length)){
  const id='service:application',spring=index.components?.some(c=>c.framework==='Spring Boot');
  const component=index.components?.find(c=>c.kind==='java')||index.components?.[0];
  entity({id,kind:'service',name:index.name,summary:spring?'Spring 应用 · 源码分组':'项目源码',basis:unassigned.map(e=>basis('declaration',e.location,e.basis)),sourceRoots:index.sourceSets?.filter(s=>s.role==='production').map(s=>s.path)||[],location:component?.location||(production[0]?{file:production[0].path,range:{start:{line:0,character:0},end:{line:0,character:1}}}:undefined)});
  for(const s of index.symbols)if(!s.serviceId&&!isTestFile(s.file,index))s.serviceId=id;
 }
 for(const value of config.values.filter(v=>v.key==='spring.datasource.url'&&v.value.startsWith('jdbc:'))){
  const service=index.entities.filter(e=>e.kind==='service');const serviceId=service.length===1?service[0].id:undefined,host=value.value.match(/^jdbc:[^:]+:\/\/([^:/]+)/)?.[1],engine=value.value.match(/^jdbc:([^:]+)/)?.[1];
  entity({id:`resource:database:${serviceId||'project'}:${host||'unbound'}`,kind:'resource',resourceKind:'database',name:({mysql:'MySQL',postgresql:'PostgreSQL',mariadb:'MariaDB',h2:'H2',sqlite:'SQLite'}[engine||'']||'关系数据'),summary:'配置中的数据源',serviceId,location:value.location,basis:[basis('config',value.location,'spring.datasource.url → '+value.value)],discoveredOnly:true});
 }
 const at=(s:SymbolInfo):Location=>({file:s.file,range:s.selection});
 const imported=(file:string,name:string,canonical:string)=>{if(name===canonical)return true;const program=facts.get(file),pkg=result.syntax.get(file)?.javaPackage;
  if(index.symbols.some(s=>s.name===name&&s.qualifiedName!==canonical&&s.qualifiedName===`${pkg}.${name}`)||[...result.syntax.values()].some(s=>s.javaPackage===pkg&&s.annotationNames.includes(name)))return false;
  const explicit=program?.imports.find(i=>i.name===name&&!i.target.endsWith('.*'));return explicit?explicit.target===canonical:!!program?.imports.some(i=>i.target===canonical.slice(0,canonical.lastIndexOf('.'))+'.*'&&canonical.endsWith('.'+name));
 };
 const annotation=(s:SymbolInfo,name:string,pkg:string)=>{const definition=facts.get(s.file)?.definitions.find(d=>d.id===s.id),syntax=result.syntax.get(s.file);if(!definition)return false;if(definition.annotations.includes(`@${pkg}.${name}`))return true;if([...result.syntax.values()].some(other=>other.javaPackage===syntax?.javaPackage&&other.annotationNames.includes(name)))return false;return new RegExp(`@${name}\\b`).test(definition.annotations)&&imported(s.file,name,`${pkg}.${name}`);};
 const put=(input:Omit<Relation,'id'|'source'>,rule:Omit<RuleEvidence,'version'|'configuration'>)=>{
  const evidence:RuleEvidence={...rule,version:'1',configuration:config.configuration};
  const sameSite=(r:Relation)=>r.from===input.from&&r.type===input.type&&r.locations.some(a=>input.locations.some(b=>a.file===b.file&&a.range.start.line===b.range.start.line&&a.range.start.character===b.range.start.character));
  const old=index.relations.find(r=>sameSite(r)&&r.to===input.to&&r.target===input.target);
  if(old){
   if(old.rule){const previous=old.rule,alternatives=[...(previous.alternatives||[{conditions:previous.conditions,basis:previous.basis}]),{conditions:evidence.conditions,basis:evidence.basis}];evidence.alternatives=alternatives.filter((v,i)=>alternatives.findIndex(a=>JSON.stringify(a)===JSON.stringify(v))===i);evidence.conditions=previous.conditions.filter(c=>evidence.conditions.includes(c));evidence.basis=[...previous.basis,...evidence.basis.filter(b=>!previous.basis.some(a=>JSON.stringify(a)===JSON.stringify(b)))];if(previous.outcome!=='unique')evidence.outcome='candidate';}
   evidence.information=[...(old.rule?.information||[]),...(evidence.information||[])].filter((v,i,all)=>all.findIndex(a=>JSON.stringify(a)===JSON.stringify(v))===i);
   old.rule=evidence;old.status=evidence.outcome==='unique'?input.status:'candidate';return old;
  }
  if(input.to&&input.type==='CALLS')index.relations=index.relations.filter(r=>!(sameSite(r)&&!r.to&&r.status==='unresolved'));
  const id='rule:'+crypto.createHash('sha256').update(JSON.stringify([rule.id,input.from,input.to,input.type,input.locations,input.target])).digest('hex').slice(0,24);
  const relation:Relation={...input,id,source:'framework-rules',rule:evidence};index.relations.push(relation);return relation;
 };
 return {result,index,facts,config,byId,entity,at,imported,annotation,put};
}
