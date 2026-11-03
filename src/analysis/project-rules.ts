import { ruleContext } from './rule-context';
import { springRules } from './spring-rules';
import { pythonStateRules } from './python-state-rules';
import { dataRules } from './data-rules';
import { httpRules } from './http-rules';
import type { StructureResult } from './structure';
import { basis } from './code-facts';
import { contains } from '../shared/model';
import {discoveryEntities} from './resource-discovery';
import {frontendLinks} from './frontend-links';
export function projectRules(result:StructureResult,configuration?:string){
 // Each rule family supplements the same reliable structure; one failure must not erase it.
 result.index.relations=result.index.relations.filter(r=>!(r.source==='tree-sitter'&&['EXTENDS','IMPLEMENTS'].includes(r.type)&&result.index.relations.some(other=>other!==r&&other.source==='JavaSymbolSolver'&&other.from===r.from&&other.to===r.to&&other.type===r.type)));
 const ctx=ruleContext(result,configuration);
 const attempt=<T>(name:string,fn:()=>T):T|undefined=>{try{return fn();}catch{ctx.index.diagnostics.push({message:`${name}关系未补全，已有文件和入口仍保留。`,severity:'warning'});}};
 attempt('Spring',()=>springRules(ctx));const python=attempt('Python',()=>pythonStateRules(ctx));attempt('数据访问',()=>dataRules(ctx,python));attempt('HTTP',()=>httpRules(ctx));
 const {index,entity}=ctx,groups=new Map<string,typeof index.entries>();
 if(python)for(const [file,program] of result.facts)if(file.endsWith('.py'))for(const definition of program.definitions){const source=ctx.byId.get(definition.id)!;if(source.kind!=='class')continue;for(const name of definition.bases||[])for(const target of python.resolveType(file,name,source.parent))ctx.put({from:source.id,to:target.id,target:target.qualifiedName,type:'EXTENDS',status:'resolved',locations:[definition.location]}, {id:'python.base-type',outcome:'unique',basis:[basis('declaration',definition.location,'Python 基类 '+name),basis('definition',ctx.at(target),target.qualifiedName)],conditions:[]});}
 for(const e of index.entries||[])groups.set(e.group,[...(groups.get(e.group)||[]),e]);
 for(const [group,entries] of groups){
  const first=entries![0],symbol=index.symbols.find(s=>s.id===first.symbolId),serviceId=symbol?.serviceId;
  if(first.kind!=='http')continue;
  const paths=entries!.map(e=>e.name.split(' · ')[0].split(' ')[1].split('/'));let common=0;while(common<paths[0].length&&paths.every(p=>p[common]===paths[0][common]))common++;
  const prefix=paths[0].slice(0,common).join('/');
  entity({id:`domain:${group}`,kind:'domain',name:first.moduleName||prefix||first.owner,summary:symbol?.summary||`${first.owner} · HTTP 接口`,serviceId,entryIds:entries!.map(e=>e.id),basis:entries!.map(e=>basis('declaration',e.location,e.basis)),location:first.location});
 }
 for(const relation of index.relations.filter(r=>r.type==='CALLS'&&!r.to)){
  const source=index.symbols.find(s=>s.id===relation.from),program=source&&result.facts.get(source.file),name=relation.target.split(/[.(]/)[0];
  const known=!!program?.imports.some(i=>i.name===name&&!i.target.startsWith('.')&&!index.symbols.some(s=>s.qualifiedName===i.target));
  const builtin=source?.language==='python'&&/^(len|str|int|bool|set|list|dict|tuple|enumerate|zip|min|max|isinstance|type|range|sorted|sum|super)$/.test(relation.target);
  if(relation.status==='unresolved'&&(known||builtin)&&!relation.target.includes('.app.state.')){relation.status='resolved';relation.reason='导入来源 / 语言内置已确认；项目内无定义，不代表已执行。';}
  if(index.relations.some(r=>r.from===relation.from&&['HTTP','READS','WRITES'].includes(r.type)&&r.rule&&r.locations.some(l=>relation.locations.some(a=>a.file===l.file&&a.range.start.line===l.range.start.line&&a.range.start.character===l.range.start.character))))relation.auxiliary=true;
 }
 for(const resource of index.entities||[])if(resource.resourceKind==='table'){const operations=[...new Set(index.relations.filter(r=>r.to===resource.id&&['READS','WRITES'].includes(r.type)).map(r=>r.type==='READS'?'读取':'写入'))];resource.summary='关系数据表 · '+operations.join(' / ');}
 const sites=new Map(result.calls.map(site=>[`${site.from}:${site.file}:${site.range.start.line}:${site.range.start.character}`,site]));
 const stats=index.analysis!;stats.callPositions=sites.size;for(const key of ['semanticInternal','ruleUnique','external','implicit','candidate','unknown'] as const)stats[key]=0;
 for(const site of sites.values()){
  const same=index.relations.filter(r=>['CALLS','HTTP'].includes(r.type)&&r.from===site.from&&r.locations.some(l=>l.file===site.file&&(contains(site.selection,l.range.start)||l.range.start.line===site.range.start.line&&l.range.start.character===site.range.start.character)));
  const implicit=same.some(r=>r.status==='resolved'&&!r.to&&index.symbols.some(s=>['class','interface'].includes(s.kind)&&(r.target.startsWith(s.qualifiedName+'.')||r.target.startsWith(s.qualifiedName+'('))));
  const key=same.some(r=>r.rule?.outcome==='unique')?'ruleUnique':same.some(r=>r.to&&r.status==='resolved')?'semanticInternal':same.some(r=>r.status==='candidate')?'candidate':implicit?'implicit':same.some(r=>r.status==='resolved')?'external':'unknown';stats[key]++;
 }
 attempt('项目资源',()=>discoveryEntities(result));
 attempt('页面接口',()=>frontendLinks(result));
 index.versions.rules='cross-project/10';return ctx;
}
