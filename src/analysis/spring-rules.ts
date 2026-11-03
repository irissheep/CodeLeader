import type { Evidence, SymbolInfo } from '../shared/model';
import { basis } from './code-facts';
import type { RuleContext } from './rule-context';
export function springRules(ctx:RuleContext){
 const {index,facts,byId,annotation,put,at}=ctx;
 const classes=index.symbols.filter(s=>s.language==='java'&&['class','interface'].includes(s.kind));
 const defs=[...facts.values()].flatMap(f=>f.definitions);
 const def=(s:SymbolInfo)=>defs.find(d=>d.id===s.id);
 const resolveType=(owner:SymbolInfo,name:string)=>{
  const clean=name.replace(/<[^]*>|\[\]/g,'').trim(),imports=facts.get(owner.file)?.imports||[];
  return classes.filter(s=>s.qualifiedName===clean||s.name===clean&&(s.file===owner.file||s.qualifiedName===owner.qualifiedName.split('.').slice(0,-1).join('.')+'.'+clean||imports.some(i=>i.target===s.qualifiedName||i.target.endsWith('.*')&&s.qualifiedName.startsWith(i.target.slice(0,-1)))));
 };
 const beans=classes.filter(s=>['Component','Service','Repository','Controller'].some(a=>annotation(s,a,'org.springframework.stereotype'))||annotation(s,'Configuration','org.springframework.context.annotation')||annotation(s,'RestController','org.springframework.web.bind.annotation')||annotation(s,'Mapper','org.apache.ibatis.annotations')).map(s=>({id:s.id,type:s,annotations:def(s)?.annotations||'',location:at(s)}));
 for(const d of defs){const s=byId.get(d.id)!;if(s.language==='java'&&annotation(s,'Bean','org.springframework.context.annotation')&&beans.some(b=>b.id===s.parent)){
  const implementations=(d.returns||[]).flatMap(v=>v.callee?resolveType(s,v.callee):[]),types=implementations.length?implementations:resolveType(s,d.returnType||'');
  for(const type of types)beans.push({id:s.id,type,annotations:d.annotations+'\n'+(def(byId.get(s.parent!)!)?.annotations.match(/@(?:[\w.]+\.)?(?:Conditional\w*|Profile)[^\n]*/g)||[]).join('\n'),location:at(s)});
 }}
 const extendsType=(type:SymbolInfo,wanted:SymbolInfo,seen=new Set<string>()):boolean=>{if(type.id===wanted.id)return true;if(seen.has(type.id))return false;seen.add(type.id);return index.relations.filter(r=>['EXTENDS','IMPLEMENTS'].includes(r.type)&&r.from===type.id&&r.to).some(r=>extendsType(byId.get(r.to!)!,wanted,seen));};
 const slots=new Map<string,{field:string;beans:typeof beans;basis:Evidence[];conditions:string[]}[]>();
 for(const owner of classes){
  const program=facts.get(owner.file)!,constructors=index.symbols.filter(s=>s.parent===owner.id&&s.kind==='constructor');
  const injections=[...constructors.flatMap(c=>(def(c)?.params||[]).filter(p=>!p.annotation.includes('@Value')).map(p=>({name:program.assignments.find(a=>a.scope===c.id&&a.value.text===p.name)?.left.replace(/^this\./,'')||p.name,type:p.type,annotations:p.annotation,location:at(c)}))),...program.fields.filter(f=>f.owner===owner.id&&/@Autowired\b/.test(f.annotations)).map(f=>({...f,annotations:f.annotations}))];
  for(const injection of injections){
   const wanted=resolveType(owner,injection.type),qualifier=injection.annotations.match(/@Qualifier\s*\(\s*"([^"]+)"/)?.[1];
   const beanName=(id:string)=>{const name=byId.get(id)?.name||'';return /^[A-Z]{2}/.test(name)?name:name.charAt(0).toLowerCase()+name.slice(1);};
   let candidates=beans.filter(b=>b.id!==owner.id&&(!owner.serviceId||!b.type.serviceId||owner.serviceId===b.type.serviceId)&&wanted.some(w=>extendsType(b.type,w))&&(!qualifier||b.annotations.includes('"'+qualifier+'"')||beanName(b.id)===qualifier));
   const primary=candidates.filter(b=>annotation(byId.get(b.id)!,'Primary','org.springframework.context.annotation')&&!/@(?:[\w.]+\.)?(?:Conditional\w*|Profile)\b/.test(b.annotations));if(!qualifier&&primary.length===1)candidates=primary;
   const conditions=candidates.flatMap(b=>b.annotations.match(/@(?:[\w.]+\.)?(?:Conditional\w*|Profile)[^\n]*/g)||[]),evidence=[basis('declaration',injection.location,`注入 ${injection.type} ${injection.name}${qualifier?'；Qualifier='+qualifier:''}`),...candidates.map(b=>basis('definition',b.location,`Bean ${byId.get(b.id)?.name}；${b.annotations.replace(/\s+/g,' ')}`))];
   slots.set(owner.id,[...(slots.get(owner.id)||[]),{field:injection.name,beans:candidates,basis:evidence,conditions}]);
   for(const b of candidates)put({from:owner.id,to:b.id,target:b.type.qualifiedName,type:'INJECTS',status:candidates.length===1?'resolved':'candidate',locations:[injection.location]}, {id:'spring.injection',outcome:candidates.length===1?'unique':'candidate',basis:evidence,conditions});
  }
 }
 for(const program of facts.values())for(const call of program.calls){
  const source=byId.get(call.scope),owner=source?.parent&&byId.get(source.parent);if(!source||source.language!=='java'||!owner)continue;
  const match=call.callee.match(/^(?:this\.)?(\w+)\.(\w+)$/);if(!match)continue;
  const slot=slots.get(owner.id)?.find(s=>s.field===match[1]);if(!slot||slot.beans.length!==1)continue;
  const targets=index.symbols.filter(s=>s.parent===slot.beans[0].type.id&&s.name===match[2]&&s.kind==='method');if(targets.length!==1)continue;
  const target=targets[0],old=index.relations.find(r=>r.from===source.id&&r.type==='CALLS'&&r.locations.some(l=>l.range.start.line===call.location.range.start.line&&l.range.start.character===call.location.range.start.character));
  if(old?.to===target.id){if(annotation(slot.beans[0].type,'Mapper','org.apache.ibatis.annotations'))put({from:source.id,to:target.id,target:target.signature,type:'CALLS',status:'resolved',locations:[call.location],invocation:'sync'}, {id:'mybatis.mapper-proxy',outcome:'unique',basis:[basis('call',call.location,call.callee),...slot.basis,basis('definition',at(target),'@Mapper 代理方法声明')],conditions:call.conditions});continue;}
  // A unique injected implementation can refine a static interface target. Overloads remain unresolved here.
  if(old?.status==='candidate'&&old.to&&byId.get(byId.get(old.to)?.parent||'')?.kind==='interface')index.relations=index.relations.filter(r=>r.id!==old.id);
  put({from:source.id,to:target.id,target:target.signature,type:'CALLS',status:'resolved',locations:[call.location],invocation:'sync'}, {id:'spring.injected-dispatch',outcome:'unique',basis:[basis('call',call.location,call.callee),...slot.basis,basis('definition',at(target),target.signature)],conditions:[...call.conditions,...slot.conditions]});
 }
 for(const d of defs){const s=byId.get(d.id)!;if(s.language==='java'&&annotation(s,'Scheduled','org.springframework.scheduling.annotation')&&!index.entries!.some(e=>e.id===`scheduled:${s.id}`))index.entries!.push({id:`scheduled:${s.id}`,kind:'scheduled',name:`@Scheduled · ${s.name}`,symbolId:s.id,location:at(s),group:`scheduled:${s.parent}`,owner:byId.get(s.parent||'')?.name||s.name,area:s.serviceId||s.module,basis:d.annotations,status:'resolved'});}
 return {resolveType,slots};
}
