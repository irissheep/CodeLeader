import {createContext,useContext} from 'react';
import {GuideMark} from './Orientation';
export type RuntimeEntryState={available:boolean;loading:boolean;ready:boolean;configured:boolean;running:boolean;busy:boolean;requests:number;open:()=>void;configure:()=>void;stop:()=>void};
export const RuntimeEntryContext=createContext<RuntimeEntryState>({available:false,loading:false,ready:false,configured:false,running:false,busy:false,requests:0,open:()=>{},configure:()=>{},stop:()=>{}});
export function RuntimeEntry({card=false,unitId}:{card?:boolean;unitId?:string}){const r=useContext(RuntimeEntryContext);return <div className={`runtime-entry ${card?'runtime-entry-card':''}`} data-runtime-entry={r.running?'running':r.configured?'ready':'missing'}>
 {r.running?<button className="runtime-entry-button runtime-entry-running nodrag nopan" onClick={e=>{e.stopPropagation();r.stop();}}><i/>记录中 {r.requests} · 停止</button>:<><button className="runtime-entry-button nodrag nopan" disabled={!r.available} title={!r.available?(r.loading?'正在读取项目':'还没有前端项目'):undefined} onClick={e=>{e.stopPropagation();r.configure();}}><span>▶ 打开真实页面</span>{card&&<GuideMark kind="frontend" id={unitId}/>}</button>{!r.available&&!r.loading&&<small className="runtime-entry-empty-reason">还没有前端项目</small>}</>}
 </div>;}
