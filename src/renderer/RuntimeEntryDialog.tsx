import {useState} from 'react';
import type {StartupPlan} from '../shared/startup';
import {OverlayShell} from './OverlayShell';

export function RuntimeEntryDialog({plan,frontendIds,busy,error,onClose,onConnect,onStartup,onHistory}:{plan?:StartupPlan;frontendIds:string[];busy:boolean;error:string;onClose:()=>void;onConnect:(url:string)=>void;onStartup:(plan:StartupPlan,command?:string)=>void;onHistory?:()=>void}){
 const [address,setAddress]=useState(''),[command,setCommand]=useState(''),[enterAddress,setEnterAddress]=useState(false);
 const choice=plan?.choices.find(item=>frontendIds.includes(item.unitId)&&item.command.label);
 const portBasis=choice?.command.basis.find(item=>item.note.includes('端口')||/--port(?:=|\s+)\d+/.test(item.note));
 const foundAddress=choice?.port&&choice.port<=65535&&portBasis?`http://localhost:${choice.port}`:'';
 const start=()=>{if(!plan||!choice)return;const selected=[...plan.selected.filter(id=>plan.choices.find(item=>item.id===id)?.unitId!==choice.unitId),choice.id];onStartup({...plan,selected,url:foundAddress||address});};
 const footer=<><button className="button primary overlay-primary" disabled={busy||(!address&&(!choice||enterAddress||!foundAddress))} onClick={()=>choice&&!enterAddress?start():onConnect(address)}>{choice&&!enterAddress?'启动并打开':'打开'}</button><div className="overlay-secondary">{choice?<button className="button" onClick={()=>setEnterAddress(value=>!value)}>{enterAddress?'返回启动方式':'填写已运行地址'}</button>:<button className="button" disabled={busy||!command||!address||!plan} onClick={()=>plan&&onStartup({...plan,url:address},command)}>启动并打开</button>}{onHistory&&<button className="button" onClick={onHistory}>查看已有记录</button>}</div></>;
 return <OverlayShell id="runtime-entry" title="打开真实页面" onClose={onClose} busy={busy} footer={footer}>
  {busy&&!plan?<p>正在查找启动方式…</p>:choice&&!enterAddress?<><p>已找到前端的启动方式</p><dl><dt>命令</dt><dd><code>{choice.command.label}</code>{choice.command.basis[0]&&<small>来自 {choice.command.basis[0].file}{choice.command.basis[0].line?':'+choice.command.basis[0].line:''}</small>}</dd><dt>地址</dt><dd>{foundAddress?<><code>{foundAddress}</code><small>来自 {portBasis?.file}{portBasis?.line?':'+portBasis.line:''}{portBasis?.note.includes('默认')?' · 默认值':''}</small></>:<span>没有找到明确的页面地址，请填写。</span>}</dd></dl>{!foundAddress&&<label>页面地址<input aria-label="页面地址" value={address} onChange={event=>setAddress(event.target.value)}/></label>}</>:<><p>{choice?'填写已运行页面的地址。':'没找到前端的启动方式。'}</p><label>页面地址<input aria-label="页面地址" value={address} onChange={event=>setAddress(event.target.value)}/></label>{!choice&&<label>启动命令<input aria-label="启动命令" value={command} onChange={event=>setCommand(event.target.value)}/></label>}</>}
  {error&&<p role="alert">{error}</p>}
 </OverlayShell>;
}
