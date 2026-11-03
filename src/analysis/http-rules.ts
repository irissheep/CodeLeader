import type { Evidence, EntryPoint, RuleInformation } from '../shared/model';
import type { RuleContext } from './rule-context';
import { basis, type Value } from './code-facts';
export function httpRules(ctx:RuleContext){
 const {index,facts,byId,config,entity,put,at}=ctx;
 for(const [file,program] of facts)if(file.endsWith('.java'))for(const field of program.fields.filter(f=>ctx.imported(file,f.type,'org.springframework.web.client.RestClient'))){
  const owner=byId.get(field.owner);if(!owner)continue;
  const constructors=program.definitions.filter(d=>byId.get(d.id)?.parent===owner.id&&byId.get(d.id)?.kind==='constructor');
  const assignments=program.assignments.filter(a=>constructors.some(c=>c.id===a.scope)&&[field.name,'this.'+field.name].includes(a.left)&&a.value.text.includes('.baseUrl('));
  if(assignments.length!==1)continue;
  const assignment=assignments[0],base=program.calls.find(c=>c.scope===assignment.scope&&c.callee.endsWith('.baseUrl')&&c.location.range.start.line>=assignment.location.range.start.line&&c.location.range.end.line<=assignment.location.range.end.line)?.args[0]?.value;
  const parameter=constructors.find(d=>d.id===assignment.scope)?.params.find(p=>p.name===base?.text),baseKey=parameter?.annotation.match(/@Value\s*\(\s*"\$\{([^}:]+)/)?.[1];
  const deployment=config.deployments.find(d=>d.id===owner.serviceId),configured=baseKey?config.resolve(baseKey,deployment):undefined;
  const baseUrl=base?.literal||configured?.value;
  const baseEvidence:Evidence[]=[basis('declaration',field.location,`RestClient ${field.name}`),basis('assignment',assignment.location,'RestClient builder 的 baseUrl 来源'),...(parameter?[basis('declaration',constructors.find(d=>d.id===assignment.scope)!.location,`@Value 配置键 ${baseKey||'未知'}`)]:[]),...(configured?[basis('config',configured.location,`${baseKey} → ${configured.value}`),...(configured.override?[basis('config',configured.override,'所选 Compose 环境覆盖的非敏感 URL')]:[])]:[]),...(deployment?.basis||[])];
  for(const terminal of program.calls.filter(c=>byId.get(c.scope)?.parent===owner.id&&new RegExp(`^(?:this\\.)?${field.name}\\.`).test(c.text)&&(/\.retrieve\s*\(\s*\)\s*\.\s*(?:body|toEntity|toBodilessEntity)\s*\(/.test(c.text)||/\.exchange\s*\(/.test(c.text)))){
   if(!/(?:\.body|\.toEntity|\.toBodilessEntity|\.exchange)$/.test(terminal.callee))continue;
   const method=terminal.text.match(new RegExp(`^(?:this\\.)?${field.name}\\.(get|post|put|delete|patch|head|options)\\s*\\(`))?.[1]?.toUpperCase();if(!method)continue;
   const uri=program.calls.find(c=>c.scope===terminal.scope&&c.callee.endsWith('.uri')&&c.location.range.start.line===terminal.location.range.start.line&&c.location.range.start.character===terminal.location.range.start.character&&c.location.range.end.line<=terminal.location.range.end.line);
   if(!uri)continue;
   const choices=(v:Value|undefined):{path:string;conditions:string[];evidence:Evidence[];branch?:RuleInformation}[]=>{
    if(v?.literal!==undefined)return[{path:v.literal,conditions:[],evidence:[]}];
    const local=program.assignments.filter(a=>a.scope===terminal.scope&&a.left===v?.text&&a.location.range.start.line<=terminal.location.range.start.line);
    if(local.length!==1)return[];const a=local[0],branch=a.value.text.match(/^([^]+?)\?\s*"([^"\\]*)"\s*:\s*"([^"\\]*)"\s*$/);
    if(branch){const branchGroup=JSON.stringify([a.scope,a.location]);return[{path:branch[2],conditions:[branch[1].trim()],evidence:[basis('assignment',a.location,'URI 条件分支：'+branch[1].trim())],branch:{kind:'branch',text:'按代码条件选择此路径',code:branch[1].trim(),location:a.location,branchGroup,branch:'then'}},{path:branch[3],conditions:['!('+branch[1].trim()+')'],evidence:[basis('assignment',a.location,'URI 条件分支的另一分支')],branch:{kind:'branch',text:'上述条件的另一分支',code:'!('+branch[1].trim()+')',location:a.location,branchGroup,branch:'else'}}];}
    return a.value.literal!==undefined?[{path:a.value.literal,conditions:a.conditions,evidence:[basis('assignment',a.location,'URI 局部常量')]}]:[];
   };
   const paths=choices(uri.args[0]?.value),source=byId.get(terminal.scope)!;
   if(!paths.length||!baseUrl){put({from:source.id,target:`${method} 路径 / baseUrl 待确认`,type:'HTTP',status:'unresolved',locations:[terminal.location]}, {id:'spring.restclient-http',outcome:'unknown',basis:[basis('call',terminal.location,'已发现请求终结操作，目标仍动态'),...baseEvidence],conditions:terminal.conditions});continue;}
   for(const choice of paths){
    let url:URL;try{url=new URL(choice.path,baseUrl);}catch{continue;}
    const deployments=config.deployments.filter(d=>d.name===url.hostname&&d.module&&d.port===(url.port||'80')&&d.roots.length);
    const ownership=(entry:EntryPoint,deployment:typeof deployments[number])=>{
     const program=facts.get(entry.location.file),exports=program?.assignments.filter(a=>a.scope===`file:${entry.location.file}`&&a.left===deployment.exportName)||[];
     if(exports.length!==1)return {possible:true,unique:false,evidence:[] as Evidence[]};
     const binding=exports[0],factory=index.symbols.find(s=>s.file===entry.location.file&&!s.parent&&s.name===binding.value.callee&&s.kind==='function'),target=byId.get(entry.symbolId||'');
     if(factory)return {possible:target?.parent===factory.id,unique:true,evidence:[basis('assignment',binding.location,`部署导出的 ${deployment.exportName} = ${factory.name}(…)`)]};
     const direct=ctx.result.syntax.get(entry.location.file)?.routes.find(r=>r.symbolId===entry.symbolId&&r.object===deployment.exportName&&r.scope.endsWith(':module'));
     return {possible:!!direct||!binding.value.callee,unique:!!direct,evidence:[basis('assignment',binding.location,'部署导出对象的静态绑定')]};
    };
    const matches=(index.entries||[]).filter(e=>e.kind==='http'&&e.name.split(' · ')[0]===`${method} ${url.pathname}`).flatMap(entry=>deployments.filter(d=>d.roots.some(root=>entry.location.file.startsWith(root+'/'))&&entry.location.file.endsWith(d.module!.replaceAll('.','/')+'.py')).map(deployment=>({entry,ownership:ownership(entry,deployment)}))).filter(m=>m.ownership.possible);
    const targets=matches.map(m=>m.entry),unique=matches.length===1&&matches[0].ownership.unique&&deployments.every(d=>d.portConfirmed);
    const checked=program.calls.some(c=>c.scope===terminal.scope&&c.callee==='requireConfigured');
    const conditions=[`按 ${index.configurations?.find(c=>c.id===config.configuration)?.name} 静态关联；不是当前运行环境`,...terminal.conditions,...choice.conditions,...(checked?['requireConfigured() 校验通过；敏感配置值未采集']:[])];
    const information:RuleInformation[]=[{kind:'configuration',text:'使用所选静态配置关联目标',location:configured?.location},{kind:'analysis',text:'静态关联，不表示当前运行环境'},...terminal.conditions.map(code=>({kind:'branch' as const,text:'调用受代码分支限制',code,location:terminal.location})),...(choice.branch?[choice.branch]:choice.conditions.map(code=>({kind:'branch' as const,text:'路径受代码条件限制',code,location:uri.location}))),...(checked?[{kind:'precondition' as const,text:'方法包含配置检查，检查结果未观测',code:'requireConfigured()',location:program.calls.find(c=>c.scope===terminal.scope&&c.callee==='requireConfigured')!.location},{kind:'analysis' as const,text:'敏感配置值未采集'}]:[])];
    if(targets.length){for(const target of targets)put({from:source.id,to:target.symbolId,target:target.name,type:'HTTP',status:unique?'resolved':'candidate',locations:[terminal.location],invocation:'sync',http:{method,path:choice.path,baseKey,baseUrl,serviceId:byId.get(target.symbolId||'')?.serviceId}},{id:'spring.restclient-http',outcome:unique?'unique':'candidate',basis:[basis('call',terminal.location,'HTTP 请求终结操作'),...baseEvidence,...choice.evidence,...deployments.flatMap(d=>d.basis),...matches.find(m=>m.entry.id===target.id)!.ownership.evidence,basis('declaration',target.location,target.name),basis('definition',at(byId.get(target.symbolId!)!),byId.get(target.symbolId!)!.qualifiedName)],information:[...information,...(!unique?[{kind:'uncertainty' as const,text:'还不能确定部署的应用对象或目标接口'}]:[])],conditions:[...conditions,...(!unique?['部署的应用对象或目标接口有多个可能目标']:[])]});}
    else {const resource=entity({id:`http:${source.serviceId}:${url.origin}`,kind:'resource',resourceKind:'external',name:url.origin,summary:'HTTP 边界 · 未唯一定位到本项目服务',serviceId:source.serviceId,basis:baseEvidence,discoveredOnly:false});put({from:source.id,to:resource.id,target:`${method} ${url.pathname}`,type:'HTTP',status:'resolved',locations:[terminal.location],invocation:'sync',http:{method,path:choice.path,baseKey,baseUrl}},{id:'spring.restclient-http',outcome:'unique',basis:[basis('call',terminal.location,'HTTP 请求终结操作'),...baseEvidence,...choice.evidence],information,conditions});}
   }
  }
 }
}
