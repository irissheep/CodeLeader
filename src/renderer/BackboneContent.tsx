import type {EntryPoint,Location} from '../shared/model';
import type {GraphCard} from './graph-model';
import policy from '../shared/backbone-policy.json';
import {AddressExplanation,useAnalysisNotes} from './AnalysisNotes';
import BackendChoice from './BackendChoice';
import {wording} from './ui-wording';
import {frontendCounts} from './frontend-reading';

export function FrontendContent({card,onSource,onEntry,onTarget,summary=true}:{card:GraphCard;onSource:(location:Location)=>void;onEntry:(entry:EntryPoint)=>void;onTarget?:(target?:import('../shared/frontend-links').FrontendTarget)=>void;summary?:boolean}){
 const data=card.frontend!,{notes}=useAnalysisNotes(),address=notes?.addresses.find(n=>n.unitId===card.unit?.id);
 const call=(id:string)=>{const item=data.calls.find(c=>c.id===id);return item&&<details key={id} className="backbone-call" data-detail-call-id={id}><summary title={item.name}>{item.name}</summary><button onClick={()=>onSource(item.location)}>查看调用源码</button>{item.state==='ambiguous'&&<span>多个可能目标</span>}{item.state==='path-only'&&<span>按路径对上，地址未确认</span>}{item.targets.map((t,i)=><button key={i} className="backbone-target" onClick={()=>t.entry?onEntry(t.entry):onSource(t.location)}>{t.name} →</button>)}{!item.targets.length&&<span>{item.state==='configured'?'配置推测':'没对上：项目后端没有这个接口'}</span>}</details>;};
 const assigned=new Set(data.pages.flatMap(p=>p.callIds)),counts=frontendCounts(card);
 return <div className="backbone-frontend-content nodrag nopan" onClick={e=>e.stopPropagation()} onDoubleClick={e=>e.stopPropagation()}>
  {summary&&<><p className="backbone-role" title="前端页面与接口">前端页面与接口</p><p data-copy-key="frontend-total">页面 {data.pages.length} · 调用 {counts.total} 个接口</p><p data-copy-key="frontend-match">已对上 {counts.matched} / 未对上 {counts.unmatched}</p>{address?<AddressExplanation note={address}/>:card.explanation&&<p className="backbone-explanation">{card.explanation}</p>}</>}
  <BackendChoice card={card} onChange={onTarget}/>
  {card.compact===false&&<div className="backbone-inline-list" style={{height:policy.thresholds.detailsHeight.value}}>{data.pages.map(page=><details className="backbone-page" key={page.id} data-page-id={page.id} data-page-call-count={page.callIds.length}><summary title={page.name}>{page.name}<small>{page.callIds.length} 个调用</small></summary>{page.callIds.map(call)}{!page.callIds.length&&<span data-page-empty>{wording('pageNoCalls')}</span>}</details>)}{data.pages.length>0&&data.calls.some(c=>!assigned.has(c.id))&&<p>其他接口调用</p>}{data.calls.filter(c=>!assigned.has(c.id)).map(c=>call(c.id))}</div>}
 </div>;
}
