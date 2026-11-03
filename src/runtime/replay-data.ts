import type { SafeValue } from '../shared/execution';
import { sensitive, isActual, hideActual } from './snapshot';

type ObjectValue={ [key:string]:SafeValue };
const object=(v:SafeValue):v is ObjectValue=>!!v&&typeof v==='object'&&!Array.isArray(v);
const only=(v:ObjectValue,keys:string[])=>Object.keys(v).every(k=>keys.includes(k));
export function summaryKind(value:SafeValue):'array'|'structure'|'limit'|undefined{
  if(typeof value==='string'&&/^\[(?:隐藏|深度限制|截断|已屏蔽)/.test(value))return 'limit';
  if(!object(value))return undefined;
  if(value.truncated===true&&only(value,['truncated','reason']))return 'limit';
  if(value.type==='array'&&typeof value.count==='number'&&Array.isArray(value.items)&&only(value,['type','count','items']))return 'array';
  if(typeof value.type==='string'&&only(value,['type','length'])&&
    (['string','number','boolean','bool','int','float','object','undefined','function','bigint','symbol'].includes(value.type)||/^(?:org\.springframework\.|java\.)/.test(value.type)))return 'structure';
  return undefined;
}
export function cleanDisplay(value:SafeValue):SafeValue{
  if(isActual(value))return value;
  if(Array.isArray(value))return value.map(cleanDisplay);
  if(object(value))return Object.fromEntries(Object.entries(value).filter(([k])=>!sensitive.test(k)).map(([k,v])=>[k,cleanDisplay(v)]));
  return value;
}
/** This display conversion never requests new values or changes the capture policy. */
export function displayValue(value:SafeValue,mode:'structure'|'synthetic'|'raw'|'hidden'):SafeValue{
  if(isActual(value))return mode==='hidden'?{...value,value:hideActual(value.value)}:value;
  const clean=cleanDisplay(value);if(mode==='synthetic')return clean;
  const convert=(v:SafeValue):SafeValue=>{
    const kind=summaryKind(v);if(kind==='structure'||kind==='limit')return v;
    if(kind==='array'){const a=v as ObjectValue;return {...a,items:(a.items as SafeValue[]).map(convert)};}
    if(Array.isArray(v))return {type:'array',count:v.length,items:v.map(convert)};
    if(object(v))return Object.fromEntries(Object.entries(v).map(([k,item])=>[k,convert(item)]));
    return v===null?null:typeof v==='string'?{type:'string',length:v.length}:{type:typeof v};
  };return convert(clean);
}
export function structuralOnly(value:SafeValue|undefined):boolean{
  if(value===undefined)return true;
  const kind=summaryKind(value);if(kind==='structure'||kind==='limit')return true;
  if(kind==='array')return ((value as ObjectValue).items as SafeValue[]).every(structuralOnly);
  if(Array.isArray(value))return value.every(structuralOnly);
  if(object(value))return Object.entries(value).filter(([k])=>!sensitive.test(k)).every(([,v])=>structuralOnly(v));
  return false;
}
const typeOf=(v:SafeValue)=>summaryKind(v)==='structure'?String((v as ObjectValue).type):summaryKind(v)==='array'||Array.isArray(v)?'array':v===null?'null':typeof v;
const unknown=(v:SafeValue):boolean=>summaryKind(v)==='structure'||summaryKind(v)==='limit'||typeof v==='string'&&v.length>=640;
const complete=(v:SafeValue):boolean=>{
  if(unknown(v))return false;
  if(summaryKind(v)==='array'){const a=v as ObjectValue;return (a.items as SafeValue[]).length===a.count&&(a.items as SafeValue[]).every(complete);}
  if(Array.isArray(v))return v.every(complete);
  if(object(v))return Object.keys(v).length<20&&Object.keys(v).every(k=>!sensitive.test(k))&&Object.values(v).every(complete);
  return true;
};
export type Difference={path:string;kind:'added'|'missing'|'type'|'value'|'same'|'unknown'|'rename';message:string};
export function compareSnapshots(before:SafeValue|undefined,after:SafeValue|undefined):Difference[]{
  if(isActual(before)&&isActual(after))return compareActual(before,after);
  if(before===undefined||after===undefined)return [{path:'',kind:'unknown',message:'这两处没有可比较的数据'}];
  const result:Difference[]=[];
  const add=(path:string,kind:Difference['kind'],message:string)=>{if(result.length<48)result.push({path,kind,message});};
  const walk=(a:SafeValue,b:SafeValue,path:string,depth:number)=>{
    if(depth>5){add(path,'unknown','超出比较深度，无法判断');return;}
    if(summaryKind(a)==='limit'||summaryKind(b)==='limit'){add(path,'unknown','包含隐藏或截断，无法判断');return;}
    if(typeOf(a)!==typeOf(b)){add(path,'type',`${typeOf(a)} → ${typeOf(b)}：类型不同`);return;}
    if(unknown(a)||unknown(b)){add(path,'unknown','仅有结构、隐藏或可能截断，无法判断原值');return;}
    if(summaryKind(a)==='array'||Array.isArray(a)){
      const items=(v:SafeValue)=>Array.isArray(v)?v:(v as ObjectValue).items as SafeValue[];
      const count=(v:SafeValue)=>Array.isArray(v)?v.length:Number((v as ObjectValue).count);
      if(count(a)!==count(b))add(path+'.数量','value',`${count(a)} → ${count(b)} 项`);
      const left=items(a),right=items(b);for(let i=0;i<Math.min(left.length,right.length);i++)walk(left[i],right[i],`${path}[${i}]`,depth+1);
      if(left.length<count(a)||right.length<count(b))add(path,'unknown','仅比较已保存的数组项，其余无法判断');
      else if(left.length===0&&right.length===0)add(path,'same','两个已保存的空数组相同');
      return;
    }
    if(object(a)&&object(b)){
      const keys=[...new Set([...Object.keys(a),...Object.keys(b)])].filter(k=>!sensitive.test(k)).sort();
      const partial=Object.keys(a).length>=20||Object.keys(b).length>=20;
      for(const k of keys){const p=path?path+'.'+k:k;
        if(!(k in a))add(p,partial?'unknown':'added',partial?'对象可能截断，无法判断键是否缺失':'仅在当前快照出现');
        else if(!(k in b))add(p,partial?'unknown':'missing',partial?'对象可能截断，无法判断键是否缺失':'当前快照缺少此键');
        else walk(a[k],b[k],p,depth+1);
      }
      const removed=Object.keys(a).filter(k=>!sensitive.test(k)&&!(k in b)&&complete(a[k]));
      const added=Object.keys(b).filter(k=>!sensitive.test(k)&&!(k in a)&&complete(b[k]));
      if(!partial)for(const from of removed){const same=added.filter(to=>JSON.stringify(a[from])===JSON.stringify(b[to]));if(same.length===1&&removed.filter(k=>JSON.stringify(a[k])===JSON.stringify(b[same[0]])).length===1)add(path,'rename',`${from} → ${same[0]}：已保存值相同，可能改名；不证明来源`);}
      if(!keys.length)add(path,'same','两个已保存的空对象相同');return;
    }
    add(path,a===b?'same':'value',a===b?'已保存原值未变化':'已保存原值不同');
  };
  walk(before,after,'',0);return result;
}
function compareActual(before:{[key:string]:SafeValue},after:{[key:string]:SafeValue}):Difference[]{
  const result:Difference[]=[],limits=[...before.limits as SafeValue[],...after.limits as SafeValue[]];
  const limited=(path:string)=>limits.some(v=>v&&typeof v==='object'&&!Array.isArray(v)&&(String(v.path)===path||path.startsWith(String(v.path)+'.')||path.startsWith(String(v.path)+'[')));
  const add=(path:string,kind:Difference['kind'],message:string)=>{if(result.length<64)result.push({path,kind,message});};
  const walk=(a:SafeValue|undefined,b:SafeValue|undefined,path:string,depth:number)=>{
    if(depth>6||limited(path)||typeof a==='string'&&/^\[隐藏/.test(a)||typeof b==='string'&&/^\[隐藏/.test(b)){add(path,'unknown','隐藏、截断或未录到，无法判断');return;}
    if(a===undefined||b===undefined){add(path,a===undefined?'added':'missing',a===undefined?'仅在当前快照出现':'当前快照缺少此键');return;}
    const type=(v:SafeValue)=>v===null?'null':Array.isArray(v)?'array':typeof v;
    if(type(a)!==type(b)){add(path,'type',`${type(a)} → ${type(b)}`);return;}
    if(Array.isArray(a)&&Array.isArray(b)){if(a.length!==b.length)add(path,'value',`${a.length} → ${b.length} 项`);for(let i=0;i<Math.max(a.length,b.length);i++)walk(a[i],b[i],`${path}[${i}]`,depth+1);if(!a.length&&!b.length)add(path,'same','两个空数组相同');return;}
    if(object(a)&&object(b)){const keys=[...new Set([...Object.keys(a),...Object.keys(b)])];for(const key of keys)walk(a[key],b[key],path?path+'.'+key:key,depth+1);if(!keys.length)add(path,'same','两个空对象相同');const removed=Object.keys(a).filter(k=>!(k in b)),added=Object.keys(b).filter(k=>!(k in a));for(const from of removed){const candidates=added.filter(to=>JSON.stringify(a[from])===JSON.stringify(b[to]));if(candidates.length===1)add(path,'rename',`${from} → ${candidates[0]}：可能改名`);}return;}
    add(path,a===b?'same':'value',a===b?'已保存值相同':'已保存值不同');
  };walk(before.value,after.value,'',0);return result;
}
