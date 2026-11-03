import path from 'node:path';
import {loadAll,JSON_SCHEMA} from 'js-yaml';
import signals from '../shared/discovery-signals.json';
import type {DiscoveredResource,DiscoveryEvidence,Evidence,ProjectUnit,Location} from '../shared/model';
import type {StructureResult} from './structure';
import {directory,discoveryEvidence,under} from './unit-discovery';
import {isTestFile} from '../shared/source-roles';

export function discoverResources(result:StructureResult){
 const {index,configs}=result,units=index.units||[],resources=new Map<string,DiscoveredResource>(),generic:{evidence:DiscoveryEvidence;users:ProjectUnit[]}[]=[];
 const owners=(file:string):ProjectUnit[]=>{const language=/\.py$/.test(file)?'python':/\.java$/.test(file)?'java':/\.(?:[jt]sx?|vue)$/.test(file)?'javascript':undefined,candidates=units.filter(u=>u.kind!=='tool'&&(!language||u.language===language)&&under(file,u.root)).sort((a,b)=>b.root.length-a.root.length),owner=candidates[0];if(!owner||candidates[1]?.root===owner.root)return[];return[owner,...owner.usedBy.map(id=>units.find(u=>u.id===id)!).filter(Boolean)];};
 const add=(engine:string,kind:DiscoveredResource['kind'],evidence:DiscoveryEvidence,users:ProjectUnit[])=>{
  let r=resources.get(engine);if(!r){r={id:`discovered-resource:${engine.toLowerCase()}`,engine,kind,identity:'engine',unitIds:[],basis:[],usages:[]};resources.set(engine,r);}
  const append=(list:DiscoveryEvidence[])=>{if(!list.some(v=>JSON.stringify(v)===JSON.stringify(evidence)))list.push(evidence);};append(r.basis);
  for(const user of users){if(!r.unitIds.includes(user.id))r.unitIds.push(user.id);let usage=r.usages.find(v=>v.unitId===user.id);if(!usage){usage={unitId:user.id,basis:[]};r.usages.push(usage);}append(usage.basis);}
 };
 const match=(source:DiscoveryEvidence['source'],file:string,text:string,offset:number,value:string,key='',users=owners(file),context?:string,location?:Location)=>{
  const pattern=source==='dependency'?signals.genericRelational.dependencies:source==='import'?signals.genericRelational.imports:undefined;if(pattern&&new RegExp(pattern,'i').test(value)){const e=discoveryEvidence(source,file,text,offset,'关系库客户端；引擎尚不明确',context);if(location)e.location=location;generic.push({evidence:e,users});}
  for(const s of signals.engines){const type=source==='dependency'?'dependencies':source==='import'?'imports':source==='compose'?'images':'connections';
   if(new RegExp(s[type],'i').test(value)||!!key&&new RegExp(s.keys,'i').test(key)){const e=discoveryEvidence(source,file,text,offset,source==='dependency'||source==='import'?`${s.engine} · ${value}`:`${s.engine} · ${key||source}（未连接）`,context);if(location)e.location=location;add(s.engine,s.kind as DiscoveredResource['kind'],e,users);}
  }
 };
 for(const b of index.buildDeclarations||[])for(const d of b.declaredDependencies){if(d.basis.context==='development')continue;const declared=units.filter(u=>u.buildIds.includes(b.id)),users=[...declared,...declared.flatMap(u=>u.usedBy.map(id=>units.find(v=>v.id===id)!).filter(Boolean))];match('dependency',b.file,configs.get(b.file)||'',0,d.name,'',users,d.basis.context,d.basis.location);}
 // All Compose files are discovery evidence, not selection of a running deployment.
 const yaml=new Map<string,any[]>();for(const [file,text] of configs)if(/\.ya?ml$/.test(file)){try{yaml.set(file,loadAll(text,undefined,{schema:JSON_SCHEMA}));}catch{/* config-facts reports parse failures; other sources remain usable */}}
 for(const [file,documents] of yaml)for(const doc of documents){if(!doc?.services)continue;const text=configs.get(file)!;
  const serviceUsers=(service:any)=>{const context=typeof service?.build==='string'?service.build:service?.build?.context;if(typeof context!=='string'||context.includes('${'))return[];const root=path.posix.normalize(path.posix.join(directory(file),context)).replace(/^\.\/?$/,'');return units.filter(u=>u.kind==='application'||u.kind==='frontend').filter(u=>u.root===root);};
  for(const [name,service] of Object.entries(doc.services) as [string,any][]){if(typeof service?.image!=='string')continue;const users:ProjectUnit[]=[];
   for(const consumer of Object.values(doc.services) as any[]){const depends=Array.isArray(consumer.depends_on)?consumer.depends_on:Object.keys(consumer.depends_on||{});if(depends.includes(name))users.push(...serviceUsers(consumer));}
   match('compose',file,text,text.indexOf(service.image),service.image,'image',users,`Compose ${file} · ${name}（未运行）`);
  }
 }
 const scalar=(file:string,text:string,key:string,value:unknown,context?:string)=>{
  if(typeof value!=='string'&&typeof value!=='number')return;const parents:{indent:number;key:string}[]=[];let offset=0,found=-1;
  for(const line of text.split('\n')){if(/^---/.test(line))parents.length=0;const m=line.match(/^(\s*)["']?([\w.-]+)["']?:/);if(m){while(parents.length&&parents.at(-1)!.indent>=m[1].length)parents.pop();parents.push({indent:m[1].length,key:m[2]});if(parents.map(p=>p.key).join('.')===key){found=offset+m[1].length;break;}}offset+=line.length+1;}
  match('configuration',file,text,found<0?Math.max(0,text.indexOf(String(value))):found,String(value),key,owners(file),context);
 };
 for(const [file,text] of configs){
  const profile=file.match(/(?:^|\/)application-([^/]+)\.(?:yml|yaml|properties)$/)?.[1],context=profile?`profile ${profile}（未激活）`:path.posix.basename(file).startsWith('.env')?`${path.posix.basename(file)}（未加载）`:undefined;
  if(yaml.has(file)){
   const visit=(v:any,key:string)=>{if(v&&typeof v==='object'){for(const [k,next] of Object.entries(v))visit(next,key?`${key}.${k}`:k);}else scalar(file,text,key,v,context);};for(const doc of yaml.get(file)!)visit(doc,'');
  }else if(/\.properties$|(?:^|\/)\.env[^/]*$/.test(file))for(const m of text.matchAll(/^[ \t]*(?:export\s+)?([\w.-]+)\s*[=:]\s*([^\r\n]*)/gm)){const key=m[1],val=m[2].replace(/^["']|["']$/g,'');match('configuration',file,text,m.index!,val,key,owners(file),context);}
 }
 for(const [file,program] of result.facts){if(isTestFile(file,index))continue;const text=result.texts.get(file)||'';
  for(const imp of program.imports)match('import',file,text,0,imp.target,'',owners(file),undefined,imp.location);
  // Keep positions, not connection strings or credentials, in discovery evidence.
  if(file.endsWith('.py')){
   for(const a of program.assignments){const at=a.location.range.start,line=text.split('\n').slice(0,at.line).join('\n').length+(at.line?1:0)+at.character;match('connection',file,text,line,a.value.text,a.left,owners(file),'Python 源码中的设置或连接值；环境覆盖未求值');}
   for(const f of program.fields)match('configuration',file,text,text.indexOf(f.name),'',f.name,owners(file),'Python 设置字段；环境值未读取');
  }
 }
 for(const [file,text] of result.frontendTexts||[])if(!isTestFile(file,index))for(const m of text.matchAll(/(?:\bfrom\s*|\bimport\s*|\brequire\s*\(\s*)["']([^"']+)["']/g))match('import',file,text,m.index!,m[1]);
 for(const hint of generic){const users=hint.users.filter(u=>![...resources.values()].some(r=>r.kind==='database'&&r.unitIds.includes(u.id)));if(users.length||!hint.users.length&&!resources.size)add('未知关系库','database',hint.evidence,users);}
 index.resources=[...resources.values()].sort((a,b)=>a.engine.localeCompare(b.engine));
}

/** Reuse graph identities and keep discovery separate from access relations. */
export function discoveryEntities(result:StructureResult){
 const {index}=result,services=(index.entities||[]).filter(e=>e.kind==='service');
 for(const unit of index.units||[]){const candidates=services.filter(s=>s.sourceRoots?.some(root=>under(root,unit.root)||under(unit.root,root)));unit.serviceId=candidates.length===1?candidates[0].id:services.length===1&&unit.kind!=='frontend'&&unit.kind!=='tool'?services[0].id:undefined;}
 for(const r of index.resources||[]){
  const basis:Evidence[]=r.basis.map(e=>({kind:e.source==='import'||e.source==='dependency'?'declaration':e.source==='entry'?'definition':'config',location:e.location,note:e.note+(e.context?` · ${e.context}`:'')}));
  const existing=(index.entities||[]).filter(e=>e.kind==='resource'&&e.resourceKind!=='table'&&e.name.toLowerCase().split(/\s|·/)[0]===r.engine.toLowerCase());
  if(existing.length){for(const e of existing){e.resourceKind=r.kind;e.basis.push(...basis.filter(b=>!e.basis.some(a=>JSON.stringify(a)===JSON.stringify(b))));}continue;}
  const users=r.unitIds.map(id=>index.units?.find(u=>u.id===id)).filter((u):u is ProjectUnit=>!!u),ids=[...new Set(users.filter(u=>u.kind==='application').map(u=>u.serviceId).filter(Boolean))];
  index.entities!.push({id:r.id,kind:'resource',name:r.engine,resourceKind:r.kind,summary:`${r.engine} · 已在项目中找到`,serviceId:ids.length===1?ids[0]:undefined,location:basis[0]?.location,basis,discoveredOnly:true});
 }
}
