import type {SafeValue} from '../shared/execution';
import {displayValue,summaryKind} from '../runtime/replay-data';
import {isActual} from '../runtime/snapshot';
export type DisplayMode='structure'|'synthetic'|'raw'|'hidden';
export const isObject=(value:SafeValue|undefined):value is Record<string,SafeValue>=>!!value&&typeof value==='object'&&!Array.isArray(value);
export function unwrap(value:SafeValue):SafeValue{
  if(isActual(value))return unwrap(value.value);
  if(Array.isArray(value))return value.map(unwrap);
  if(isObject(value))return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,unwrap(item)]));
  return value;
}
export function visibleValue(value:SafeValue|undefined,mode:DisplayMode):SafeValue|undefined{
  return value===undefined?undefined:unwrap(displayValue(value,mode));
}
export function bodyValue(value:SafeValue|undefined):SafeValue|undefined{
  if(isObject(value)&&'body'in value&&('headers'in value||'bodyBytes'in value||'status'in value)){const body=value.body;if(typeof body==='string'){try{return JSON.parse(body) as SafeValue;}catch{return body;}}return body;}
  return value;
}
export function fullValue(value:SafeValue|undefined){return value===undefined?'—':typeof value==='string'?value:JSON.stringify(value);}
export function shortValue(value:SafeValue|undefined){
  const full=fullValue(value);if(typeof value==='string'&&/^\d{4}-\d\d-\d\d[T ]\d\d:\d\d/.test(value))return value.slice(5,16).replace('T',' ');
  return full.length>70?full.slice(0,69)+'…':full;
}
export function valueLimits(value:SafeValue|undefined):{path:string;message:string}[]{
  if(value===undefined||value===null||typeof value!=='object')return [];
  if(isActual(value))return [...(value.limits as Record<string,SafeValue>[]).map(limit=>({path:String(limit.path||''),message:typeof limit.originalLength==='number'?`已截断，原长 ${limit.originalLength}`:/unsupported|未适配|未定义|不支持/.test(String(limit.reason))?'没录到：这类内容没有保存。':'这部分内容没有完整保存。'})),...valueLimits(value.value)];
  return Object.values(value).flatMap(valueLimits);
}
export interface ComparisonRow {field:string;before?:SafeValue;after?:SafeValue;beforeNotice?:string;afterNotice?:string;kind:'added'|'same'|'changed'|'removed'|'unknown'}
export function methodComparison(input:SafeValue|undefined,output:SafeValue|undefined,mode:DisplayMode,request=false):ComparisonRow[]{
  let before=visibleValue(input,mode),after=visibleValue(output,mode);
  if(request){before=bodyValue(before);after=bodyValue(after);}
  if(!isObject(before)||!isObject(after))return [];
  const original=before,flatten=!request&&isObject(original.request)&&!Object.keys(original.request).some(key=>key!=='request'&&key in original);
  if(flatten)before={...Object.fromEntries(Object.entries(before).filter(([key])=>key!=='request')),...before.request as Record<string,SafeValue>};
  if(!request&&!Object.keys(before).some(key=>key in after))return [];
  const fieldPath=(path:string)=>request?path.replace(/^body(?:\.|$)/,''):flatten?path.replace(/^request\./,''):path;
  const left=before as Record<string,SafeValue>,right=after,limits=[...valueLimits(input),...valueLimits(output)].map(l=>fieldPath(l.path));
  return [...new Set([...Object.keys(left),...Object.keys(right)])].map(field=>{
    const a=left[field],b=right[field],limited=limits.some(path=>!path||field===path||path.startsWith(field+'.'))||summaryKind(a??null)==='structure'||summaryKind(b??null)==='structure'||typeof a==='string'&&a.startsWith('[隐藏')||typeof b==='string'&&b.startsWith('[隐藏');
    const notice=(value:SafeValue|undefined,source:SafeValue|undefined)=>value===null&&valueLimits(source).some(limit=>fieldPath(limit.path)===field&&limit.message.startsWith('没录到'))?'没录到':undefined;
    return {field,before:a,after:b,beforeNotice:notice(a,input),afterNotice:notice(b,output),kind:limited?'unknown':!(field in left)?'added':!(field in right)?'removed':JSON.stringify(a)===JSON.stringify(b)?'same':'changed'};
  });
}
export function groupedHeaders(value:SafeValue|undefined){
  const entries=isObject(value)?Object.entries(value):[],important=/^(content-type|authorization|cookie|set-cookie|location|x-.*)$/i;
  return {primary:Object.fromEntries(entries.filter(([key])=>important.test(key))),other:Object.fromEntries(entries.filter(([key])=>!important.test(key)))};
}
export function resultSummary(value:SafeValue|undefined,path=''){
  if(value===undefined)return undefined;
  if(Array.isArray(value))return `列表 · 共 ${value.length} 条`;
  if(isObject(value)){const lists=Object.entries(value).filter(([,v])=>Array.isArray(v));return lists.length===1?`${lists[0][0]} 共 ${(lists[0][1] as SafeValue[]).length} 条`:`对象 · ${Object.keys(value).length} 个字段`;}
  return value===null?'返回空值':`返回 ${typeof value==='string'?'文本':'1 个值'}`;
}
export function exceptionSummary(error:SafeValue|undefined){
  if(error===undefined)return undefined;const value=unwrap(error);
  if(isObject(value)){const type=value.type||value.name||'异常',message=value.message;return `抛出 ${String(type)}${message?`：${String(message)}`:''}`;}
  return `抛出 ${String(value).split('\n')[0]}`;
}
