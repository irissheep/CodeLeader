import {useState} from 'react';
import {Copy,FileJson,Check} from 'lucide-react';
import type {SafeValue} from '../shared/execution';
import {summaryKind} from '../runtime/replay-data';
import {isActual} from '../runtime/snapshot';
import {isObject,visibleValue,fullValue,shortValue,valueLimits,groupedHeaders,type DisplayMode,type ComparisonRow} from './execution-data';

export function RawActions({value}:{value:SafeValue|undefined}){
  const [copied,setCopied]=useState(false),[failed,setFailed]=useState(false);
  if(value===undefined)return null;const json=JSON.stringify(value,null,2);
  return <div className="value-actions" onKeyDown={event=>{if(event.key==='Escape'){const raw=event.currentTarget.querySelector<HTMLDetailsElement>('details[open]');if(raw){event.stopPropagation();raw.open=false;raw.querySelector('summary')?.focus();}}}}><button title={copied?'已复制':'复制 JSON'} aria-label={copied?'已复制':'复制 JSON'} onClick={()=>{void navigator.clipboard.writeText(json).then(()=>{setCopied(true);setFailed(false);}).catch(()=>setFailed(true));}}>{copied?<Check size={14}/>:<Copy size={14}/>}<span className="action-tooltip">{copied?'已复制':'复制 JSON'}</span></button><details className="value-raw"><summary title="原始数据" aria-label="原始数据"><FileJson size={14}/><span className="action-tooltip">原始数据</span></summary><pre>{json}</pre></details>{failed&&<p role="status">复制失败，请从原始数据复制。</p>}</div>;
}
export function ValueCell({value,full=false}:{value:SafeValue|undefined;full?:boolean}){return <details className="value-full"><summary className="value-cell" title={fullValue(value)}>{full?fullValue(value):shortValue(value)}</summary><pre>{fullValue(value)}</pre></details>;}
function FieldName({name,onTrack}:{name:string;onTrack?:(field:string)=>(()=>void)|undefined}){const track=onTrack?.(name);return <span className="value-track-field"><span>{name}</span>{track&&<button className="value-track-button" aria-label={`追踪 ${name}`} onClick={track}>追踪</button>}</span>;}
function ListValue({items,onTrack}:{items:SafeValue[];onTrack?:(field:string)=>(()=>void)|undefined}){
  const [expanded,setExpanded]=useState(false),rows=expanded?items:items.slice(0,3);
  const objectRows=items.every(isObject),keys=objectRows?[...new Set(items.flatMap(item=>Object.keys(item as Record<string,SafeValue>)))].sort((a,b)=>a==='id'?-1:b==='id'?1:0).slice(0,4):['值'];
  return <div className="value-list">{items.length?<table className="value-table"><thead><tr>{keys.map(key=><th key={key}><FieldName name={key} onTrack={onTrack}/></th>)}</tr></thead><tbody>{rows.map((item,i)=><tr key={i}>{keys.map(key=><td key={key}><ValueCell value={objectRows?(item as Record<string,SafeValue>)[key]:item}/></td>)}</tr>)}</tbody></table>:<p className="execution-muted">空列表</p>}{items.length>3&&<button className="value-expand" onClick={()=>setExpanded(v=>!v)}>{expanded?'收起':`还有 ${items.length-3} 项 · 展开`}</button>}</div>;
}
function Fields({value,legacy=false,missing=new Set<string>(),path='',onTrack}:{value:SafeValue;legacy?:boolean;missing?:Set<string>;path?:string;onTrack?:(field:string)=>(()=>void)|undefined}){
  if(missing.has(path)&&value===null)return <span className="execution-muted">没录到</span>;
  if(legacy&&summaryKind(value)==='structure')return <p className="execution-muted">这份记录没有保存具体内容。</p>;
  if(legacy&&summaryKind(value)==='array'){const list=value as Record<string,SafeValue>;return <><ListValue items={list.items as SafeValue[]} onTrack={onTrack}/>{Number(list.count)>(list.items as SafeValue[]).length&&<p className="execution-muted">另外 {Number(list.count)-(list.items as SafeValue[]).length} 项没有保存内容。</p>}</>;}
  if(Array.isArray(value))return <ListValue items={value} onTrack={onTrack}/>;
  if(isObject(value))return Object.keys(value).length?<dl className="value-object">{Object.entries(value).map(([key,item])=><div key={key}><dt><FieldName name={key} onTrack={onTrack}/></dt><dd>{isObject(item)||Array.isArray(item)?<details><summary>{Array.isArray(item)?`${item.length} 项`:`${Object.keys(item).length} 个字段`}</summary><Fields value={item} legacy={legacy} missing={missing} path={path?path+'.'+key:key} onTrack={onTrack}/></details>:missing.has(path?path+'.'+key:key)&&item===null?<span className="execution-muted">没录到</span>:<ValueCell value={item} full/>}</dd></div>)}</dl>:<p className="execution-muted">空对象</p>;
  return <p className="value-scalar">{fullValue(value)}</p>;
}
export function MethodComparison({rows,onTrack,request=false}:{rows:ComparisonRow[];onTrack?:(field:string)=>(()=>void)|undefined;request?:boolean}){
  const [all,setAll]=useState(false),fold=rows.length>8,unchanged=rows.filter(row=>row.kind==='same'),visible=fold&&!all?rows.filter(row=>row.kind!=='same'):rows;
  const marks={added:'＋新增',same:'＝不变',changed:'≠改变',removed:'－删除',unknown:'无法比较'};
  return <><table className="value-table method-value-table"><thead><tr><th>标记</th><th>字段</th><th>{request?'提交时':'进入时'}</th><th>{request?'返回时':'退出时'}</th></tr></thead><tbody>{visible.map(row=><tr key={row.field} className={`field-${row.kind}`}><td>{marks[row.kind]}</td><td title={row.field}><FieldName name={row.field} onTrack={onTrack}/></td><td>{row.beforeNotice||<ValueCell value={row.before}/>}</td><td>{row.afterNotice||<ValueCell value={row.after}/>}</td></tr>)}</tbody></table>{fold&&unchanged.length>0&&<button className="value-expand" onClick={()=>setAll(v=>!v)}>{all?'收起不变字段':`${unchanged.length} 个字段不变 · 展开`}</button>}</>;
}
export function ExecutionHeaders({value,mode,actions=true}:{value:SafeValue|undefined;mode:DisplayMode;actions?:boolean}){
  const shown=visibleValue(value,mode),{primary,other}=groupedHeaders(shown),count=Object.keys(other).length;
  if(!isObject(shown))return <ExecutionValues value={value} mode={mode} empty="没录到：这次没有保存这些内容。"/>;
  return <div className="execution-headers">{Object.keys(primary).length>0&&<Fields value={primary}/>} {count>0&&<details className="other-headers"><summary>其他 {count} 项 · 展开</summary><Fields value={other}/></details>}{valueLimits(value).map((limit,i)=><p className="value-limit" key={i}>{limit.message}</p>)}{actions&&<RawActions value={shown}/>}</div>;
}
export default function ExecutionValues({value,mode,empty,actions=true,onTrack}:{value:SafeValue|undefined;mode:DisplayMode;empty:string;actions?:boolean;onTrack?:(field:string)=>(()=>void)|undefined}){
  if(value===undefined)return <p className="execution-muted">{empty}</p>;
  const shown=visibleValue(value,mode)!;
  const limits=valueLimits(value),missing=new Set(limits.filter(limit=>limit.message.startsWith('没录到')).map(limit=>limit.path));
  return <div className="execution-values"><Fields value={shown} legacy={!isActual(value)} missing={missing} onTrack={onTrack}/>{limits.map((limit,i)=><p className="value-limit" key={i}>{limit.path&&`${limit.path}：`}{limit.message}</p>)}{actions&&<RawActions value={shown}/>}</div>;
}
