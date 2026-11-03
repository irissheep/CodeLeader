import type {EntryPoint,Evidence} from '../shared/model';
import type {StructureResult} from './structure';
import {sourceArea} from './entry-syntax';
import {annotationValues,type JavaAnnotation,type JavaExpression,type JavaValue} from './java-annotation-values';
import policy from '../shared/spring-http-policy.json';
type Mapping={annotation:JavaAnnotation;paths:JavaValue[];methods:JavaValue[]};
const unique=<T>(values:T[],key:(value:T)=>string)=>[...new Map(values.map(v=>[key(v),v])).values()];
const proofs=(values:Evidence[])=>unique(values,v=>JSON.stringify([v.kind,v.location,v.note]));
const unknownPath='路径未知（动态）';
function joinPath(prefix:string,path:string){const value=prefix&&path?prefix.replace(/\/$/,'')+'/'+path.replace(/^\//,''):prefix||path||'/';return value.startsWith('/')?value:'/'+value;}

export function extractSpringEntries(result:StructureResult):EntryPoint[]{
 const {index,syntax}=result,entries:EntryPoint[]=[],byId=new Map(index.symbols.map(s=>[s.id,s]));
 const values=annotationValues(new Map([...syntax].flatMap(([file,f])=>f.javaValues?[[file,f.javaValues] as const]:[])),index.symbols,[...policy.mappings,...policy.roles].map(r=>r.type),policy.enum,policy.thresholds.constantDepth.value);
 const mappings=new Map<string,Mapping>();
 const failure=(expr:JavaExpression,reason:string,basis:Evidence[]=[]):JavaValue=>({basis,issue:{location:expr.location,expression:expr.text,reason}});
 function readMapping(annotation:JavaAnnotation,type:string,file:string,owner:string):Mapping{
  const rule=policy.mappings.find(r=>r.type===type)!;
  const evaluate=(expr:JavaExpression)=>values.evaluate(expr,file,owner);
  const pathExpr=annotation.args.path||annotation.args.value;
  let paths=pathExpr?evaluate(pathExpr):[];
  if(!paths.length)paths=[{value:'',kind:'string',basis:[{kind:'declaration',location:annotation.location,note:'这里没有另写路径'}]}];
  if(annotation.args.path&&annotation.args.value){const other=evaluate(annotation.args.value);if(JSON.stringify(paths.map(v=>[v.value,v.issue]))!==JSON.stringify(other.map(v=>[v.value,v.issue])))paths=[failure(pathExpr!,'value 与 path 写了不一致的路径')];}
  paths=paths.map(v=>v.issue?v:v.kind!=='string'?failure(pathExpr!,'路径不是字符串常量',v.basis):/\$\{|#\{/.test(v.value||'')?failure(pathExpr!,'路径引用了配置或运行时表达式，值没有确定',v.basis):v);
  let methods:JavaValue[]=rule.method==='ANY'?(annotation.args.method?evaluate(annotation.args.method):[]):[{value:rule.method,kind:'enum',basis:[{kind:'declaration',location:annotation.location,note:rule.basis}]}];
  if(!methods.length)methods=[{value:'ANY',kind:'enum',basis:[{kind:'declaration',location:annotation.location,note:'这里没有限定 HTTP 方法'}]}];
  methods=methods.map(v=>v.issue?v:v.kind==='enum'?v:failure(annotation.args.method,'HTTP 方法没有引用 Spring 的方法枚举',v.basis));
  return{annotation,paths,methods};
 }
 for(const[file,facts]of syntax){if(!facts.javaValues)continue;
  for(const fact of facts.java){const symbol=byId.get(fact.symbolId)!;symbol.routes=[];symbol.role=undefined;
   const owner=['class','interface'].includes(symbol.kind)?symbol.id:symbol.parent||symbol.id;
   for(const annotation of fact.values){const type=values.typeName(annotation.name,file,owner);if(!type)continue;
    const role=policy.roles.find(r=>r.type===type);if(role)symbol.role=role.role;
    if(policy.mappings.some(r=>r.type===type)&&!mappings.has(symbol.id))mappings.set(symbol.id,readMapping(annotation,type,file,owner));
   }
  }
 }
 for(const[id,mapping]of mappings){const symbol=byId.get(id)!;if(symbol.kind!=='method'){symbol.routes=unique(mapping.methods.flatMap(m=>mapping.paths.map(p=>`${m.value||'UNKNOWN'} ${p.issue?unknownPath:p.value}`)),v=>v);continue;}
  const parent=byId.get(symbol.parent||''),outer=parent&&mappings.get(parent.id),prefixes=outer?.paths||[{value:'',basis:[]}];
  const combined=[...outer?.methods||[],...mapping.methods].filter(m=>m.issue||m.value!=='ANY'),methods=unique(combined.length?combined:mapping.methods,v=>v.value||JSON.stringify(v.issue));
  for(const method of methods){
   const routes=unique(prefixes.flatMap(prefix=>mapping.paths.map(path=>{
    const issues=[prefix.issue,path.issue,method.issue].filter((v):v is NonNullable<typeof v>=>!!v);
    return{path:prefix.issue||path.issue?unknownPath:joinPath(prefix.value||'',path.value||''),basis:proofs([...prefix.basis,...path.basis,...method.basis,{kind:'declaration',location:mapping.annotation.location,note:'HTTP 路径与方法在这里声明'}]),issues};
   })),p=>p.path===unknownPath?p.path+JSON.stringify(p.issues):p.path);
   const ordered=[...routes.filter(r=>!r.issues.length),...routes.filter(r=>r.issues.length)],primary=ordered[0],verb=method.value||'UNKNOWN';
   const aliases=ordered.slice(1),allIssues=ordered.flatMap(r=>r.issues);
   symbol.routes.push(...ordered.map(r=>`${verb} ${r.path}`));
   entries.push({id:`http:${id}:${verb} ${primary.path}`,kind:'http',name:`${verb} ${primary.path} · ${symbol.name}`,symbolId:id,location:{file:symbol.file,range:symbol.selection},group:`spring:${parent?.id||id}`,owner:parent?.name||symbol.name,area:sourceArea(symbol.file),basis:`Spring 注解来源已确认；${symbol.file}:${mapping.annotation.location.range.start.line+1}`,status:primary.issues.length?'unresolved':allIssues.length?'candidate':'resolved',...(allIssues.length?{reason:'动态：'+unique(allIssues.map(i=>i.reason),v=>v).join('；')}:{}),pathEvidence:{method:verb,path:primary.path,basis:primary.basis,defaults:false,issues:primary.issues,conditions:[],...(aliases.length?{aliases}: {})}});
  }
 }
 return entries;
}
