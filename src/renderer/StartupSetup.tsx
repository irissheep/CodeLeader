import {useState} from 'react';
import type {StartupPlan} from '../shared/startup';
import {startupWords} from '../shared/startup';
import {OverlayShell} from './OverlayShell';
import './startup.css';

export function StartupSetup({plan,busy,onConfirm,onClose}:{plan:StartupPlan;busy:boolean;onConfirm:(value:StartupPlan)=>void;onClose:()=>void}){
 const [value,setValue]=useState(()=>structuredClone(plan));
 const update=(id:string,change:Record<string,unknown>)=>setValue(p=>({...p,choices:p.choices.map(c=>c.id===id?{...c,...change}:c)}));
 const footer=<><button className="button primary overlay-primary" disabled={busy||!value.selected.length||!value.url} onClick={()=>onConfirm(value)}>{busy?'正在打开…':`启动所选（${value.selected.length}）`}</button><div className="overlay-secondary"><button className="button" disabled={busy} onClick={onClose}>取消</button></div></>;
 return <OverlayShell id="startup-setup" title="启动方式" onClose={onClose} busy={busy} footer={footer}>
 {!value.choices.length&&<p>没找到启动命令。可以先启动项目，再填写页面地址。</p>}
 {value.choices.map(c=><section className="startup-unit" key={c.id}><div className="startup-unit-row"><label><input type="checkbox" disabled={busy} checked={value.selected.includes(c.id)} onChange={e=>setValue(p=>({...p,selected:e.target.checked?[...p.selected.filter(id=>p.choices.find(a=>a.id===id)?.unitId!==c.unitId),c.id]:p.selected.filter(id=>id!==c.id)}))}/><span><strong>{c.name}</strong><small title={c.command.label}>{c.command.label}{c.port?` · ${c.port}`:''}</small></span></label><details><summary>修改</summary><div className="startup-edit">
 <label>启动命令<input aria-label={'启动命令 '+c.name} value={c.command.label} disabled={busy} onChange={e=>{const words=startupWords(e.target.value),skip=c.command.tool==='python'&&words[1]==='-m'?2:1;update(c.id,{command:{...c.command,label:e.target.value,args:words.slice(skip)}});}}/></label>
 <label>在哪个文件夹运行<input aria-label={'目录 '+c.name} value={c.root||'.'} disabled={busy} onChange={e=>update(c.id,{root:e.target.value==='.'?'':e.target.value})}/></label><label>端口<input aria-label={'端口 '+c.name} inputMode="numeric" value={c.port||''} disabled={busy} onChange={e=>update(c.id,{port:e.target.value?Number(e.target.value):undefined})}/></label>
 <details><summary>详情</summary><p>{c.profile==='defaults'?'自动找到的':c.profile}</p><p>{value.copy}{c.root?' / '+c.root:''}</p>{c.basis.map((b,i)=><p key={i}>{b.file}{b.line?':'+b.line:''} · {b.note}</p>)}{c.prepare.map((p,i)=><p key={i}>{p.label}</p>)}</details></div></details></div></section>)}
 <label>页面地址<input aria-label="启动页面地址" value={value.url} disabled={busy} onChange={e=>setValue(p=>({...p,url:e.target.value}))}/></label>
 <details><summary>更多设置</summary><label>忽略的 Python 地址<input aria-label="忽略的 Python 地址" placeholder="默认不忽略任何地址" value={value.excludedUrls} disabled={busy} onChange={e=>setValue(p=>({...p,excludedUrls:e.target.value}))}/></label><p>多项用逗号隔开。只影响记录，不改变页面。</p></details>
 <details><summary>所需资源</summary>{value.resources.map((r,i)=><p key={i}>{r.engine} · {r.note}</p>)}</details>{value.warnings.map((w,i)=><p key={i} role="status">{w}</p>)}
 </OverlayShell>;
}
