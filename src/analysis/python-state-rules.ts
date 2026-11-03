import path from 'node:path';
import type { Evidence, SymbolInfo } from '../shared/model';
import { basis, type Value } from './code-facts';
import type { RuleContext } from './rule-context';
export function pythonStateRules(ctx:RuleContext){
 const {index,facts,byId,at,put}=ctx;
 const shadow=index.files.some(f=>/(?:^|\/)fastapi(?:\.py|\/__init__\.py)$/.test(f.path));
 function imported(file:string,name:string,scope?:string){
  const program=facts.get(file),scopes=new Set([scope,`file:${file}`]);let parent=scope&&byId.get(scope)?.parent;
  while(parent){scopes.add(parent);parent=byId.get(parent)?.parent;}
  return program?.imports.filter(i=>scopes.has(i.scope)&&i.name===name).at(-1);
 }
 function resolveType(file:string,name:string,scope?:string):SymbolInfo[]{
  const local=index.symbols.filter(s=>s.file===file&&s.kind==='class'&&s.name===name);if(local.length)return local;
  const ref=imported(file,name,scope);if(!ref)return [];
  const target=ref.target.split('.'),type=target.pop()!,module=target.join('.'),dots=module.match(/^\.+/)?.[0].length||0;
  const base=dots?path.posix.dirname(file).split('/').slice(0,path.posix.dirname(file).split('/').length-dots+1).join('/'):'';
  const location=(base?base+'/':'')+module.slice(dots).replaceAll('.','/');
  return index.symbols.filter(s=>s.name===type&&s.kind==='class'&&(s.file===location+'.py'||s.file===location+'/__init__.py'));
 }
 type Instance={type:SymbolInfo;evidence:Evidence[];conditions:string[]};
 function field(instances:Instance[],name:string):Instance[]{
  return instances.flatMap(instance=>{
   const ctors=index.symbols.filter(s=>s.parent===instance.type.id&&s.name==='__init__'),program=facts.get(instance.type.file)!;
   return program.assignments.filter(a=>ctors.some(c=>c.id===a.scope)&&a.left===`self.${name}`).flatMap(a=>a.value.callee?resolveType(instance.type.file,a.value.callee,a.scope).map(type=>({type,evidence:[...instance.evidence,basis('assignment',a.location,`${a.left} = ${a.value.callee}(…)`)],conditions:[...instance.conditions,...a.conditions]})):[]);
  });
 }
 const refType=(file:string,value:Value,scope:string,evidence:Evidence[],conditions:string[])=>value.callee?resolveType(file,value.callee,scope).map(type=>({type,evidence,conditions})):[];
 for(const [file,program] of facts){if(shadow||!file.endsWith('.py'))continue;
  for(const route of ctx.result.syntax.get(file)?.routes||[]){
   const recognized=index.entries?.find(e=>e.kind==='http'&&e.symbolId===route.symbolId);if(!recognized)continue;
   const routeSymbol=byId.get(route.symbolId)!,scope=route.scope.endsWith(':module')?`file:${file}`:route.scope;
   const bindings=program.assignments.filter(a=>a.scope===scope&&a.left===route.object&&recognized.group.endsWith(`:${a.left}:${a.offset}:`)&&a.value.callee&&['fastapi.FastAPI','fastapi.APIRouter'].includes(imported(file,a.value.callee,scope)?.target||''));
   const params=program.definitions.find(d=>d.id===route.symbolId)?.params||[];
   const requests=params.filter(p=>imported(file,p.type,route.symbolId)?.target==='fastapi.Request');
   for(const request of requests)for(const call of program.calls.filter(c=>c.scope===route.symbolId&&c.callee.startsWith(request.name+'.app.state.'))){
    const segments=call.callee.slice((request.name+'.app.state.').length).split('.'),property=segments.shift()!,method=segments.pop()!;
    let instances:Instance[]=[],assignments=0;
    for(const binding of bindings){
     const life=binding.value.args?.find(a=>a.name==='lifespan')?.value.text;
     const lifespan=index.symbols.filter(s=>s.file===file&&s.name===life&&(s.parent===route.scope||!s.parent&&scope===`file:${file}`));
     for(const fn of lifespan){
      const appParameter=program.definitions.find(d=>d.id===fn.id)?.params[0]?.name;if(!appParameter)continue;
      const writes=program.assignments.filter(a=>a.scope===fn.id&&a.left===`${appParameter}.state.${property}`);assignments+=writes.length;
      for(const write of writes)instances.push(...refType(file,write.value,fn.id,[basis('assignment',binding.location,`${route.object} = ${binding.value.callee}(lifespan=${life})`),basis('assignment',write.location,`${write.left} = ${write.value.callee||'动态对象'}(…)`)],write.conditions));
     }
    }
    for(const segment of segments)instances=field(instances,segment);
    const targets=instances.flatMap(instance=>index.symbols.filter(s=>s.parent===instance.type.id&&s.name===method&&['method','function'].includes(s.kind)).map(target=>({instance,target})));
    const unique=bindings.length===1&&assignments===1&&targets.length===1;
    for(const {instance,target} of targets){put({from:routeSymbol.id,to:target.id,target:target.qualifiedName,type:'CALLS',status:unique?'resolved':'candidate',locations:[call.location],invocation:'sync'}, {id:'fastapi.lifespan-state',outcome:unique?'unique':'candidate',basis:[basis('declaration',at(routeSymbol),'同一 FastAPI 对象的路由与 Request 参数'),basis('call',call.location,call.callee),...instance.evidence,basis('definition',at(target),target.qualifiedName)],conditions:[...call.conditions,...instance.conditions,...(!unique?['多赋值 / 多对象来源；运行分支尚未唯一确认']:[])]});if(unique&&!routeSymbol.summary)routeSymbol.summary='调用 '+instance.type.name+'.'+target.name;}
   }
   // Dependencies are authentication/support branches, kept separate from the business chain.
   const definition=program.definitions.find(d=>d.id===route.symbolId);
   for(const dep of definition?.annotations.matchAll(/Depends\(\s*(\w+)\s*\)/g)||[]){const target=index.symbols.find(s=>s.file===file&&s.parent===routeSymbol.parent&&s.name===dep[1]);if(target)put({from:routeSymbol.id,to:target.id,target:target.qualifiedName,type:'CALLS',status:'resolved',locations:[route.location],auxiliary:true},{id:'fastapi.depends',outcome:'unique',basis:[basis('declaration',route.location,`Depends(${target.name})`),basis('definition',at(target),target.qualifiedName)],conditions:[]});}
  }
 }
 return {resolveType,imported,field};
}
