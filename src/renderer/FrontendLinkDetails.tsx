import {useState} from 'react';
import type {Location,ProjectIndex} from '../shared/model';
import type {FrontendLinkOutcome} from '../shared/frontend-links';
import './frontend-links.css';
const labels:Record<FrontendLinkOutcome,string>={matched:'已对上',ambiguous:'多个可能目标',unmatched:'没对上',configured:'只靠配置推测','path-only':'按路径对上，地址未确认'};
const reasons={unique:'方法、地址和接口都能对应',multiple:'暂时不能确定是哪一个', 'unknown-address':'地址未确定','external-backend':'后端在项目之外','path-mismatch':'路径不一致','configuration-only':'地址能对应这个应用，具体接口没对上','path-only':'按路径对上，地址未确认','missing-endpoint':'没对上：项目后端没有这个接口','multiple-paths':'同一路径对应多个后端，请指定后端'};
export default function FrontendLinkDetails({index,onSource,file}:{index:ProjectIndex;onSource:(location:Location)=>void;file?:string}){
 const [filter,setFilter]=useState<'all'|FrontendLinkOutcome>('all');const data=index.frontendLinks;if(!data)return null;
 const rows=data.calls.filter(c=>(!file||c.source.file===file)&&(filter==='all'||c.outcome===filter));
 const source=(location:Location,label?:string)=><button className="frontend-source" title={`${location.file}:${location.range.start.line+1}`} onClick={()=>onSource(location)}>{label||`${location.file}:${location.range.start.line+1}`}</button>;
 const name=(id:string)=>index.units?.find(u=>u.id===id)?.root||index.name;
 return <section className="frontend-links"><h3>接口去向</h3>
  {!file&&!!data.units.length&&<div className="frontend-unit-links">{data.units.map(link=><div key={link.id} className={`frontend-unit-link ${link.lineStyle}`}><span>{link.kind==='embedded'?'页面 → 同一应用':`${name(link.from)} → ${name(link.to)}`}</span><small>已对上 {link.matched.length} / 未对上 {link.unmatched.length+link.ambiguous.length}</small></div>)}</div>}
  {!file&&<div className="frontend-link-filters" role="group" aria-label="接口去向"><button aria-pressed={filter==='all'} onClick={()=>setFilter('all')}>全部 {data.calls.length}</button>{Object.entries(labels).map(([value,label])=><button key={value} aria-pressed={filter===value} onClick={()=>setFilter(value as FrontendLinkOutcome)}>{label} {data.calls.filter(c=>c.outcome===value).length}</button>)}</div>}
  {!rows.length&&<p className="detail-note">{data.calls.length?'这个范围没有对应的调用。':'没有发现前端接口调用。'}</p>}
  {rows.map(row=>{const call=index.frontend?.httpCalls.find(c=>c.id===row.callId);return <details className={`frontend-link-row ${row.outcome}`} key={row.id}><summary><span className="frontend-link-state">{labels[row.outcome]}</span><span className="frontend-call-name" title={call?.url}>{row.method==='UNKNOWN'?'方法未知':row.method} {call?.url}</span></summary>
    <p>{row.userTarget?'用户指定 · ':''}{row.userTarget&&row.addresses.some(a=>!a.known)?'按用户指定的后端核对路径，原地址仍未写明':reasons[row.reason]}</p><p>{source(row.source)}</p>
    {row.targets.map(target=><div className="frontend-target" key={target.id}><strong>{target.method} {target.path}</strong>{source(target.location)}<small>{target.profile==='defaults'?'源码默认设置':target.profile}{target.kind==='framework'?' · 框架提供的接口':''}</small>{target.conditions.map((value,i)=><small key={i}>{value}</small>)}</div>)}
    {!!row.external&&<p className="frontend-external">项目外 · {row.external.host}:{row.external.port}{source(row.external.location,'查看地址来源')}</p>}
    {row.outcome==='configured'&&<div>{row.configuredUnitIds.map(name).join(' / ')}<span className="frontend-dashed-arrow" aria-label="仅地址配置对应"> → </span>具体接口还没对上{row.configurationTargets.map((target,i)=><p key={i}>{source(target.location,'查看应用地址来源')} · {target.profile}</p>)}</div>}
    {!!row.pathCandidates.length&&<details><summary>相同路径的接口 · {row.pathCandidates.length}</summary><p className="detail-note">地址还没确定，这些只用于核对。</p>{row.pathCandidates.map(target=><p key={target.id}>{target.method} {target.path} {source(target.location)}</p>)}</details>}
    <details><summary>地址与来源</summary>{row.addresses.map(address=><div key={address.id}><p className="detail-path">{address.url}</p><p>{address.known?'按这份配置对应':'地址未确定'} · {address.profile}</p>{address.conditions.map((text,i)=><small key={i}>{text}</small>)}{address.basis.map((basis,i)=><p key={i}>{source(basis.location,basis.note)}</p>)}</div>)}</details>
   </details>;})}
 </section>;
}
