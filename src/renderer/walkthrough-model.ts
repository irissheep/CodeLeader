import type {SafeValue} from '../shared/execution';
import type {ReplayCall,ReplayModel,ReplayStep} from '../runtime/replay';
import {isActual} from '../runtime/snapshot';
import {methodRows} from './method-list';
import {sqlAction,sqlOf,shortTable} from './sql-facts';
import {summaryKind} from '../runtime/replay-data';
import {bodyValue,exceptionSummary,fullValue,isObject,methodComparison,visibleValue,valueLimits,type DisplayMode} from './execution-data';

export type BusinessPhase='接收'|'业务'|'数据'|'返回'|'之后';
export interface TraceField {key:string;name:string;value:SafeValue;}
export interface TraceValue {value?:SafeValue;notice?:string;changed:boolean;matched?:'name'|'value';}
export interface WalkthroughRow {id:string;callId:string;callIds:string[];name:string;depth:number;phase:BusinessPhase;fact:string;trace?:TraceValue;title?:string;}
export function stepPhase(model:ReplayModel,step:ReplayStep,receivers?:Set<string>):BusinessPhase{
 const call=model.byCall[step.callId];
 if(step.afterResponse)return '之后';
 if(call.kind==='browser')return step.phase==='return'?'返回':'接收';
 if(call.kind==='sql'||call.kind==='chroma'||call.records.some(record=>/^(redis|memcached|chroma|chromadb)$/i.test(String(record.attributes['db.system']||record.attributes['db.system.name']||''))))return '数据';
 if(call.kind==='method'&&(call.records.some(record=>record.symbolId&&receivers?.has(record.symbolId))||!receivers&&/Controller[.#$]/.test(call.name)))return '接收';
 return '业务';
}
export function phaseRuns(model:ReplayModel,receivers?:Set<string>){
 const runs:{phase:BusinessPhase;start:number;count:number;after?:boolean}[]=[];
 const response=model.steps.findIndex(step=>model.byCall[step.callId].kind==='browser'&&step.phase==='return');let start=response;
 while(start>0&&model.steps[start-1].phase==='return'&&stepPhase(model,model.steps[start-1],receivers)==='接收'&&!model.steps[start-1].afterResponse)start--;
 model.steps.forEach((step,i)=>{const phase=i>=start&&i<=response&&response>=0?'返回':stepPhase(model,step,receivers),last=runs.at(-1);if(last?.phase===phase)last.count++;else runs.push({phase,start:i,count:1,after:!!step.afterResponse});});return runs;
}
const literal=(value:SafeValue|undefined)=>value===''?'(空)':value===null?'null':fullValue(value);
export {sqlAction} from './sql-facts';
function inputData(call:ReplayCall,model:ReplayModel,mode:DisplayMode){
 const value=bodyValue(visibleValue(call.input,mode));
 if(call.kind==='browser'&&value===undefined){const query=Object.fromEntries(new URL(model.request.url).searchParams);return Object.keys(query).length?query:undefined;}
 return value;
}
function leaves(value:SafeValue|undefined,path='',result:{path:string;name:string;value:SafeValue}[]=[]){
 if(result.length>=256)return result;
 if(isObject(value)){for(const [key,item]of Object.entries(value))leaves(item,path?path+'.'+key:key,result);}
 else if(Array.isArray(value)){for(const [i,item]of value.entries())leaves(item,`${path}[${i}]`,result);}
 else if(value!==undefined)result.push({path,name:path.split('.').at(-1)!.replace(/\[\d+\]$/,''),value});
 return result;
}
export function trackingFields(model:ReplayModel,mode:DisplayMode):TraceField[]{
 if(mode==='structure')return [];
 const browser=model.calls.find(call=>call.kind==='browser'),entries=model.calls.filter(call=>call.kind==='method'&&call.parentId===browser?.id);
 const values=[...(browser?leaves(inputData(browser,model,mode)):[]),...entries.flatMap(call=>leaves(inputData(call,model,mode)))];
 const fields=new Map<string,TraceField>();for(const field of values)if(!fields.has(field.path))fields.set(field.path,{key:field.path,name:field.name,value:field.value});
 return [...fields.values()];
}
function limitsAt(source:SafeValue|undefined,path:string):string|undefined{
 if(!source||typeof source!=='object')return;
 if(isActual(source)){
  const limit=(source.limits as Record<string,SafeValue>[]).find(limit=>{const p=String(limit.path||'');return !p||path===p||path.startsWith(p+'.')||path.startsWith(p+'[');});
  if(limit)return typeof limit.originalLength==='number'?`已截断，原长 ${limit.originalLength}`:'没录到完整内容';
  return limitsAt(source.value,path);
 }
 const parts=path.match(/[^.[\]]+/g)||[];let value:SafeValue|undefined=source;
 for(let i=0;i<parts.length;i++){if(isActual(value))return limitsAt(value,parts.slice(i).join('.'));if(!value||typeof value!=='object')return;value=Array.isArray(value)?value[Number(parts[i])]:(value as Record<string,SafeValue>)[parts[i]];}
 return isActual(value)?limitsAt(value,''):undefined;
}
function namedSqlInput(call:ReplayCall,value:SafeValue|undefined):SafeValue|undefined{
 // Only the explicit simple INSERT column list maps positional parameters to field names.
 const columns=sqlOf(call).match(/^\s*INSERT\s+INTO\s+[\w.`"]+\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)\s*;?\s*$/i);
 if(!columns||!isObject(value)||!isObject(value.parameters))return value;
 const names=columns[1].split(',').map(name=>name.trim().replace(/^[`"]|[`"]$/g,'')),arguments_=columns[2].split(',').map(value=>value.trim());
 if(names.length!==arguments_.length||names.some(name=>!/^\w+$/.test(name))||arguments_.some(value=>value!=='?'))return value;
 return {...value,...Object.fromEntries(names.flatMap((name,i)=>String(i+1) in (value.parameters as Record<string,SafeValue>)?[[name,(value.parameters as Record<string,SafeValue>)[String(i+1)]]]:[]))};
}
function findField(source:SafeValue|undefined,value:SafeValue|undefined,field:TraceField,reference?:SafeValue):TraceValue{
 if(value===undefined)return {changed:false};
 if(summaryKind(value)==='structure'||summaryKind(value)==='limit')return {notice:'没录到具体内容',changed:false};
 const entries=leaves(value),named=entries.filter(item=>item.name===field.name);
 // The request parameter takes precedence over another object's as-yet-empty member.
 const exact=named.find(item=>item.path===field.key)||named.find(item=>item.path==='request.'+field.key);
 const unique=(items:typeof entries)=>new Set(items.map(item=>JSON.stringify(item.value))).size===1?items[0]:undefined;
 let match=exact||unique(named),matched:TraceValue['matched']='name';
 if(!named.length){const sample=reference===undefined?field.value:reference,eligible=typeof sample==='string'&&sample.length>=3||typeof sample==='number'&&String(sample).length>=3;if(eligible){match=entries.find(item=>JSON.stringify(item.value)===JSON.stringify(sample)&&!limitsAt(source,item.path));matched='value';}}
 if(!match)return {changed:false,notice:named.length?'有多个不同的值':undefined};
 return {value:match.value,notice:limitsAt(source,match.path),changed:false,matched};
}
export function stepTrace(model:ReplayModel,step:ReplayStep,field:TraceField,mode:DisplayMode,reference?:SafeValue):TraceValue{
 const call=model.byCall[step.callId],returning=step.phase!=='enter',source=returning?call.output:call.input;
 let value=returning?bodyValue(visibleValue(source,mode)):inputData(call,model,mode);
 if(call.kind==='sql'&&!returning)value=namedSqlInput(call,value);
 if(call.kind==='sql'&&step.phase==='atomic'&&value===undefined){value=namedSqlInput(call,inputData(call,model,mode));const result=findField(call.input,value,field,reference);return sqlTraceLimit(call,field,result);}
 const result=findField(source,value,field,reference);
 if(call.kind==='sql'&&step.phase==='enter')sqlTraceLimit(call,field,result);
 if(call.kind==='method'&&returning&&result.value!==undefined&&!result.notice){
  const before=findField(call.input,inputData(call,model,mode),field);
  result.changed=before.value!==undefined&&!before.notice&&JSON.stringify(before.value)!==JSON.stringify(result.value);
  // An enclosing return repeats a child's result; it is not a second place that changed it.
  if(result.changed){const descendants=(id:string):ReplayCall[]=>model.byCall[id].children.flatMap(child=>[model.byCall[child],...descendants(child)]);result.changed=!descendants(call.id).some(child=>{if(child.kind!=='method')return false;const left=findField(child.input,inputData(child,model,mode),field),right=findField(child.output,bodyValue(visibleValue(child.output,mode)),field);return left.value!==undefined&&right.value!==undefined&&!left.notice&&!right.notice&&JSON.stringify(left.value)!==JSON.stringify(right.value)&&JSON.stringify(right.value)===JSON.stringify(result.value);});}
 }
 return result;
}
function sqlTraceLimit(call:ReplayCall,field:TraceField,result:TraceValue){
 if(result.matched!=='name')return result;
 const columns=sqlOf(call).match(/^\s*INSERT\s+INTO\s+[\w.`"]+\s*\(([^)]+)\)/i)?.[1].split(',').map(name=>name.trim().replace(/^[`"]|[`"]$/g,'')),index=columns?.indexOf(field.name);
 if(index!==undefined&&index>=0)result.notice=limitsAt(call.input,'parameters.'+(index+1))||result.notice;return result;
}
function fact(model:ReplayModel,step:ReplayStep,mode:DisplayMode){
 if(mode==='structure')return '这份记录没有保存具体内容';
 const call=model.byCall[step.callId],input=inputData(call,model,mode),output=bodyValue(visibleValue(call.output,mode));
 const direct=call.children.map(id=>model.byCall[id])[0],target=direct?.kind==='method'&&direct.records.some(record=>record.versionMatch&&(record.symbolId||record.attributes['codeleader.point']))?direct:undefined;
 const sql=direct?.kind==='sql'?sqlAction(direct):undefined,delivery=direct?.kind==='sql'&&sql?.table?`${sql.action==='SELECT'?'读取':sql.action==='DELETE'?'删除':sql.action==='UPDATE'?'修改':'写入'} ${shortTable(sql.table)}`:target?`交给 ${target.name}`:'处理完返回';
 if(step.exception)return exceptionSummary(call.error)||'这一步出错了，没录到错误内容';
 if(call.kind==='sql'){
  const {action,table}=sqlAction(call),prefix=[action||'SQL',table].filter(Boolean).join(' ');
  if(step.phase==='enter')return `${prefix} · 开始执行`;
  const rows=isObject(output)&&typeof output.observedRows==='number'?output.observedRows:undefined;
  if(action==='SELECT')return `${prefix} · ${rows===undefined?'没录到返回行数':`已读取 ${rows} 行`}`;
  // No generated-key record means no invented id, even if a later method returns one.
  const id=isObject(output)?output.generatedKey:undefined;
  return `${prefix} · ${id!==undefined?`得到 id = ${literal(id)}`:output===undefined?'没录到执行结果':'执行结束'}`;
 }
 if(call.kind==='browser'&&step.phase==='enter')return isObject(input)?`提交 ${Object.keys(input).length} 个字段：${Object.keys(input).join('、')}`:input===undefined?['GET','HEAD'].includes(model.request.method)?'无入参':'没录到提交内容':`提交 ${literal(input)}`;
 if(step.phase==='enter')return call.kind==='method'&&call.parentId&&['browser','http'].includes(model.byCall[call.parentId]?.kind)?`收下请求，${delivery}`:delivery;
 if(call.kind==='browser'){
  const count=isObject(output)?Object.keys(output).length:undefined,before=isObject(input)?Object.keys(input).length:undefined;
  return `返回 ${model.request.status||'状态未录到'}${count!==undefined?` · ${count} 个字段${before!==undefined&&count>before?`（比提交多 ${count-before} 个）`:''}`:Array.isArray(output)?` · ${output.length} 项`:output===undefined?' · 没录到返回内容':''}`;
 }
 const comparison=methodComparison(call.input,call.output,mode),changes=comparison.filter(row=>row.kind==='changed').map(row=>`${row.field} ${literal(row.before)} → ${literal(row.after)}`),added=comparison.filter(row=>row.kind==='added').map(row=>row.field);
 if(changes.length||added.length)return [...changes,...(added.length?['新增 '+added.join('、')]:[])].join(' · ')+(comparison.some(row=>row.kind==='unknown')?' · 部分内容没录全':'');
 if(comparison.length&&comparison.every(row=>row.kind==='same'))return `没有改动数据${delivery?'，'+delivery:''}`;
 if(output===undefined)return '没录到返回内容';
 if(output===null)return '返回 null';
 return isObject(output)?`返回 ${Object.keys(output).length} 个字段`:Array.isArray(output)?`返回 ${output.length} 项`:'返回 '+literal(output);
}
export function walkthroughRows(model:ReplayModel,mode:DisplayMode,field?:TraceField,position=Infinity):WalkthroughRow[]{
 let reference=field?.value;
 return methodRows(model,model.calls.map(call=>call.id),mode).map(row=>{
  const call=model.byCall[row.id],last=call.returnId||call.enterId,step=model.steps[model.positions[last]],sample=row.callIds.map(id=>model.byCall[id]).find(c=>c.output!==undefined)||call;
  const traceStep=call.kind==='browser'||position<model.positions[sample.returnId||sample.enterId]?sample.enterId:sample.returnId||sample.enterId;
  const trace=field?stepTrace(model,model.steps[model.positions[traceStep]],field,mode,reference):undefined;if(trace?.value!==undefined&&!trace.notice)reference=trace.value;
  const limits=[...valueLimits(call.input),...valueLimits(sample.output)],notice=limits.length?' · '+[...new Set(limits.map(limit=>limit.message))].join(' · '):'';
  const sql=row.sql!==undefined,changes=methodComparison(call.input,call.output,mode).some(item=>['added','changed'].includes(item.kind));
  const description=mode==='structure'?'这份记录没有保存具体内容':sql?[row.name,row.detail].filter(Boolean).join(' · '):(call.kind==='method'&&!changes||call.kind==='http')?fact(model,model.steps[model.positions[call.enterId]],mode):fact(model,step,mode);
  return {id:row.stepId,callId:row.id,callIds:row.callIds,name:call.kind==='browser'?'浏览器':call.kind==='chroma'?'Chroma 检索':call.kind==='http'?call.records.find(record=>record.kind===2)?.name||call.name:row.name,depth:row.depth,phase:stepPhase(model,step),fact:description+notice,trace,title:row.sql};
 });
}
export function traceText(trace:TraceValue){return trace.value===undefined?'—':literal(trace.value);}
