import type {Evidence,Location,SymbolInfo} from '../shared/model';
import type {PyExpression as Expr} from './python-http-facts';
import type {PythonHttpAPI,Context,ScopeRef,Ref,Evaluated,ObjectRef} from './python-http';
import {isTestFile} from '../shared/source-roles';
import {djangoPath} from './django-path';
import {drfVersion} from './drf-version';
import policy from '../shared/python-http-rules.json';
import drf from '../shared/drf-http-rules.json';

type Definition={member:string;file:string;line:number;delegate?:string};
type FrameworkClass={type:string;kind:string;http:Record<string,Definition>;actions:Record<string,Definition>;basis:string};
type Member={symbolId:string;name:string;basis:Evidence[];delegate?:string;drf?:boolean};
type Group={file:string;namespace:string[];label:string};
export function extractDjangoEntries(api:PythonHttpAPI){
 const{result,context,resolve,evaluate,argument,merge}=api,{index,syntax}=result,byId=new Map(index.symbols.map(s=>[s.id,s]));
 const proof=(location:Location,note:string):Evidence=>({kind:'declaration',location,note});
 const at=(klass:ScopeRef):Location=>({file:klass.file,range:byId.get(klass.symbolId)!.selection});
 const versionCache=new Map<string,ReturnType<typeof drfVersion>>();
 const version=(file:string)=>{let v=versionCache.get(file);if(!v){v=drfVersion(result,file);versionCache.set(file,v);}return v;};
 const row=(name:string,file:string)=>version(file).table.classes.find(r=>r.type===name) as FrameworkClass|undefined;
 const warning=(file:string,message:string)=>{if(!index.diagnostics.some(d=>d.file===file&&d.message===message))index.diagnostics.push({file,message,severity:'warning'});};
 function dereference(e:Expr,c:Context,seen=new Set<string>()):{e:Expr;c:Context;ref?:Ref}{
  if(e.kind!=='ref')return{e,c};const key=c.file+':'+c.scope+':'+e.name;if(seen.has(key))return{e,c};
  const ref=resolve(e.name||'',c);return ref?.kind==='value'?dereference(ref.expression,ref.context,new Set([...seen,key])):{e,c,ref};
 }
 function member(klass:ScopeRef,name:string,seen=new Set<string>()):Member|undefined{
  if(seen.has(klass.symbolId)||seen.size>drf.thresholds.inheritanceDepth.value)return;seen=new Set([...seen,klass.symbolId]);
  const own=api.handler(klass,name);if(own)return{symbolId:own.id,name,basis:[proof({file:own.file,range:own.selection},'这个方法在项目中定义')]};
  if(syntax.get(klass.file)?.python?.bindings.some(b=>b.scope===klass.scope&&b.name===name))return;
  for(const base of api.bases(klass)){
   if(base?.kind==='scope'){const found=member(base,name,seen);if(found)return found;}
   if(base?.kind==='external'){const rule=row(base.name,klass.file),definition=rule?.http[name.toUpperCase()]||rule?.actions[name];if(definition)return{symbolId:klass.symbolId,name,delegate:definition.delegate,basis:[proof(at(klass),`${version(klass.file).label}：${rule!.basis}；${definition.file}:${definition.line}`)]};}
  }
 }
 function kind(klass:ScopeRef,seen=new Set<string>()):string|undefined{
  if(seen.has(klass.symbolId))return;seen=new Set([...seen,klass.symbolId]);let found;
  for(const b of api.bases(klass)){const value=b?.kind==='scope'?kind(b,seen):b?.kind==='external'?(row(b.name,klass.file)?.kind||(policy.djangoViewBases.includes(b.name)?'django-view':undefined)):undefined;if(value==='viewset')return value;if(value==='view'||value==='django-view'&&found!=='view')found=value;}
  return found;
 }
 function property(klass:ScopeRef,name:string,seen=new Set<string>()):Evaluated|undefined{
  if(seen.has(klass.symbolId))return;seen=new Set([...seen,klass.symbolId]);
  if(syntax.get(klass.file)?.python?.bindings.some(b=>b.scope===klass.scope&&b.name===name)){const ref=resolve(name,context(klass.file,klass.scope));if(ref?.kind==='value')return evaluate(ref.expression,ref.context);}
  for(const b of api.bases(klass))if(b?.kind==='scope'){const value=property(b,name,seen);if(value)return value;}
 }
 function allowed(klass:ScopeRef,verb:string){const names=property(klass,'http_method_names');return!names||names.issues.length||Array.isArray(names.value)&&names.value.map(String).map(s=>s.toUpperCase()).includes(verb);}
 function publish(klass:ScopeRef|undefined,target:Member,verb:string,path:Evaluated,location:Location,group:Group){
  if(klass&&!allowed(klass,verb))return;
  const useDrf=klass?kind(klass)!=='django-view':target.drf,v=version(location.file),basis=[...path.basis,...target.basis,...useDrf?v.basis:[]];
  const entry=api.emit(target.symbolId,verb,{...path,basis},location,`django:${group.file}:${group.namespace.join(':')}`,group.namespace.join(':')||group.label,useDrf?`Django；${v.label}`:'Django；URL 声明',[],undefined,path.issues.length?'路径未确定：'+[...new Set(path.issues.map(i=>i.reason))].join('；'):undefined);
  if(entry&&useDrf)entry.frameworkMapping={name:'DRF',version:v.table.version,declaredVersions:v.declared,approximate:v.approximate,basis:v.basis};
 }
 const registrations=new Map<string,{prefix:Evaluated;klass:ScopeRef;location:Location}[]>();
 for(const[file,facts]of syntax){if(isTestFile(file,index))continue;for(const item of facts.python?.calls||[]){const e=item.expression,name=e.callee?.name;if(!name?.endsWith('.register'))continue;const c=context(file,item.scope,api.offset(e)),object=resolve(name.slice(0,-9),c),klass=resolve(argument(e,'viewset',1)?.name||'',c);if(object?.kind==='object'&&object.rule.kind==='drf-router'&&klass?.kind==='scope')registrations.set(object.key,[...(registrations.get(object.key)||[]),{prefix:api.textValue(argument(e,'prefix',0),c),klass,location:e.location}]);}}
 const pathValue=(e:Expr|undefined,c:Context,regex=false)=>{const value=api.textValue(e,c);if(!regex||value.issues.length)return value;const normalized=djangoPath(value.value);return{...value,value:normalized.value,issues:normalized.reason?[{location:e!.location,expression:e!.text,reason:normalized.reason}]:[]};};
 const append=(...parts:Evaluated[]):Evaluated=>({value:parts.map(p=>String(p.value)).join(''),...merge(parts)});
 function router(object:ObjectRef,prefix:Evaluated,group:Group,collect:boolean){
  if(collect)return;
  for(const registration of registrations.get(object.key)||[]){const{klass}=registration;if(kind(klass)!=='viewset'){warning(klass.file,'路由器中的类没有可确认的视图动作，已保留其他接口');continue;}
   const trailing=argument(object.expression,'trailing_slash'),trailingValue=trailing?evaluate(trailing,object.context):undefined,slash=trailingValue?.issues.length?String(trailingValue.value):trailingValue?.value===false?'':drf.defaults.trailingSlash;
   const key=property(klass,'lookup_url_kwarg'),field=key?.value?key:property(klass,'lookup_field'),lookup=typeof field?.value==='string'&&!field.issues.length?field.value:drf.defaults.lookup;
   const own={...registration.prefix,basis:[...registration.prefix.basis,proof(registration.location,'这里把视图注册到路由器')]};
   for(const action of policy.drfActions){const target=member(klass,action.name);if(!target)continue;const suffix={value:(action.detail?'/{'+lookup+'}':'')+slash,basis:[...field?.basis||[],...trailingValue?.basis||[]],defaults:!field,issues:[...field?.issues||[],...trailingValue?.issues||[]]};publish(klass,target,action.method,append(prefix,own,suffix),registration.location,group);}
   const scopes:ScopeRef[]=[];const visit=(k:ScopeRef,seen=new Set<string>())=>{if(seen.has(k.symbolId))return;scopes.push(k);for(const b of api.bases(k))if(b?.kind==='scope')visit(b,new Set([...seen,k.symbolId]));};visit(klass);
   const names=new Set<string>();for(const scope of scopes)for(const symbol of index.symbols.filter(s=>s.parent===scope.symbolId&&s.kind==='method')){if(names.has(symbol.name))continue;names.add(symbol.name);
    for(const d of syntax.get(scope.file)?.python?.decorators.filter(d=>d.symbolId===symbol.id)||[]){const ref=resolve(d.expression.callee?.name||d.expression.name||'',context(scope.file,d.scope)),rule=ref?.kind==='external'&&version(scope.file).table.decorators.find(r=>r.type===ref.name);if(!rule)continue;
     const detailExpr=argument(d.expression,'detail'),detail=rule.detail===null?(detailExpr?evaluate(detailExpr,context(scope.file,d.scope)).value:undefined):rule.detail;if(typeof detail!=='boolean'){warning(scope.file,'有一个额外动作没有写明用于列表还是单项，未补造路径');continue;}
     const methodExpr=argument(d.expression,'methods'),verbs=methodExpr?evaluate(methodExpr,context(scope.file,d.scope)):{value:['GET'],basis:[],defaults:true,issues:[]};if(verbs.issues.length||!Array.isArray(verbs.value)){warning(scope.file,'有一个额外动作的方法来自变量，未补造 HTTP 方法');continue;}
     const extra=argument(d.expression,'url_path'),extraPath=extra?pathValue(extra,context(scope.file,d.scope),true):{value:symbol.name,basis:[],defaults:true,issues:[]},suffix={value:(detail?'/{'+lookup+'}':'')+'/'+String(extraPath.value)+slash,basis:[...extraPath.basis,...trailingValue?.basis||[],proof(d.location,rule.basis)],defaults:extraPath.defaults,issues:[...extraPath.issues,...trailingValue?.issues||[]]};
     for(const verb of verbs.value.map(String).map(s=>s.toUpperCase()))if(policy.httpMethods.includes(verb))publish(klass,{symbolId:symbol.id,name:symbol.name,basis:[proof({file:symbol.file,range:symbol.selection},'项目中定义的额外动作')]},verb,append(prefix,own,suffix),registration.location,group);
    }
   }
  }
 }
 const included=new Set<string>();
 function include(e:Expr,c:Context,prefix:Evaluated,group:Group,seen:Set<string>,collect:boolean){
  let arg=argument(e,'module',0),appName=argument(e,'app_name'),instance=argument(e,'namespace',1),appContext=c,instanceContext=c;if(!arg)return;
  const unpacked=dereference(arg,c);arg=unpacked.e;c=unpacked.c;
  if(arg.kind==='list'&&arg.sequence==='tuple'){if(arg.items?.[1]){appName=arg.items[1];appContext=c;}if(!instance&&arg.items?.[2]){instance=arg.items[2];instanceContext=c;}arg=arg.items?.[0];if(!arg)return;}
  let file:string|undefined,ref=arg.kind==='ref'?resolve(arg.name||'',c):undefined,source=arg,sourceContext=c;
  if(arg.kind==='literal'&&typeof arg.value==='string')file=api.localFile(c.file,arg.value);
  else if(ref?.kind==='module')file=ref.file;
  if(file){included.add(file);const value=resolve('urlpatterns',context(file));if(value?.kind!=='value')return;source=value.expression;sourceContext=value.context;if(!appName){const r=resolve('app_name',context(file));if(r?.kind==='value'){appName=r.expression;appContext=r.context;}}}
  else if(ref?.kind==='value'){source=ref.expression;sourceContext=ref.context;if(sourceContext.file!==group.file)included.add(sourceContext.file);}
  const namespace=instance?evaluate(instance,instanceContext):appName?evaluate(appName,appContext):undefined;
  const name=typeof namespace?.value==='string'&&!namespace.issues.length?namespace.value:undefined;
  const next:Group={file:file||sourceContext.file,namespace:name?[...group.namespace,name]:group.namespace,label:file?(arg.kind==='literal'?String(arg.value):arg.text):group.label};
  walk(source,sourceContext,{...prefix,basis:[...prefix.basis,proof(e.location,'这里引入下一层路径'),...namespace?.basis||[]]},next,seen,collect);
 }
 function view(e:Expr,c:Context,path:Evaluated,location:Location,group:Group,collect:boolean){
  if(collect)return;const ref=e.kind==='call'?api.call(e,c,c.file+':'+api.offset(e),'',new Set()):resolve(e.name||'',c);if(ref?.kind!=='scope'&&ref?.kind!=='view')return;
  const klass=ref.kind==='view'?ref.klass:ref,symbol=byId.get(klass.symbolId);if(!symbol)return;
  if(symbol.kind!=='class'){
   const d=syntax.get(klass.file)?.python?.decorators.find(d=>d.symbolId===klass.symbolId&&(()=>{const r=resolve(d.expression.callee?.name||d.expression.name||'',context(klass.file,d.scope));return r?.kind==='external'&&r.name===policy.apiView;})());
   const value=d?argument(d.expression,'',0):undefined,methods=value?evaluate(value,context(klass.file,d!.scope)):{value:d?['GET']:['ANY'],basis:[],defaults:true,issues:[]};
   if(methods.issues.length){warning(klass.file,'函数视图的方法没有固定值，未补造 HTTP 方法');return;}
   for(const verb of(Array.isArray(methods.value)?methods.value:[methods.value]).map(String).map(s=>s.toUpperCase()))publish(undefined,{symbolId:symbol.id,name:symbol.name,basis:methods.basis,drf:!!d},verb,path,location,group);return;
  }
  const type=kind(klass);if(!type)return;
  if(type==='viewset'){
   const mapping=ref.kind==='view'&&ref.expression?argument(ref.expression,'actions',0):undefined;if(!mapping)return;const unwrapped=dereference(mapping,ref.kind==='view'&&ref.context||c);if(unwrapped.e.kind!=='dict'){warning(c.file,'视图动作表没有固定值，未补造接口');return;}
   for(const pair of unwrapped.e.pairs||[]){const verb=evaluate(pair.key,unwrapped.c),action=evaluate(pair.value,unwrapped.c);if(verb.issues.length||action.issues.length)continue;const target=member(klass,String(action.value));if(target)publish(klass,target,String(verb.value).toUpperCase(),path,location,group);}return;
  }
  for(const verb of policy.httpMethods){const target=member(klass,verb.toLowerCase());if(!target)continue;const delegated=target.delegate&&member(klass,target.delegate),actual=delegated&&byId.get(delegated.symbolId)?.kind==='method'?delegated:target;publish(klass,actual,verb,path,location,group);}
 }
 function walk(e:Expr|undefined,c:Context,prefix:Evaluated,group:Group,seen=new Set<string>(),collect=false):void{
  if(!e)return;const key=c.file+':'+c.scope+':'+api.offset(e);if(seen.has(key))return;seen=new Set([...seen,key]);
  if(e.kind==='ref'&&e.name?.endsWith('.urls')){const object=resolve(e.name.slice(0,-5),c);if(object?.kind==='object'&&object.rule.kind==='drf-router'){router(object,prefix,group,collect);return;}}
  if(e.kind==='ref'){const ref=resolve(e.name||'',c);if(ref?.kind==='value')walk(ref.expression,ref.context,prefix,group,seen,collect);return;}
  if(e.kind==='list'||e.kind==='join'){for(const child of e.items||[])walk(child,c,prefix,group,seen,collect);return;}
  if(e.kind!=='call')return;const target=resolve(e.callee?.name||'',c);if(target?.kind!=='external')return;
  if(target.name==='rest_framework.urlpatterns.format_suffix_patterns'){walk(argument(e,'urlpatterns',0),c,prefix,group,seen,collect);return;}
  if(!policy.djangoPatterns.includes(target.name))return;
  const expr=argument(e,'route',0)||argument(e,'regex'),own=pathValue(expr,c,policy.djangoRegex.includes(target.name)),next=append(prefix,own),handler=argument(e,'view',1);if(!handler)return;
  const mounted=handler.kind==='call'&&resolve(handler.callee?.name||'',c);if(mounted&&mounted.kind==='external'&&policy.djangoIncludes.includes(mounted.name))include(handler,c,next,group,seen,collect);else view(handler,c,next,e.location,group,collect);
 }
 const collections=[...syntax].flatMap(([file,f])=>isTestFile(file,index)?[]:(f.python?.bindings||[]).filter(b=>b.name==='urlpatterns'&&b.scope===context(file).scope).map(b=>({file,b})));
 for(const{file,b}of collections)walk(b.expression,context(file),evaluate(undefined,context(file)),{file,namespace:[],label:'urlpatterns · '+file},new Set(),true);
 const roots=new Set<string>();for(const[file,f]of syntax)for(const b of f.python?.bindings.filter(b=>b.name==='ROOT_URLCONF'&&b.scope===context(file).scope)||[]){const value=evaluate(b.expression,context(file));if(!value.issues.length&&typeof value.value==='string'){const target=api.localFile(file,value.value);if(target)roots.add(target);}}
 for(const{file,b}of collections.filter(c=>roots.size?roots.has(c.file):!included.has(c.file)))walk(b.expression,context(file),evaluate(undefined,context(file)),{file,namespace:[],label:'urlpatterns · '+file});
 index.versions.drfHttp=drf.version;
}
