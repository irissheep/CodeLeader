import type { EntryPoint, ProjectIndex, SymbolInfo, ViewState, Relation } from '../shared/model';
import { isTestFile } from '../shared/source-roles';
export { isTestFile };
export const isCallable=(s:SymbolInfo)=>['method','function','constructor'].includes(s.kind);
export const symbolView=(s:SymbolInfo):Partial<ViewState>=>({level:isCallable(s)?'function':'class',focus:s.id});
export function entryGroups(index:ProjectIndex,filter:ViewState['filter']='all',showTests=false){
  const entries=(index.entries||[]).filter(e=>{const s=index.symbols.find(s=>s.id===e.symbolId);return(showTests||!isTestFile(e.location.file,index))&&(filter==='all'||(s?.language||(e.location.file.endsWith('.java')?'java':'python'))===filter);});
  const groups=new Map<string,EntryPoint[]>();for(const e of entries)groups.set(e.group,[...(groups.get(e.group)||[]),e]);
  return [...groups].map(([id,members])=>{
    const paths=members.filter(e=>e.kind==='http'&&!e.name.includes('路径未知')).map(e=>e.name.split(' · ')[0].split(' ')[1]?.split('/')||[]);
    let common=0;if(paths.length)while(common<paths[0].length&&paths.every(p=>p[common]===paths[0][common]))common++;
    const prefix=paths.length?paths[0].slice(0,common).join('/'):'';
    return {id:`entry-group:${id}`,name:members[0].kind==='http'?(members[0].moduleName||prefix||members[0].owner):members[0].name,owner:members[0].owner,area:members[0].area,entries:members};
  }).sort((a,b)=>Number(b.entries[0].kind==='http')-Number(a.entries[0].kind==='http')||a.area.localeCompare(b.area)||a.name.localeCompare(b.name));
}
export function symbolCategory(index:ProjectIndex,s:SymbolInfo){
  if(isTestFile(s.file,index))return '测试';
  if(s.declaration==='record_declaration')return 'record · 数据类型';
  if(s.declaration==='enum_declaration')return '枚举';
  if(s.kind==='interface')return '接口';
  if(index.relations.some(r=>r.from===s.id&&r.type==='EXTENDS'&&/(?:Exception|Error)(?:<.*>)?$/.test(r.target)))return '异常类型';
  return s.role||({class:'类 / 类型定义',method:'方法',constructor:'构造器',function:'函数'}[s.kind]);
}
export function boundaries(index:ProjectIndex,s:SymbolInfo,visible=new Set<string>()){
  const calls=index.relations.filter(r=>r.type==='CALLS'&&r.from===s.id);
  const internal=calls.filter(r=>r.to&&index.symbols.some(s=>s.id===r.to));
  const rows:{kind:string;label:string;relations:Relation[]}[]=[];
  const unmapped=calls.filter(r=>!r.to&&r.status!=='unresolved');
  const noDefinition=unmapped.filter(r=>index.symbols.some(s=>!isCallable(s)&&(r.target.startsWith(s.qualifiedName+'.')||r.target.startsWith(s.qualifiedName+'('))));
  const external=unmapped.filter(r=>!noDefinition.includes(r)),unknown=calls.filter(r=>!r.to&&r.status==='unresolved');
  if(!internal.length)rows.push({kind:'no-internal',label:'这个方法没有找到更多项目内调用',relations:[]});
  if(external.length)rows.push({kind:'external',label:`调用项目外的方法 · ${external.length} 处`,relations:external});
  if(noDefinition.length)rows.push({kind:'no-definition',label:`项目里没找到定义的方法 · ${noDefinition.length}`,relations:noDefinition});
  if(unknown.length)rows.push({kind:'unresolved',label:`还没找到被调方法 · ${unknown.length} 处`,relations:unknown});
  const hidden=internal.filter(r=>!visible.has(r.to!));if(hidden.length)rows.push({kind:'folded',label:`尚未展开 / 当前范围外 · ${hidden.length}`,relations:hidden});
  const candidate=internal.filter(r=>r.status==='candidate');if(candidate.length)rows.push({kind:'candidate',label:`还不能确定的方法 · ${candidate.length}`,relations:candidate});
  const reaches=(start:string,target:string,seen=new Set<string>()):boolean=>{if(start===target)return true;if(seen.has(start))return false;seen.add(start);return index.relations.filter(r=>r.type==='CALLS'&&r.from===start&&r.to&&visible.has(r.to)).some(r=>reaches(r.to!,target,seen));};
  const cycle=internal.filter(r=>visible.has(r.to!)&&reaches(r.to!,s.id));if(cycle.length)rows.push({kind:'cycle',label:'循环回到已展示节点',relations:cycle});
  return rows;
}
export function nextDensity(current:ViewState['density'],zoom:number){return current==='compact'?(zoom>0.78?'detail':'compact'):(zoom<0.58?'compact':'detail');}
