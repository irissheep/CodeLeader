import {useState} from 'react';
import type {GraphCard} from './graph-model';
import type {FrontendTarget} from '../shared/frontend-links';
import {OverlayShell} from './OverlayShell';

export default function BackendChoice({card,onChange}:{card:GraphCard;onChange?:(choice?:FrontendTarget)=>void}){
 const [open,setOpen]=useState(false),[address,setAddress]=useState(card.backendChoice?.selected?.address||''),[error,setError]=useState(''),choice=card.backendChoice;
 if(!choice||!onChange)return null;
 const close=()=>setOpen(false);
 const apply=(value?:FrontendTarget)=>{onChange(value);close();};
 const submit=()=>{try{const url=new URL(address);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw Error();apply({address:url.href.replace(/\/$/,'')});}catch{setError('请填写 http 或 https 地址');}};
 const footer=<><button className="button primary overlay-primary" disabled={!address.trim()} onClick={submit}>应用地址</button><div className="overlay-secondary">{choice.selected&&<button className="button" onClick={()=>apply()}>撤销指定</button>}<button className="button" onClick={close}>关闭</button></div></>;
 return <div className="backend-choice">{card.frontend?.calls.some(c=>c.state==='path-only')&&<span>按路径对上，地址未确认</span>}<button aria-expanded={open} onClick={()=>{setOpen(true);setAddress(choice.selected?.address||'');setError('');}}>{choice.selected?'用户指定 · 更改':'指定后端'}</button>
 {open&&<OverlayShell id="backend-choice" title="指定后端" onClose={close} footer={footer}>
  <p>只保存在工具里，不改项目文件。</p>{choice.units.map(unit=><button className="button" key={unit.id} aria-pressed={choice.selected?.backendUnitId===unit.id} onClick={()=>apply({backendUnitId:unit.id})}>{unit.name}</button>)}
  <label>后端地址<input aria-label="后端地址" value={address} placeholder="http://主机:端口" onChange={e=>setAddress(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')submit();}}/></label>
  {!!choice.addresses.length&&<details><summary>项目里写明的地址</summary>{choice.addresses.map((item,i)=><button key={i} className="backend-address-option" onClick={()=>setAddress(item.address)}><span>{item.address}</span><small>{item.location.file}:{item.location.range.start.line+1} · {item.profile==='defaults'?'默认设置':item.profile}</small></button>)}</details>}{error&&<p role="alert">{error}</p>}
 </OverlayShell>}
 </div>;
}
