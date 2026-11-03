import type { Evidence, ProjectIndex, Relation, SymbolInfo } from '../shared/model';
import { recommendations } from './flow-model';
import { entryOutcome } from './reading-model';
import {wording} from './ui-wording';

export interface ExplainedSource extends Evidence {id:string;relationIds:string[];operation:string}
export interface ExplanationGroup {id:string;source:string;target:string;conditions:string[];configuration?:string;relations:Relation[];operations:{name:string;certain:boolean}[]}
export interface ExplanationTask {id:string;label:string;relations:Relation[];branches:boolean;exclusive?:boolean;uncertain:boolean;call?:ExplainedSource}
const locationKey=(e:Evidence)=>JSON.stringify([e.location.file,e.location.range]);
const certain=(r:Relation)=>r.rule?r.rule.outcome==='unique':r.status==='resolved';
const callableName=(index:ProjectIndex,s?:SymbolInfo)=>{const parent=index.symbols.find(p=>p.id===s?.parent);return s?parent&&['class','interface'].includes(parent.kind)?parent.name+'.'+s.name:s.name:undefined;};
export function operation(r:Relation){
 const call=r.rule?.basis.filter(b=>b.kind==='call').map(b=>b.note).join(' ')||r.target;
 if(r.type==='WRITES'&&(/\bDELETE\b/i.test(r.data?.sql||'')||/\.(?:delete|remove|clear)\b/.test(call)))return /\.(?:delete|remove|clear)\b/.test(call)&&!r.data?.table?'清除':'删除';
 return ({READS:'读取',WRITES:'写入',HTTP:r.http?`${r.http.method} ${r.http.path}`:'HTTP 请求',CALLS:'调用',IMPORTS:'依赖',EXTENDS:'继承',IMPLEMENTS:'实现',INJECTS:'注入',MAPS:'对应'} as Record<string,string>)[r.type]||r.type;
}
function purpose(index:ProjectIndex,r:Relation){
 const source=index.symbols.find(s=>s.id===r.from),target=index.symbols.find(s=>s.id===r.to);
 if(r.type!=='HTTP')return callableName(index,source)||r.from;
 const summary=target?.summary;if(summary&&!summary.startsWith('调用 '))return summary.split(/[。\n]/)[0];
 const seen=new Set<string>(),queue=r.to?[{id:r.to,depth:0}]:[];let read=false,write=false;
 while(queue.length){const {id,depth}=queue.shift()!;if(seen.has(id)||depth>6)continue;seen.add(id);
  for(const next of index.relations.filter(e=>e.from===id&&e.to&&certain(e)&&!e.auxiliary&&e.rule?.applicability!=='excluded')){
   if(index.entities?.some(e=>e.id===next.to&&e.resourceKind==='vector')){read ||= next.type==='READS';write ||= next.type==='WRITES';}
   if(next.type==='CALLS')queue.push({id:next.to!,depth:depth+1});
  }
 }
 return read&&!write?'向量检索':write?'向量存储':callableName(index,source)||source?.name||'HTTP 调用';
}
export function explainRelations(index:ProjectIndex,relations:Relation[],options:boolean|{system?:boolean;entryId?:string}=false){
 const {system=false,entryId}=typeof options==='boolean'?{system:options}:options;
 const groups=new Map<string,ExplanationGroup>(),sources=new Map<string,ExplainedSource>();
 for(const r of relations){
  const symbol=index.symbols.find(s=>s.id===r.from),owner=index.symbols.find(s=>s.id===symbol?.parent),resource=index.entities?.find(e=>e.id===r.to),targetSymbol=index.symbols.find(s=>s.id===r.to);
  const receiver=r.rule?.basis.find(b=>b.kind==='call')?.note.match(/^([\w.]+)\./)?.[1]?.split('.')[0]||'';
  const conditions=[...new Set(r.rule?.conditions||[])].sort(),source=owner?.name||symbol?.name||r.from,target=resource?.name||callableName(index,targetSymbol)||r.target;
  const alternatives=r.rule?.alternatives?.map(a=>a.conditions.slice().sort());
  const key=JSON.stringify([owner?.id||r.from,receiver,r.to||r.target,r.rule?.configuration,conditions,alternatives]);
  let group=groups.get(key);if(!group){group={id:key,source,target,conditions,configuration:r.rule?.configuration,relations:[],operations:[]};groups.set(key,group);}
  group.relations.push(r);const name=operation(r),previous=group.operations.find(o=>o.name===name);if(previous)previous.certain&&=certain(r);else group.operations.push({name,certain:certain(r)});
  const basis=r.rule?.basis||[],all:Evidence[]=[...basis];
  for(const location of r.locations)if(!basis.some(b=>b.kind==='call'&&locationKey(b)===locationKey({kind:'call',location,note:''})))all.push({kind:'call',location,note:r.http?`${r.http.method} ${r.http.path}`:r.data?.sql||r.target});
  if(targetSymbol&&!basis.some(b=>b.kind==='definition'))all.push({kind:'definition',location:{file:targetSymbol.file,range:targetSymbol.selection},note:targetSymbol.name});
  for(const b of all){const id=JSON.stringify([locationKey(b),b.kind,b.note,b.kind==='call'?[conditions,alternatives]:undefined]);const old=sources.get(id);if(old){if(!old.relationIds.includes(r.id))old.relationIds.push(r.id);}else sources.set(id,{...b,id,relationIds:[r.id],operation:name});}
 }
 const endpoint=(r:Relation,from=false)=>{
  const id=from?r.from:r.to,symbol=index.symbols.find(s=>s.id===id),entity=index.entities?.find(e=>e.id===id);
  const service=system&&!entity?index.entities?.find(e=>e.id===symbol?.serviceId):undefined;
  if(system&&!entity&&!service)return{id:id||r.target,name:from?'来源服务待确定':'目标服务待确定'};
  return {id:service?.id||entity?.id||id||r.target,name:service?.name||entity?.name||callableName(index,symbol)||(from?r.from:r.target)};
 };
 const origins=[...new Map(relations.map(r=>{const e=endpoint(r,true);return[e.id,e];})).values()],targets=[...new Map(relations.map(r=>{const e=endpoint(r);return[e.id,e];})).values()];
 const http=relations.length>0&&relations.every(r=>r.type==='HTTP'),data=relations.length>0&&relations.every(r=>['READS','WRITES'].includes(r.type)),ambiguous=relations.some(r=>!certain(r));
 const describe=(items:typeof targets)=>{const names=items.map(e=>e.name);return new Set(names).size===1&&items.length>1?`${items.length} 个 ${names[0]} 实例`:names.join('、');};
 const from=describe(origins)||'当前来源',to=ambiguous?(http&&system?'目标服务待确定':'目标尚不能唯一确定'):describe(targets)||'目标尚不能唯一确定';
 const title=from+' → '+to,operations=[...new Set(relations.map(operation))];
 let conclusion=http?ambiguous?'发现接口请求，还不能确定它发给了哪个目标。':system?`${from} 通过 HTTP 调用 ${to} 的接口。`:`通过 HTTP 调用 ${to}。`:data?`${from} 对 ${ambiguous?'可能的资源':to} ${operations.join('、')}。`:`${from} ${operations[0]||'关联'} ${to}。`;
 const information=relations.flatMap(r=>r.rule?.information||[]).filter((v,i,all)=>all.findIndex(a=>JSON.stringify(a)===JSON.stringify(v))===i);
 if(data&&information.some(n=>n.kind==='precondition'&&n.text==='受缓存启用开关限制'))conclusion='缓存开关开启时，'+conclusion;
 const preferred=index.entries?.find(e=>e.id===entryId)||recommendations(index)[0]?.entry,preferredIds=new Set(preferred?entryOutcome(index,preferred).relationIds:[]);
 const purposes=new Map(relations.map(r=>[r.id,purpose(index,r)]));
 const score=(r:Relation)=>(preferredIds.has(r.id)?1000:0)+(purposes.get(r.id)==='向量检索'?100:0)-(index.symbols.find(s=>s.id===r.to)?.summary?.startsWith('返回健康')?100:0);
 const ordered=relations.slice().sort((a,b)=>score(b)-score(a)||a.id.localeCompare(b.id));
 const primary=[...sources.values()].filter(s=>s.kind==='call').sort((a,b)=>Math.max(...ordered.filter(r=>b.relationIds.includes(r.id)).map(score))-Math.max(...ordered.filter(r=>a.relationIds.includes(r.id)).map(score)));
 const tasks=new Map<string,ExplanationTask>();
 for(const r of ordered){
  const branch=r.rule?.information?.find(n=>n.kind==='branch'&&n.branchGroup),key=JSON.stringify([r.from,r.locations,r.rule?.configuration,endpoint(r).id,branch?.branchGroup||r.id]);
  const old=tasks.get(key);if(old){old.relations.push(r);old.branches ||= !!branch;old.uncertain ||= !certain(r);}
  else {const target=endpoint(r).name,label=r.data?.table?wording(r.type==='READS'?'readTable':'writeTable',{name:r.data.table}):http?`${purposes.get(r.id)} · ${r.http?.method||''} ${r.http?.path||target}`:`${operation(r)} ${target}`;tasks.set(key,{id:key,label,relations:[r],branches:!!branch,uncertain:!certain(r),call:primary.find(s=>s.relationIds.includes(r.id))});}
 }
 for(const task of tasks.values())task.exclusive=!task.uncertain&&new Set(task.relations.flatMap(r=>r.rule?.information?.filter(n=>n.branchGroup&&n.branch).map(n=>n.branch)||[])).size===2;
 const unclassified=relations.some(r=>r.rule?.conditions.length&&!r.rule.information?.length);
 const notice=unclassified?'部分调用条件尚需核对，可查看详细来源。':information.some(n=>n.kind==='precondition')&&!data?'部分调用包含配置检查，可查看调用代码。':undefined;
 return {title,conclusion,tasks:[...tasks.values()],groups:[...groups.values()],primary,shared:[...sources.values()].filter(s=>!primary.includes(s)),sources:[...sources.values()],information,targets,ambiguous,notice};
}
export function groupConclusion(g:ExplanationGroup){
 return `${g.source} 对 ${g.target} ${g.operations.map(o=>o.name+(o.certain?'':'（目标还不能确定）')).join('、')}。`;
}
