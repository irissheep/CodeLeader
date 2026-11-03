import path from 'node:path';
import policy from '../shared/python-http-rules.json';
import type {EntryPoint,Evidence,Location,SymbolInfo} from '../shared/model';
import type {StructureResult} from './structure';
import type {PyExpression as Expr} from './python-http-facts';
import {sourceArea} from './entry-syntax';
import {isTestFile} from '../shared/source-roles';
import {extractDjangoEntries} from './django-http';

export type Context={file:string;scope:string;offset:number};
export type ScopeRef={kind:'scope';file:string;scope:string;symbolId:string;instance?:boolean;overrides?:Map<string,Expr>};
export type ObjectRef={kind:'object';key:string;context:Context;name:string;expression:Expr;rule:typeof policy.constructors[number]};
export type Ref={kind:'external';name:string}|{kind:'module';file:string}|ScopeRef|ObjectRef|{kind:'value';context:Context;expression:Expr;defaults?:boolean}|{kind:'view';klass:ScopeRef;expression?:Expr;context?:Context};
type Issue={location:Location;expression:string;reason:string};
export type Evaluated={value:unknown;basis:Evidence[];defaults:boolean;issues:Issue[]};
export interface PythonHttpAPI {
 result:StructureResult;objects:Map<string,ObjectRef>;
 context:(file:string,scope?:string,offset?:number)=>Context;offset:(e:Expr)=>number;
 localFile:(from:string,module:string)=>string|undefined;
 resolve:(name:string,c:Context,seen?:Set<string>)=>Ref|undefined;
 call:(e:Expr,c:Context,key:string,name:string,seen:Set<string>)=>Ref;
 evaluate:(e:Expr|undefined,c:Context,seen?:Set<string>)=>Evaluated;
 textValue:(e:Expr|undefined,c:Context)=>Evaluated&{value:string};
 bases:(klass:ScopeRef)=>(Ref|undefined)[];handler:(klass:ScopeRef,name:string)=>SymbolInfo|undefined;
 argument:(e:Expr,name:string,position?:number)=>Expr|undefined;
 merge:(items:Evaluated[])=>Pick<Evaluated,'basis'|'defaults'|'issues'>;
 emit:(symbolId:string,method:string,path:Evaluated,location:Location,group:string,moduleName:string,basis:string,conditions?:Location[],parent?:EntryPoint['moduleParent'],reason?:string)=>EntryPoint|undefined;
}
const argument=(e:Expr,name:string,position?:number)=>e.args?.find(a=>a.name===name)?.value??(position===undefined?undefined:e.args?.filter(a=>!a.name)[position]?.value);
const member=(name:string)=>({base:name.slice(0,name.lastIndexOf('.')),name:name.slice(name.lastIndexOf('.')+1)});
const merge=(items:Evaluated[])=>({basis:items.flatMap(i=>i.basis),defaults:items.some(i=>i.defaults),issues:items.flatMap(i=>i.issues)});
const joined=(...parts:string[])=>('/'+parts.join('')).replace(/\/{2,}/g,'/');
const converted=(s:string)=>s.replace(/<(?:(?:\w+)(?:\([^>]*\))?:)?(\w+)>/g,'{$1}');
export function extractPythonEntries(result:StructureResult){
 const {index,syntax}=result,entries=index.entries!,objects=new Map<string,ObjectRef>(),mounts=new Map<string,{parent:ObjectRef;prefix:Evaluated;override:boolean;conditions:Location[]}[]>();
 const moduleScope=(file:string)=>`${file}:module`,context=(file:string,scope=moduleScope(file),offset=Infinity):Context=>({file,scope,offset});
 const offset=(e:Expr)=>{const lines=(result.texts.get(e.location.file)||'').split('\n');return lines.slice(0,e.location.range.start.line).reduce((n,l)=>n+l.length+1,0)+e.location.range.start.character;};
 const localFile=(from:string,module:string)=>{
  const dots=module.match(/^\.+/)?.[0].length||0,base=path.posix.dirname(from).split('/'),relative=dots?[...base.slice(0,base.length-dots+1),...module.slice(dots).split('.').filter(Boolean)].join('/'):undefined;
  const unit=index.units?.filter(u=>u.language==='python'&&(!u.root||from.startsWith(u.root+'/'))).sort((a,b)=>b.root.length-a.root.length)[0],roots=unit?[unit.root,path.posix.join(unit.root,'src')]:[''];
  const targets=relative?[path.posix.normalize(relative)]:roots.map(root=>path.posix.join(root,module.replaceAll('.','/'))),found=index.files.filter(f=>f.language==='python'&&targets.some(t=>f.path===t+'.py'||f.path===t+'/__init__.py'));
  return found.length===1?found[0].path:undefined;
 };
 const unknown=(e:Expr,reason='需要运行代码才能确定'):Evaluated=>{const name=e.name||e.callee?.name||(/^[\w.]+$/.test(e.text)?e.text:'前缀');return{value:'${'+name.replace(/\s+/g,'')+'}',basis:[{kind:'config',location:e.location,note:reason}],defaults:false,issues:[{location:e.location,expression:name,reason}]};};
 function tail(ref:Ref|undefined,parts:string[],seen:Set<string>):Ref|undefined{
  if(!ref||!parts.length)return ref;
  if(ref.kind==='external')return{kind:'external',name:[ref.name,...parts].join('.')};
  if(ref.kind==='module')return resolve([parts[0],...parts.slice(1)].join('.'),context(ref.file),seen);
  if(ref.kind==='scope'){
   const override=ref.overrides?.get(parts[0]);if(override&&!parts.slice(1).length)return{kind:'value',context:context(override.location.file),expression:override};
   const local=syntax.get(ref.file)?.scopes.find(s=>s.id===ref.scope)?.bindings.some(b=>b.name===parts[0])||syntax.get(ref.file)?.python?.bindings.some(b=>b.scope===ref.scope&&b.name===parts[0]);
   if(!local){const key=`member:${ref.symbolId}:${parts.join('.')}`;if(seen.has(key))return;const next=new Set(seen).add(key);for(const name of result.facts.get(ref.file)?.definitions.find(d=>d.id===ref.symbolId)?.bases||[]){const base=resolve(name,context(ref.file),next);if(base?.kind==='scope'){const found=tail({...base,instance:ref.instance},parts,next);if(found)return found;}}return;}
   const found=resolve(parts.join('.'),context(ref.file,ref.scope),seen);return found?.kind==='value'&&ref.instance?{...found,defaults:true}:found;
  }
 }
 function resolve(name:string,c:Context,seen=new Set<string>()):Ref|undefined{
  const facts=syntax.get(c.file);if(!facts)return;const [head,...parts]=name.split('.');let scope=facts.scopes.find(s=>s.id===c.scope),binding;
  while(scope){const locals=scope.bindings.filter(b=>b.name===head),extra=facts.python?.bindings.filter(b=>b.scope===scope!.id&&b.name===head)||[];binding=locals.filter(b=>b.offset<=c.offset).at(-1);if(!binding&&extra.length)binding={name:head,kind:'other' as const,value:'missing-default',offset:extra[0].offset};if(locals.length||extra.length)break;scope=facts.scopes.find(s=>s.id===scope!.parent);}
  if(!scope||!binding)return;const key=`${c.file}:${scope.id}:${binding.name}:${binding.offset}:${parts.join('.')}`;if(seen.has(key))return;seen=new Set(seen).add(key);
  if(binding.kind==='import'){
   const [module,exported]=binding.value.split(':'),file=localFile(c.file,module);
   if(!file&&['fastapi','flask','django','rest_framework','pydantic','os'].includes(module.split('.')[0]))return{kind:'external',name:[module,exported,...parts].filter(Boolean).join('.')};
   if(file){const found=exported?resolve([exported,...parts].join('.'),context(file),seen):tail({kind:'module',file},parts,seen);if(found)return found;}
   const child=exported&&localFile(c.file,module+(module.endsWith('.')?'':'.')+exported);if(child)return tail({kind:'module',file:child},parts,seen);
   // import package.submodule binds package unless explicitly aliased.
   const direct=localFile(c.file,[module,...parts].join('.'));if(direct)return{kind:'module',file:direct};return;
  }
  if(binding.value==='definition'){
   const symbol=index.symbols.find(s=>s.file===c.file&&s.name===head&&(s.parent||moduleScope(c.file))===scope!.id);return symbol?tail({kind:'scope',file:c.file,scope:symbol.id,symbolId:symbol.id},parts,seen):undefined;
  }
  const expression=facts.python?.bindings.find(b=>b.scope===scope!.id&&b.name===head&&b.offset===binding.offset)?.expression;
  if(!expression)return;const next={...c,scope:scope.id,offset:binding.offset};
  const ref=expression.kind==='ref'?resolve(expression.name!,next,seen):expression.kind==='call'?call(expression,next,key,head,seen):{kind:'value' as const,context:next,expression};return tail(ref,parts,seen);
 }
 function call(e:Expr,c:Context,key:string,name:string,seen:Set<string>):Ref{
  const callee=e.callee?.name||'',split=member(callee);
  if(split.name==='as_view'){
   const klass=resolve(split.base,c,seen);if(klass?.kind==='scope')return{kind:'view',klass,expression:e,context:c};
  }
  const target=resolve(callee,c,seen),rule=target?.kind==='external'&&policy.constructors.find(r=>r.callee===target.name);
  if(rule){let object=objects.get(key);if(!object){object={kind:'object',key,context:c,name,expression:e,rule};objects.set(key,object);}return object;}
  if(target?.kind==='scope'&&index.symbols.find(s=>s.id===target.symbolId)?.kind==='class')return{...target,instance:true,overrides:new Map(e.args?.filter(a=>a.name).map(a=>[a.name!,a.value]))};
  return{kind:'value',context:c,expression:e};
 }
 function evaluate(e:Expr|undefined,c:Context,seen=new Set<string>()):Evaluated{
  if(!e)return{value:'',basis:[],defaults:false,issues:[]};const key=`${c.file}:${c.scope}:${offset(e)}:${e.text}`;if(seen.has(key))return unknown(e,'定义之间形成循环，值未确定');seen=new Set(seen).add(key);
  const own:Evidence={kind:'assignment',location:e.location,note:'路径值的源码定义'};
  if(e.kind==='literal')return{value:e.value,basis:[own],defaults:false,issues:[]};
  if(e.kind==='join'||e.kind==='list'){const children=(e.items||[]).map(v=>evaluate(v,c,seen)),value=e.kind==='list'?children.map(v=>v.value):children.every(v=>Array.isArray(v.value))?children.flatMap(v=>v.value as unknown[]):children.map(v=>String(v.value)).join('');return{value,...merge(children)};}
  if(e.kind==='ref'){const ref=resolve(e.name!,c);if(ref?.kind==='value'){const value=evaluate(ref.expression,ref.context,seen);return{...value,value:value.issues.length&&typeof value.value==='string'&&/^\$\{[^}]+\}$/.test(value.value)?'${'+e.name+'}':value.value,basis:[...value.basis,{kind:'config',location:e.location,note:'路径引用 '+e.name}],defaults:value.defaults||!!ref.defaults};}return unknown(e,'引用没有可确认的源码默认值');}
  if(e.kind==='call'){
   const ref=resolve(e.callee?.name||'',c);if(ref?.kind==='external'&&policy.fieldDefaults.includes(ref.name)){const fallback=argument(e,'default',0);if(!fallback)return unknown(e,'设置字段没有字面默认值，未运行默认工厂');const value=evaluate(fallback,c,seen);return{...value,defaults:true};}
   if(e.callee?.name==='str')return evaluate(argument(e,'',0),c,seen);
   return unknown(e,ref?.kind==='external'&&policy.dynamicCalls.includes(ref.name)?'前缀读取环境变量，未读取运行环境':'前缀由函数计算，未执行该函数');
  }
  return unknown(e,/environ/.test(e.text)?'前缀读取环境变量，未读取运行环境':'没有可静态确认的路径值');
 }
 const textValue=(e:Expr|undefined,c:Context)=>{const v=evaluate(e,c);return{...v,value:String(v.value??'')};};
 const methods=(e:Expr|undefined,c:Context,fallback:string[])=>{if(!e)return fallback;const v=evaluate(e,c);return v.issues.length?['ANY']:(Array.isArray(v.value)?v.value:[v.value]).map(String).map(s=>s.toUpperCase());};
 const bases=(klass:ScopeRef)=>result.facts.get(klass.file)?.definitions.find(d=>d.id===klass.symbolId)?.bases?.map(b=>resolve(b,context(klass.file)))||[];
 const handler=(klass:ScopeRef,name:string)=>index.symbols.find(s=>s.parent===klass.symbolId&&s.name===name);
 const routes:{object:ObjectRef;symbolId:string;method:string;path:Evaluated;location:Location;conditions:Location[]}[]=[];
 for(const [file,facts] of syntax){if(!file.endsWith('.py')||isTestFile(file,index))continue;for(const bind of facts.python?.bindings||[])resolve(bind.name,context(file,bind.scope,Infinity));
  for(const d of facts.python?.decorators||[]){const e=d.expression,fn=e.callee?.name;if(!fn||!fn.includes('.'))continue;const split=member(fn),object=resolve(split.base,context(file,d.scope,offset(e)));if(object?.kind!=='object'||object.rule.framework==='Django')continue;
   const list=split.name==='route'?methods(argument(e,'methods'),context(file,d.scope,offset(e)),policy.defaultMethods.route):policy.httpMethods.includes(split.name.toUpperCase())?[split.name.toUpperCase()]:[];
   for(const method of list)routes.push({object,symbolId:d.symbolId,method,path:textValue(argument(e,object.rule.framework==='Flask'?'rule':'path',0),context(file,d.scope,offset(e))),location:d.location,conditions:[]});
  }
  for(const item of facts.python?.calls||[]){const e=item.expression,fn=e.callee?.name;if(!fn?.includes('.'))continue;const split=member(fn),c=context(file,item.scope,offset(e)),object=resolve(split.base,c);if(object?.kind!=='object')continue;
   const mount=policy.mounts.find(m=>m.method===split.name&&m.framework===object.rule.framework);if(mount){const child=resolve(argument(e,'',0)?.name||'',c);if(child?.kind==='object'){const prefix=textValue(argument(e,mount.prefix),c);prefix.basis.push({kind:'call',location:e.location,note:mount.method+' 挂载'});mounts.set(child.key,[...(mounts.get(child.key)||[]),{parent:object,prefix,override:mount.override&&!!argument(e,mount.prefix),conditions:item.conditions}]);}else index.diagnostics.push({file,message:'有一处路由挂载对象没识别出来，已保留可以确认的接口。',severity:'warning'});}
   if(object.rule.framework==='Flask'&&split.name==='add_url_rule'){
    const expr=argument(e,'view_func',2),view=expr?.kind==='call'?call(expr,c,`${file}:${offset(expr)}`,'',new Set()):resolve(expr?.name||'',c),path=textValue(argument(e,'rule',0),c);
    if(view?.kind==='scope')for(const method of methods(argument(e,'methods'),c,policy.defaultMethods.add_url_rule))routes.push({object,symbolId:view.symbolId,method,path,location:e.location,conditions:item.conditions});
    if(view?.kind==='view'&&bases(view.klass).some(b=>b?.kind==='external'&&b.name==='flask.views.MethodView'))for(const method of methods(argument(e,'methods'),c,policy.httpMethods.filter(m=>!!handler(view.klass,m.toLowerCase())))){const symbol=handler(view.klass,method.toLowerCase());if(symbol)routes.push({object,symbolId:symbol.id,method,path,location:e.location,conditions:item.conditions});}
   }
  }
 }
 function prefixes(object:ObjectRef,seen=new Set<string>()):{path:Evaluated;conditions:Location[]}[]{
  if(seen.has(object.key))return[{path:unknown(object.expression,'路由挂载形成循环，前缀未确定'),conditions:[]}];seen=new Set(seen).add(object.key);
  const own=textValue(object.rule.prefix?argument(object.expression,object.rule.prefix):undefined,object.context),parents=mounts.get(object.key);if(own.issues.length&&!own.value.startsWith('/'))own.value='/'+own.value;if(!parents)return[{path:own,conditions:[]}];
  return parents.flatMap(m=>prefixes(m.parent,seen).map(p=>{const values=[p.path,m.prefix,...(m.override?[]:[own])];return{path:{value:values.map(v=>v.value).join(''),...merge(values)},conditions:[...p.conditions,...m.conditions]};}));
 }
 const labels=new Map<string,string>();
 function label(o:ObjectRef){if(labels.has(o.key))return labels.get(o.key)!;const raw=o.rule.kind==='blueprint'?argument(o.expression,'name',0):argument(o.expression,'tags'),value=evaluate(raw,o.context),name=!value.issues.length&&(Array.isArray(value.value)?value.value[0]:value.value);const owner=index.symbols.find(s=>s.id===o.context.scope);const text=typeof name==='string'&&name?name:owner?`${owner.name} · ${o.name}`:o.name;labels.set(o.key,text);return text;}
 function emit(symbolId:string,method:string,path:Evaluated,location:Location,group:string,moduleName:string,basis:string,conditions:Location[]=[],parent?:EntryPoint['moduleParent'],reason?:string){
  const symbol=index.symbols.find(s=>s.id===symbolId);if(!symbol)return;const url=converted(joined(String(path.value))),display=`${method} ${url}`,issues=path.issues;
  symbol.role=basis.split('；')[0];if(!symbol.routes.includes(display))symbol.routes.push(display);
  const id=`http:${symbol.id}:${display}`,existing=entries.find(e=>e.id===id);if(existing)return existing;
  const entry:EntryPoint={id,kind:'http',name:`${display} · ${symbol.name}`,symbolId:symbol.id,location,group,owner:moduleName,moduleName,moduleParent:parent,area:sourceArea(location.file),basis,status:issues.length?'unresolved':'resolved',reason:reason||(issues.length?'前缀来自配置，值未确定':undefined),pathEvidence:{method,path:url,basis:path.basis,defaults:path.defaults,issues,conditions}};entries.push(entry);return entry;
 }
 for(const route of routes){const files=new Set(routes.filter(r=>r.object.key===route.object.key).map(r=>r.location.file)),branch=route.object.rule.kind==='blueprint'&&files.size>1,name=label(route.object),moduleName=branch?`${name} · ${path.posix.basename(route.location.file,'.py')}`:name,group=branch?`${route.object.key}:routes:${route.location.file}`:route.object.key,parent=branch?{id:route.object.key,name,location:route.object.expression.location}:undefined;
  for(const prefix of prefixes(route.object)){const values=[prefix.path,route.path];emit(route.symbolId,route.method,{value:values.map(v=>v.value).join(''),...merge(values)},route.location,group,moduleName,`${route.object.rule.framework}；${moduleName}`,[...prefix.conditions,...route.conditions],parent);}
 }
 extractDjangoEntries({result,objects,context,offset,localFile,resolve,call,evaluate,textValue,bases,handler,argument,merge,emit});
 index.httpModules=[];for(const e of entries.filter(e=>e.moduleName)){if(e.moduleParent&&!index.httpModules.some(m=>m.id===e.moduleParent!.id))index.httpModules.push({...e.moduleParent,entryIds:[]});let group=index.httpModules.find(m=>m.id===e.group);if(!group){group={id:e.group,name:e.moduleName!,parentId:e.moduleParent?.id,entryIds:[],location:e.location};index.httpModules.push(group);}group.entryIds.push(e.id);if(e.moduleParent)index.httpModules.find(m=>m.id===e.moduleParent!.id)!.entryIds.push(e.id);}
 index.versions.pythonHttp=policy.version;
}
