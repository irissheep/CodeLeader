import type { SafeValue, CapturePolicy } from '../shared/execution';
export const sensitive=/password|passwd|secret|token|cookie|authorization|credential|api.?key/i;
const rawFields=new Set(['question','answer','mode','id','userId','user_id','noteId','note_id','revision','indexed','reason','count','status']);
export function snapshot(value:unknown,policy:CapturePolicy,key='',depth=0):SafeValue {
  if(policy==='raw')return actualSnapshot(value);
  if(sensitive.test(key))return '[隐藏]';
  if(value==null)return null;
  if(depth>4)return '[深度限制]';
  if(typeof value==='boolean'||typeof value==='number')return policy==='synthetic'&&rawFields.has(key)?value:{type:typeof value};
  if(typeof value==='string')return policy==='synthetic'&&rawFields.has(key)?value.slice(0,640):{type:'string',length:value.length};
  if(Array.isArray(value))return {type:'array',count:value.length,items:value.slice(0,5).map(v=>snapshot(v,policy,key,depth+1))};
  if(typeof value==='object'){
    const proto=Object.getPrototypeOf(value);if(proto!==Object.prototype&&proto!==null)return {type:'object'};
    const result:Record<string,SafeValue>={};for(const name of Object.keys(value).slice(0,20))result[name]=snapshot(Object.getOwnPropertyDescriptor(value,name)?.value,policy,name,depth+1);return result;
  }
  return {type:typeof value};
}
export function safeUrl(raw:string){try{const u=new URL(raw);return u.origin+u.pathname;}catch{return '[URL 无效]';}}
export function boundedSnapshot(value:unknown,policy:CapturePolicy){if(policy==='raw')return actualSnapshot(value);const result=snapshot(value,policy);return new TextEncoder().encode(JSON.stringify(result)).length>12000?{truncated:true,reason:'snapshot budget'}:result;}
export function isActual(value:SafeValue|undefined):value is {[key:string]:SafeValue}&{__codeleader_snapshot:2;value:SafeValue;limits:SafeValue[]}{return !!value&&typeof value==='object'&&!Array.isArray(value)&&value.__codeleader_snapshot===2&&'value' in value&&Array.isArray(value.limits);}
/** Only own data properties. Metadata is outside the user's object (including its type field). */
export function actualSnapshot(value:unknown,maxBytes=65536):SafeValue {
  const limits:Record<string,SafeValue>[]=[],seen=new Set<object>();let bytes=0;
  const limit=(path:string,reason:string,originalLength?:number,saved?:number)=>{if(limits.length<64)limits.push({path:path.slice(0,512),reason,...(originalLength===undefined?{}:{originalLength}),...(saved===undefined?{}:{saved})});};
  const walk=(v:unknown,path:string,depth:number):SafeValue=>{
    if(bytes>=maxBytes){limit(path,'字节预算');return null;}
    if(v===null||v===undefined){if(v===undefined)limit(path,'未定义');return null;}
    if(typeof v==='boolean'||typeof v==='number'){bytes+=16;return Number.isFinite(v as number)||typeof v==='boolean'?v:null;}
    if(typeof v==='bigint')return v.toString();
    if(typeof v==='string'){const saved=Math.min(v.length,8192,Math.max(0,Math.floor((maxBytes-bytes)/6)));if(saved<v.length)limit(path,'字符串预算',v.length,saved);bytes+=new TextEncoder().encode(v.slice(0,saved)).length;return v.slice(0,saved);}
    if(typeof v!=='object'){limit(path,'不支持的值类型');return null;}
    if(depth>=6){limit(path,'深度预算');return null;}
    if(seen.has(v)){limit(path,'循环引用');return null;}seen.add(v);
    try{
      if(Array.isArray(v)){const count=Math.min(v.length,50),items:SafeValue[]=[];if(count<v.length)limit(path,'数组预算',v.length,count);for(let i=0;i<count;i++){const descriptor=Object.getOwnPropertyDescriptor(v,String(i)),p=`${path}[${i}]`;if(descriptor&&!('value' in descriptor)){limit(p,'未读取访问器');items.push(null);}else items.push(walk(descriptor?.value,p,depth+1));}return items;}
      if(Object.getPrototypeOf(v)!==Object.prototype&&Object.getPrototypeOf(v)!==null){limit(path,'未适配对象');return null;}
      const names=Object.keys(v),saved=names.slice(0,64),result:Record<string,SafeValue>={};if(saved.length<names.length)limit(path,'字段预算',names.length,saved.length);
      for(const key of saved){const descriptor=Object.getOwnPropertyDescriptor(v,key),p=path?path+'.'+key:key;if(key.length>256){limit(p,'字段名预算',key.length,0);continue;}bytes+=key.length*6;if(!descriptor||!('value' in descriptor)){limit(p,'未读取访问器');continue;}Object.defineProperty(result,key,{value:walk(descriptor.value,p,depth+1),enumerable:true,configurable:true});}return result;
    }catch{limit(path,'快照读取失败');return null;}finally{seen.delete(v);}
  };
  const result={__codeleader_snapshot:2,value:walk(value,'',0),limits},encoded=new TextEncoder().encode(JSON.stringify(result)).length;
  return encoded<=maxBytes?result:{__codeleader_snapshot:2,value:null,limits:[{path:'',reason:'快照字节预算',originalLength:encoded,saved:0,unit:'字节'}]};
}
export function hideActual(value:SafeValue):SafeValue {
  if(Array.isArray(value))return value.map(hideActual);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,v])=>[key,sensitive.test(key)||/^(parameters|savedRows|batches)$/.test(key)?'[隐藏]':hideActual(v)]));
  if(typeof value==='string'){
    if(/^\s*[\[{]/.test(value)){try{const parsed=JSON.parse(value);if(parsed&&typeof parsed==='object')return JSON.stringify(hideActual(parsed));}catch{if(/password|token|cookie|authorization|secret/i.test(value))return '[隐藏的正文]';}}
    if(/^https?:\/\//.test(value)){try{const url=new URL(value);for(const key of url.searchParams.keys())if(sensitive.test(key))url.searchParams.set(key,'[隐藏]');return url.href;}catch{}}
    if(/(?:^|&)(?:password|token|secret|api_key)=/i.test(value)){const form=new URLSearchParams(value);for(const key of form.keys())if(sensitive.test(key))form.set(key,'[隐藏]');return form.toString();}
  }
  return value;
}
export function changes(before:SafeValue|undefined,after:SafeValue|undefined){
  if(!before||!after||Array.isArray(before)||Array.isArray(after)||typeof before!=='object'||typeof after!=='object')return [];
  return [...new Set([...Object.keys(before),...Object.keys(after)])].flatMap(key=>!(key in before)?[`${key}：新增`]:!(key in after)?[`${key}：移除`]:JSON.stringify(before[key])!==JSON.stringify(after[key])?[`${key}：值或结构变化`]:[]);
}
