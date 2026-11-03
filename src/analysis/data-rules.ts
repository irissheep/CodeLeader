import type { Evidence, Location, SymbolInfo } from '../shared/model';
import type { RuleContext } from './rule-context';
import { basis } from './code-facts';
import {mybatisRules} from './mybatis-rules';
export function dataRules(ctx:RuleContext,python?:{resolveType:(file:string,name:string,scope?:string)=>SymbolInfo[]}){
 const {index,facts,byId,annotation,entity,put,at,config}=ctx;
 const service=(id?:string)=>config.deployments.find(d=>d.id===id);
 const database=(serviceId?:string)=>{
  const configValue=config.resolve('spring.datasource.url',service(serviceId)),host=configValue?.value.match(/^jdbc:[^:]+:\/\/([^:/]+)/)?.[1];
  const deployment=config.deployments.find(d=>d.name===host&&/mysql|postgres|mariadb/.test(d.image||''));
  const id=deployment?`resource:${deployment.id}`:`resource:database:${serviceId||'project'}:${host||'unbound'}`;
  const engine=configValue?.value.match(/^jdbc:([^:]+)/)?.[1];
  return entity({id,kind:'resource',resourceKind:'database',name:deployment?.image?.split(':')[0]||({mysql:'MySQL',postgresql:'PostgreSQL',mariadb:'MariaDB',h2:'H2',sqlite:'SQLite'}[engine||'']||'关系数据'),summary:host?`配置目标 ${host} · 未连接`:'SQL 访问；数据源实例未确认',serviceId,basis:configValue?[basis('config',configValue.location,`spring.datasource.url → ${configValue.value}`)]:[],discoveredOnly:false});
 };
 function sqlRelations(from:string,sql:string,location:Location,rule:string,extra:Evidence[]=[],framework?:{table:string;operation:'read'|'write'}){
  const symbol=byId.get(from);if(!symbol)return;
  const tables=framework?[framework.table]:[...sql.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+[`"]?([a-zA-Z_]\w*(?:\.\w+)?)/gi)].map(m=>m[1]);
  const dynamic=/\b(?:FROM|JOIN|INTO|UPDATE)\s+(?:\$\{|#\{|<)/i.test(sql)||/<(?:choose|foreach|when)\b/i.test(sql);
  const write=framework?framework.operation==='write':/^\s*(?:<script>\s*)?(?:INSERT|UPDATE|DELETE|REPLACE|CREATE)/i.test(sql),db=database(symbol.serviceId),sqlBasis=framework?extra:[basis('declaration',location,sql),...extra];
  if(!tables.length||dynamic){index.diagnostics.push({file:location.file,message:'SQL 的数据表无法唯一静态确认，保留原始调用来源。',severity:'warning'});return;}
  for(const name of new Set(tables)){
   const target=entity({id:`table:${db.id}:${name}`,kind:'resource',name,resourceKind:'table',summary:(framework?'框架 ':'SQL ')+(write?'写入':'读取'),parentId:db.id,serviceId:symbol.serviceId,basis:[...db.basis,...sqlBasis],location,discoveredOnly:false});
   put({from,to:target.id,target:target.name,type:write?'WRITES':'READS',status:'resolved',locations:[location],invocation:'sync',data:{operation:write?'write':'read',table:name,sql:framework?undefined:sql}}, {id:rule,outcome:'unique',basis:[...sqlBasis,...db.basis],conditions:[]});
  }
 }
 mybatisRules(ctx,sqlRelations);
 for(const s of index.symbols.filter(s=>s.language==='java'&&s.kind==='method')){
  const owner=byId.get(s.parent||'');if(!owner||!annotation(owner,'Mapper','org.apache.ibatis.annotations'))continue;
  const def=facts.get(s.file)?.definitions.find(d=>d.id===s.id);
  for(const match of def?.annotations.matchAll(/@(Select|Insert|Update|Delete)\s*\(\s*("""[^]*?"""|"(?:\\.|[^"\\])*")\s*\)/g)||[]){
   if(!ctx.annotation(s,match[1],'org.apache.ibatis.annotations'))continue;
   const sql=match[2].replace(/^"""|"""$/g,'').replace(/^"|"$/g,'').replace(/\\"/g,'"');
   sqlRelations(s.id,sql,def!.location,'mybatis.annotation-sql',[basis('declaration',at(owner),'@Mapper 框架代理；不要求手写实现')]);
  }
 }
 for(const [file,program] of facts){if(!file.endsWith('.py'))continue;
  const canonical=(name:string)=>{const [head,...tail]=name.split('.'),imp=program.imports.find(i=>i.name===head);return imp?[imp.target,...tail].join('.'):name;};
  for(const ctor of program.assignments.filter(a=>a.left.startsWith('self.')&&a.value.callee&&canonical(a.value.callee)==='chromadb.PersistentClient')){
   const owner=byId.get(byId.get(ctor.scope)?.parent||'');if(!owner)continue;
   const field=ctor.left,collections=program.assignments.filter(a=>a.scope===ctor.scope&&a.value.callee===field+'.get_or_create_collection');
   const deployment=service(owner.serviceId),directory=deployment?.environment.CHROMA_DIR;
   const store=entity({id:`vector:${owner.serviceId}:${owner.id}:${field}`,kind:'resource',resourceKind:'vector',name:'Chroma',summary:directory?`持久向量存储 · ${directory}`:'持久向量存储 · 路径由构造参数提供',serviceId:owner.serviceId,basis:[basis('assignment',ctor.location,'chromadb.PersistentClient；'+ctor.value.text),...(deployment?[...deployment.basis]:[])],location:ctor.location,discoveredOnly:false});
   for(const call of program.calls.filter(c=>collections.some(a=>['query','count','get','upsert','add','update','delete'].some(m=>c.callee===a.left+'.'+m)))){
    const write=/\.(?:upsert|add|update|delete)$/.test(call.callee);
    put({from:call.scope,to:store.id,target:store.name,type:write?'WRITES':'READS',status:'resolved',locations:[call.location],invocation:'sync',data:{operation:write?'write':'read'}},{id:'chroma.collection-access',outcome:'unique',basis:[basis('call',call.location,call.callee),...store.basis,...collections.map(a=>basis('assignment',a.location,a.left+' = '+a.value.callee+'(…)'))],conditions:call.conditions});
   }
  }
  // A with-as connection binding is required; a method merely named execute is not enough.
  for(const binding of program.assignments.filter(a=>a.value.callee&&canonical(a.value.callee)==='sqlite3.connect')){
   const source=byId.get(binding.scope);if(!source)continue;
   const resource=entity({id:`sqlite:${source.serviceId}:${source.parent||source.id}`,kind:'resource',resourceKind:'file',name:'SQLite · 本地状态',summary:'sqlite3.connect 的本地状态库',serviceId:source.serviceId,basis:[basis('assignment',binding.location,binding.value.text)],location:binding.location,discoveredOnly:false});
   for(const call of program.calls.filter(c=>c.scope===binding.scope&&c.callee===binding.left+'.execute')){const sql=call.args[0]?.value.literal;if(!sql)continue;const write=/^\s*(INSERT|UPDATE|DELETE|REPLACE|CREATE)/i.test(sql);put({from:call.scope,to:resource.id,target:resource.name,type:write?'WRITES':'READS',status:'resolved',locations:[call.location],data:{operation:write?'write':'read',sql}}, {id:'sqlite.connection-sql',outcome:'unique',basis:[basis('call',call.location,sql),...resource.basis],conditions:call.conditions});}
  }
  for(const constructor of program.assignments.filter(a=>a.value.callee&&canonical(a.value.callee)==='langchain_openai.ChatOpenAI')){
   const source=byId.get(constructor.scope),owner=byId.get(source?.parent||'');if(!owner)continue;
   const pipelines=program.assignments.filter(a=>a.scope===constructor.scope&&a.left.startsWith('self.')&&a.value.text.split('|').map(v=>v.trim()).includes(constructor.left));
   const deployment=service(owner.serviceId),parameter=program.definitions.find(d=>d.id===constructor.scope)?.params.find(p=>p.type&&p.name!=='self');
   const settings=parameter?python?.resolveType(file,parameter.type,constructor.scope)||[]:[],defaults=settings.flatMap(s=>facts.get(s.file)?.assignments.filter(a=>a.scope===s.id&&a.left==='ai_provider'&&a.value.literal!==undefined)||[]);
   const provider=(deployment?.environment.AI_PROVIDER||(defaults.length===1?defaults[0].value.literal:undefined))?.replace(/^\$\{\w+:-(.*)\}$/,'$1');
   const resource=entity({id:`model:${owner.serviceId}:${constructor.value.callee}`,kind:'resource',resourceKind:'model',name:'外部模型 · ChatOpenAI',summary:'仅在配置与调用分支满足时访问',serviceId:owner.serviceId,basis:[basis('assignment',constructor.location,'ChatOpenAI 构造（密钥值未采集）')],conditions:constructor.conditions,discoveredOnly:true,location:constructor.location});
   for(const call of program.calls.filter(c=>index.symbols.find(s=>s.id===c.scope)?.parent===owner.id&&pipelines.some(a=>c.callee===a.left+'.invoke'))){resource.discoveredOnly=false;put({from:call.scope,to:resource.id,target:resource.name,type:'HTTP',status:'resolved',locations:[call.location],invocation:'sync'},{id:'langchain.conditional-invoke',outcome:'unique',basis:[basis('call',call.location,call.callee),...resource.basis,...defaults.map(a=>basis('config',a.location,'Settings.ai_provider 的源码默认值')),...pipelines.map(a=>basis('assignment',a.location,'该 chain 由上述模型组成'))],conditions:[...constructor.conditions,...call.conditions,`所选配置的 AI_PROVIDER 默认 ${provider||'未知'}；环境覆盖未求值`],applicability:provider==='local'?'excluded':'conditional'});}
  }
 }
 // Redis operations require an imported Redis template and an actual get/set/delete operation.
 for(const [file,program] of facts)if(file.endsWith('.java'))for(const call of program.calls){
  const source=byId.get(call.scope),owner=source&&byId.get(source.parent||'');if(!source||!owner)continue;
  const constructor=program.definitions.find(d=>byId.get(d.id)?.parent===owner.id&&byId.get(d.id)?.kind==='constructor');
  const redis=constructor?.params.find(p=>ctx.imported(file,p.type,'org.springframework.data.redis.core.StringRedisTemplate'));if(!redis)continue;
  const field=program.assignments.find(a=>a.scope===constructor!.id&&a.value.text===redis.name)?.left.replace(/^this\./,'')||redis.name;
  if(!call.callee.startsWith(field+'.')||!/(?:\.opsForValue\(\))?\.(get|set|delete)$/.test(call.callee))continue;
  const deployment=service(source.serviceId),host=config.resolve('spring.data.redis.host',deployment),target=config.deployments.find(d=>d.name===host?.value&&d.image?.startsWith('redis'));
  const resource=entity({id:target?`resource:${target.id}`:`redis:${source.serviceId}:${host?.value||'unknown'}`,kind:'resource',resourceKind:'cache',name:'Redis',summary:'可选缓存 · 由调用与启用条件确定',basis:host?[basis('config',host.location,`spring.data.redis.host → ${host.value}`)]:[],conditions:constructor!.params.filter(p=>p.annotation.includes('@Value')).map(p=>p.annotation),discoveredOnly:false});
  const condition=constructor!.params.find(p=>p.annotation.includes('@Value'))?.annotation.match(/\$\{([^}:]+)/)?.[1],enabled=condition?config.resolve(condition,deployment):undefined;
  put({from:source.id,to:resource.id,target:resource.name,type:call.callee.endsWith('.get')?'READS':'WRITES',status:'resolved',locations:[call.location],invocation:'sync'},{id:'redis.template-access',outcome:'unique',basis:[basis('call',call.location,call.callee),...resource.basis,basis('declaration',at(owner),'StringRedisTemplate 注入类型')],information:[...call.conditions.map(code=>({kind:'branch' as const,text:'访问受代码分支限制',code,location:call.location})),...(condition?[{kind:'precondition' as const,text:/(?:^|[-.])enabled$/.test(condition)?'受缓存启用开关限制':'存在需要核对的配置前提',code:condition+'=true',location:constructor!.location},{kind:'configuration' as const,text:'所选配置的开关值为 '+(enabled?.value||'未知'),location:enabled?.location}]:[])],conditions:[...call.conditions,...(condition?[`${condition}=true；所选配置默认 ${enabled?.value||'未知'}`]:[])],applicability:enabled?.value==='false'?'excluded':'conditional'});
 }
}
