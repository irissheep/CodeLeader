import crypto from 'node:crypto';
import {isTestFile} from '../shared/source-roles';
import type { ProjectIndex, SymbolInfo } from '../shared/model';
import type { ObservationPlan, ObservationPoint } from '../shared/execution';
import {declaredParameters} from './java-parameters';
const erase=(s:string)=>s.replace(/<[^<>]*(?:<[^<>]*>[^<>]*)*>/g,'').replace(/\s+/g,'').replace(/\.\.\./g,'[]');
export function buildPlan(index:ProjectIndex,texts:Map<string,string>):ObservationPlan {
  const unitRoots=(index.units||[]).filter(u=>u.kind==='application').map(u=>({id:u.id,root:u.root,language:u.language,serviceId:u.serviceId}));
  const pythonModules=index.files.filter(f=>f.language==='python'&&!isTestFile(f.path,index)).flatMap(f=>{const unit=unitRoots.filter(u=>u.language==='python'&&(!u.root||f.path.startsWith(u.root+'/'))).sort((a,b)=>b.root.length-a.root.length)[0];return unit?[(unit.root?f.path.slice(unit.root.length+1):f.path).replace(/(?:^|\/)__init__\.py$/,'').replace(/\.py$/,'').replaceAll('/','.')]:[];});
  const points:ObservationPoint[]=[],seen=new Set<string>(),limitations=new Set<string>();
  const roots=new Set((index.entries||[]).filter(e=>e.kind==='http'&&!isTestFile(e.location.file,index)).map(e=>e.symbolId));
  const candidates=new Map<string,SymbolInfo>(index.symbols.filter(s=>roots.has(s.id)).map(s=>[s.id,s]));
  for(const entry of index.entries||[]){
    if(entry.kind!=='http'||!entry.symbolId||isTestFile(entry.location.file,index))continue;
    const queue=[{id:entry.symbolId,depth:0}],visited=new Set<string>();
    while(queue.length&&visited.size<24){const {id,depth}=queue.shift()!;if(visited.has(id))continue;visited.add(id);
      const s=index.symbols.find(s=>s.id===id);if(!s)continue;
      if(!isTestFile(s.file,index)&&!/(?:^|\/)generated\//i.test(s.file)&&!s.auxiliary)candidates.set(id,s);
      if(depth<6)for(const r of index.relations.filter(r=>r.from===id&&r.to&&['CALLS','HTTP'].includes(r.type)&&r.status==='resolved'))queue.push({id:r.to!,depth:depth+1});
    }
  }
  for(const s of candidates.values()){
    if(points.length>=96){limitations.add('每进程最多 96 个方法；其余保留 HTTP/SQL 边界。');break;}
    if(!['method','function'].includes(s.kind)||!roots.has(s.id)&&(s.auxiliary||/^(get[A-Z]|set[A-Z]|toString|equals|hashCode|authorize|__|_)/.test(s.name)))continue;
    const parent=index.symbols.find(p=>p.id===s.parent),text=texts.get(s.file)||'',body=text.split(/\r?\n/).slice(s.range.start.line,s.range.end.line+1).join('\n');
    if(parent?.kind==='interface'||parent?.declaration==='record_declaration'||/^(?:embed_query|embed_documents)$/.test(s.name))continue;
    if(s.language==='python'&&/\b(async\s+def|yield)\b/.test(body)){limitations.add('Python 异步/生成器保留标准 HTTP 边界。');continue;}
    const declaration=s.language==='java'?declaredParameters(s,text,index):undefined;
    if(s.language==='java'&&!s.signature.startsWith(s.qualifiedName+'(')&&!declaration){limitations.add('未取得 Java 完整参数类型的方法仅保留标准边界。');continue;}
    if(s.language==='java'&&/\b(CompletableFuture|CompletionStage|Publisher|Flux|Mono|Stream|Iterator)\b/.test(body.split('{')[0])){limitations.add('异步结果与迭代器不消费，只保留边界。');continue;}
    const paramText=s.signature.slice(s.signature.indexOf('(')+1,s.signature.lastIndexOf(')'));
    const parameters=s.language==='java'?(declaration?.types||erase(paramText).split(',').filter(Boolean)).map(t=>{const nested=index.symbols.find(n=>n.qualifiedName===t&&n.parent);return nested?t.slice(0,-nested.name.length-1)+'$'+nested.name:t;}):[];
    const declaredParams=body.match(new RegExp('\\b'+s.name+'\\s*\\(([^]*?)\\)\\s*(?:throws[^]*?)?\\{'))?.[1]||'';
    const names=s.language==='java'?declaration?.names||declaredParams.replace(/<[^>]*>/g,'').split(',').map(p=>p.trim().match(/(\w+)$/)?.[1]||''):paramText.split(',').map(p=>p.trim().split(':')[0].split('=')[0]).filter(p=>p&&!['self','cls'].includes(p));
    let owner=parent?.qualifiedName||s.qualifiedName.slice(0,-s.name.length-1),module:string|undefined;
    if(s.language==='java'&&parent?.parent){const outer=index.symbols.find(p=>p.id===parent.parent);if(outer)owner=outer.qualifiedName+'$'+parent.name;}
    if(s.language==='python'){
      const unit=index.units?.find(u=>u.language==='python'&&u.kind==='application'&&u.serviceId===s.serviceId),prefix=unit?.root||'';
      module=(prefix?s.file.slice(prefix.length+1):s.file).replace(/(?:^|\/)__init__\.py$/,'').replace(/\.py$/,'').replaceAll('/','.');owner=parent?.kind==='class'?parent.name:module;
    }
    const key=[s.language,module,owner,s.name,...parameters].join('|');if(seen.has(key))continue;seen.add(key);
    const point:ObservationPoint={id:crypto.createHash('sha256').update(key).digest('hex').slice(0,20),symbolId:s.id,language:s.language,owner,method:s.name,parameters,parameterNames:names,module,binding:parent?.kind==='class'?'method':'function',file:s.file,hash:index.files.find(f=>f.path===s.file)!.hash,location:{file:s.file,range:s.selection},serviceId:s.serviceId};
    const construction=body.match(/\.body\(Map\.of\(([^;]*?)\)\)/);
    if(construction){const fields:Record<string,string>={};let remainder=construction[1];for(const m of construction[1].matchAll(/"(\w+)"\s*,\s*(\w+)/g)){if(names.includes(m[2])){fields[m[1]]=m[2];remainder=remainder.replace(m[0],'');}}if(Object.keys(fields).length&&remainder.replace(/[\s,]/g,'')==='')point.construction={fields,location:{file:s.file,range:s.range}};}
    points.push(point);
  }
  const backgroundReaders=(index.entries||[]).filter(e=>e.kind==='scheduled'&&e.symbolId&&!isTestFile(e.location.file,index)).map(entry=>{
    const visited=new Set<string>(),queue=[entry.symbolId!];
    while(queue.length&&visited.size<96){const id=queue.shift()!;if(visited.has(id))continue;visited.add(id);for(const r of index.relations)if(r.from===id&&r.to&&r.status==='resolved'&&r.type==='CALLS')queue.push(r.to);}
    const resources=[...new Set(index.relations.filter(r=>visited.has(r.from)&&r.type==='READS'&&r.to).map(r=>r.to!))];
    return {symbolId:entry.symbolId!,name:index.symbols.find(s=>s.id===entry.symbolId)?.qualifiedName||entry.name,resources,location:entry.location};
  }).filter(reader=>reader.resources.length);
  const dtoTypes=index.symbols.filter(s=>s.language==='java'&&s.kind==='class'&&!isTestFile(s.file,index)).map(s=>{const p=index.symbols.find(p=>p.id===s.parent);return p?p.qualifiedName+'$'+s.name:s.qualifiedName;});
  const version=crypto.createHash('sha256').update(index.files.map(f=>`${f.path}:${f.hash}`).sort().join('\n')).digest('hex');
  const resources=index.relations.filter(r=>['READS','WRITES'].includes(r.type)&&r.to).map(r=>({id:r.to!,from:r.from,sql:r.data?.sql,location:r.locations[0],operation:r.data?.operation||r.type.toLowerCase(),kind:index.entities?.find(e=>e.id===r.to)?.resourceKind}));
  return {version:1,projectId:index.id,sourceVersion:version,points,resources,unitRoots,pythonModules,backgroundReaders,routes:(index.entries||[]).filter(e=>e.kind==='http').map(e=>({method:e.name.match(/^([A-Z]+)\s+(\S+)/)?.[1]||'',path:e.name.match(/^([A-Z]+)\s+(\S+)/)?.[2]||'',symbolId:e.symbolId,location:e.location,serviceId:index.symbols.find(s=>s.id===e.symbolId)?.serviceId})),dtoTypes,budgets:{depth:6,methods:96,perEntry:24,invocations:300},limitations:[...limitations,'SDK 导出可能延迟或丢弃；未录到不等于未执行。','不采集任意局部变量、完整分支、字段血缘或 MQ。']};
}
