import type {ProjectIndex,SymbolInfo,Location} from '../shared/model';
import policy from '../shared/dependency-policy.json';
import frontendPolicy from '../shared/frontend-policy.json';
export type DependencyRole=typeof policy.roles[number]['id'];
export interface DependencyUnit {id:string;name:string;file:string;module:string;symbol?:SymbolInfo;role:string;basis:string;layer:number;color:string;classes:number;location:Location}
export const roleInfo=(id:string)=>policy.roles.find(r=>r.id===id)||frontendPolicy.roles.find(r=>r.id===id)||policy.roles.at(-1)!;
export function dependencyFacts(index:ProjectIndex){
 const files=new Map((index.typeFiles||[]).map(f=>[f.file,f]));
 const resolveBinding=(value:string,file:string,seen=new Set<string>()):string=>{
  const key=file+':'+value;if(seen.has(key))return value;seen.add(key);const context=files.get(file),[head,...tail]=value.split('.'),imported=context?.imports[head];
  if(imported){const qualified=[imported,...tail].join('.');const parts=qualified.split('.');for(let n=parts.length-1;n>0;n--){const module=parts.slice(0,n).join('.'),name=parts[n],matching=[...files.values()].filter(f=>f.namespace===module||f.namespace.endsWith('.'+module));if(matching.length===1){const binding=matching[0].bindings.find(b=>b.name===name);if(binding)return [resolveBinding(binding.callee,matching[0].file,seen),...parts.slice(n+1)].join('.');}}return qualified;}
  const binding=context?.bindings.find(b=>b.name===head);if(binding)return [resolveBinding(binding.callee,file,seen),...tail].join('.');
  return value;
 };
 const canonical=(value:string,file:string)=>{const context=files.get(file);const result=resolveBinding(value,file);if(result!==value)return result;const local=index.symbols.find(s=>s.qualifiedName===context?.namespace+'.'+value);if(local)return local.qualifiedName;const wildcard=context?.imports['*'];return wildcard&&!value.includes('.')?wildcard.replace(/\*$/,value):value;};
 const bases=(symbol:SymbolInfo)=>[...(symbol.typeEvidence?.bases||[]),...index.relations.filter(r=>r.from===symbol.id&&['EXTENDS','IMPLEMENTS'].includes(r.type)).map(r=>r.target)].map(b=>b.replace(/[\w.$]+/g,part=>canonical(part,symbol.file)));
 const infer=(symbol:SymbolInfo)=>{
  const inherited=new Set<string>(),queue=[...bases(symbol)];while(queue.length){const base=queue.shift()!;if(inherited.has(base))continue;inherited.add(base);const target=index.symbols.find(s=>s.qualifiedName===base.replace(/<.*>/,''));if(target)queue.push(...bases(target));}
  const signals=[{kind:'shape',value:symbol.typeEvidence?.staticOnly?'static-only':''},{kind:'declaration',value:symbol.declaration||''},...(symbol.typeEvidence?.annotations||[]).map(a=>({kind:'annotation',value:canonical(a,symbol.file)})),...[...inherited].map(value=>({kind:'base',value}))];
  for(const rule of policy.signals)if(!('requiresTable' in rule&&rule.requiresTable&&!symbol.typeEvidence?.table)&&signals.some(s=>s.kind===rule.kind&&new RegExp(rule.pattern).test(s.value)))return{role:rule.role,basis:rule.basis};
  const declared=({Controller:'controller',Service:symbol.kind==='interface'?'service-interface':'service',Repository:'data'} as Record<string,string>)[symbol.role||''];if(declared)return{role:declared,basis:'已保存的框架组件声明'};
  for(const rule of policy.suffixes)if(new RegExp(rule.pattern).test(symbol.name))return{role:symbol.kind==='interface'&&'interfaceRole' in rule?rule.interfaceRole!:rule.role,basis:rule.basis};
  return{role:'other',basis:'没有足够的职责声明，保留类名'};
 };
 const units:DependencyUnit[]=index.symbols.filter(s=>['class','interface'].includes(s.kind)).map(symbol=>{const inferred=infer(symbol),info=roleInfo(inferred.role);return{id:symbol.id,name:symbol.name,file:symbol.file,module:symbol.module,symbol,...inferred,layer:info.layer,color:info.color,classes:1,location:{file:symbol.file,range:symbol.selection}};});
 const byId=new Map(units.map(u=>[u.id,u]));
 for(const r of index.relations.filter(r=>r.type==='IMPLEMENTS'&&r.to)){const source=byId.get(r.from),target=byId.get(r.to!);if(source?.role==='service'&&target&&target.role==='other')Object.assign(target,{role:'service-interface',basis:'由已声明服务实现的接口',layer:roleInfo('service-interface').layer,color:'business'});}
 const typeArguments:{from:string;to:string}[]=[];
 for(const mapper of units.filter(u=>u.role==='data'))for(const result of mapper.symbol?.typeEvidence?.returns||[])if(policy.sqlResultAnnotations.some(rule=>result.annotations.some(a=>new RegExp(rule.pattern).test(canonical(a,mapper.file)))))for(const token of result.type.match(/[\w.$]+/g)||[]){const qualified=canonical(token,mapper.file),target=units.find(u=>u.symbol?.qualifiedName===qualified);if(target){Object.assign(target,{role:'entity',basis:'Mapper SQL 查询声明的结果对象类型',layer:roleInfo('entity').layer,color:'data'});typeArguments.push({from:mapper.id,to:target.id});}}
 for(const mapping of index.typeMappings||[]){const mapper=units.find(u=>u.symbol?.qualifiedName===mapping.typeName);if(!mapper)continue;for(const name of mapping.entityNames||[]){const qualified=canonical(name,mapper.file),targets=units.filter(u=>u.symbol?.qualifiedName===qualified);if(targets.length===1){const target=targets[0];Object.assign(target,{role:'entity',basis:'Mapper XML 的 resultMap / resultType 与实际类型相符',layer:roleInfo('entity').layer,color:'data'});typeArguments.push({from:mapper.id,to:target.id});}}}
 for(const unit of [...units])for(const base of unit.symbol?bases(unit.symbol):[])for(const rule of policy.signals){if(rule.kind!=='base'||!('entityArgument' in rule)||!new RegExp(rule.pattern).test(base))continue;const args=base.match(/<([\s\S]+)>/)?.[1]?.split(/,(?![^<]*>)/),arg=args?.[rule.entityArgument!]?.trim();if(!arg)continue;const local=unit.symbol!.qualifiedName.split('.').slice(0,-1).join('.')+'.'+arg;const targets=units.filter(u=>u.symbol?.qualifiedName===arg||u.symbol?.qualifiedName===local);if(targets.length===1){const target=targets[0];Object.assign(target,{role:'entity',basis:rule.basis+'；实际实体类型参数',layer:roleInfo('entity').layer,color:'data'});typeArguments.push({from:unit.id,to:target.id});}}
 const entityQueue=units.filter(u=>u.role==='entity');const inheritedEntities=new Set<string>();while(entityQueue.length){const unit=entityQueue.shift()!;if(inheritedEntities.has(unit.id))continue;inheritedEntities.add(unit.id);for(const relation of index.relations.filter(r=>r.from===unit.id&&r.type==='EXTENDS'&&r.to)){const parent=byId.get(relation.to!);if(parent&&parent.role==='other'){Object.assign(parent,{role:'entity',basis:'实体类继承的本地字段基类',layer:roleInfo('entity').layer,color:'data'});entityQueue.push(parent);}}}
 for(const file of index.files.filter(f=>f.language==='python')){
  const functions=index.symbols.filter(s=>s.file===file.path&&s.kind==='function'&&!s.parent),context=files.get(file.path);if(!functions.length&&!context?.bindings.length&&units.some(u=>u.file===file.path))continue;
  const bindingSignals=[...(context?.bindings.map(b=>canonical(b.callee,file.path))||[]),...Object.entries(context?.imports||{}).flatMap(([name,target])=>{const actual=canonical(name,file.path);return actual!==target?[actual]:[];})];
  const signal=policy.signals.find(r=>r.kind==='binding'&&bindingSignals.some(v=>new RegExp(r.pattern).test(v)));
  const routed=index.entries?.some(e=>e.kind==='http'&&e.location.file===file.path)||context?.annotations.some(name=>{const split=name.lastIndexOf('.'),method=name.slice(split+1),receiver=canonical(name.slice(0,split),file.path);return policy.routeDecorators.some(d=>d.name===method)&&policy.signals.some(r=>r.kind==='binding'&&new RegExp(r.pattern).test(receiver));});
  const role=routed?'controller':signal?'config':'other',info=roleInfo(role),first=functions[0];
  units.push({id:'dependency:file:'+file.path,name:file.path.split('/').at(-1)!,file:file.path,module:file.module,role,basis:routed?'文件中已确认的 HTTP 入口':signal?.basis||'项目中的 Python 源码文件',layer:info.layer,color:info.color,classes:0,location:{file:file.path,range:first?.selection||{start:{line:0,character:0},end:{line:0,character:1}}}});
 }
 const imports:{from:string;to:string;location:Location}[]=[];
 for(const file of files.values())for(const [name,qualified] of Object.entries(file.imports)){const exact=units.filter(u=>u.symbol?.qualifiedName===qualified),targets=exact.length?exact:units.filter(u=>u.symbol?.language==='python'&&u.symbol.qualifiedName.endsWith('.'+qualified));if(targets.length!==1)continue;const from=units.find(u=>u.file===file.file&&!u.symbol)||units.find(u=>u.file===file.file);if(from)imports.push({from:from.id,to:targets[0].id,location:file.importLocations?.[name]||from.location});}
 return {units,typeArguments,imports};
}
