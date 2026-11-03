import type {Location,ProjectIndex} from '../shared/model';
import {wording} from './ui-wording';

export default function FrontendPageDetails({index,moduleId,onSource}:{index:ProjectIndex;moduleId:string;onSource:(l:Location)=>void}){
 const model=index.frontend!,module=model.modules.find(m=>m.id===moduleId)!,pages=model.pages.filter(p=>p.componentModuleIds.includes(moduleId)),pageIds=new Set(pages.map(p=>p.id));
 const calls=model.httpCalls.filter(c=>!c.test&&(c.moduleId===moduleId||c.pageIds.some(id=>pageIds.has(id)))),results=index.frontendLinks?.calls||[];
 const matched=calls.filter(c=>results.some(r=>r.callId===c.id&&r.outcome==='matched')).length,imports=model.imports.filter(i=>i.from===moduleId&&i.to);
 return <section className="frontend-page-readout" data-summary-kind="frontend-page" data-page-total={calls.length} data-page-matched={matched} data-page-unmatched={calls.length-matched}>
  <h2>{pages[0]?.paths.join(' / ')||module.name}</h2>{!calls.length?<p data-page-empty>{wording('pageNoCalls')}</p>:<><p>{calls.length} 个接口调用 · 对上 {matched}，{calls.length-matched} 个没对上</p><div className="wording-call-list">{calls.map(call=>{const result=results.find(r=>r.callId===call.id);return <div key={call.id} data-detail-call-id={call.id}><strong>{call.method==='UNKNOWN'?'方法未知':call.method} {call.url}</strong><span>{result?.outcome==='matched'?'已对上':result?.outcome==='path-only'?'按路径对上，地址未确认':result?.outcome==='ambiguous'?'还不能确定是哪个接口':'还没对上后端接口'}</span><button className="source-link" onClick={()=>onSource(call.location)}>{call.location.file}:{call.location.range.start.line+1}</button></div>;})}</div></>}
  {!!imports.length&&<details><summary>引入的文件</summary>{imports.map((item,i)=><button className="source-link" key={i} onClick={()=>onSource(item.location)}>{item.specifier}</button>)}</details>}
  <button className="button" onClick={()=>onSource(module.location)}>查看页面源码</button>
 </section>;
}
