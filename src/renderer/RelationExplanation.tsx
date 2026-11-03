import { useMemo, useRef, type ReactNode } from 'react';
import type { Location, ProjectIndex, Relation, ViewState } from '../shared/model';
import { explainRelations, type ExplainedSource, type ExplanationTask } from './relation-explanation';
import { graphFor } from './graph-model';
import ResourceDetails from './ResourceDetails';
import {describe} from './ui-wording';

export default function RelationExplanation({index,view,relations,onSource,onChange,raw}:{index:ProjectIndex;view:ViewState;relations:Relation[];onSource:(l:Location,id?:string)=>void;onChange:(v:Partial<ViewState>)=>void;raw:(r:Relation)=>ReactNode}){
 const explanation=useMemo(()=>explainRelations(index,relations,{system:view.level==='main'&&view.exploration?.stage!=='chain',entryId:view.exploration?.entryId||view.entryId}),[index,relations,view.level,view.exploration?.stage,view.exploration?.entryId,view.entryId]);
 const details=useRef<HTMLDetailsElement>(null);
 const graph=graphFor(index,view),resourceLink=['main','guide'].includes(view.level)?graph.links.find(l=>l.relations.some(r=>relations.some(selected=>selected.id===r.id))&&graph.cards.some(c=>c.id===l.target&&c.resource)):undefined;
 const resource=resourceLink&&graph.cards.find(c=>c.id===resourceLink.target);
 const openSource=(s:ExplainedSource)=>onSource(s.location,s.kind==='definition'?relations.find(r=>s.relationIds.includes(r.id))?.to:relations.find(r=>s.relationIds.includes(r.id))?.from);
 const source=(s:ExplainedSource)=><button key={s.id} className="explanation-source" data-evidence-kind={s.kind} data-origin-ids={s.relationIds.join(',')} onClick={()=>openSource(s)}><span>{s.kind==='call'?'调用位置':s.kind==='config'?'配置位置':s.kind==='definition'?'目标定义':s.kind==='assignment'?'赋值位置':'目标来源'}</span><span>{['call','definition'].includes(s.kind)?s.note:describe(s.note)}</span><small title={s.location.file}>{s.location.file.split('/').at(-1)}:{s.location.range.start.line+1}</small></button>;
 const isolate=(path=false)=>{const graph=graphFor(index,{...view,reading:undefined}),link=graph.links.find(l=>l.relations.some(r=>relations.some(r2=>r2.id===r.id)));if(link)onChange({relationSelection:link.id,reading:{...view.reading,isolate:path?'path':'relation',origin:view.exploration?.entryId?index.entries?.find(e=>e.id===view.exploration?.entryId)?.symbolId:link.source,target:path?link.target:undefined}});};
 const task=(t:ExplanationTask)=><li key={t.id} className="explanation-task" data-relation-ids={t.relations.map(r=>r.id).join(',')}><div><strong>{t.label}</strong>{t.call&&<button className="task-code" onClick={()=>openSource(t.call!)}>代码</button>}</div>{t.relations.some(r=>r.http)&&<div className="task-routes">{[...new Set(t.relations.map(r=>r.http?`${r.http.method} ${r.http.path}`:r.target))].map(route=><span key={route}>{route}</span>)}</div>}{t.branches&&<small>按代码条件选择路径{t.exclusive?'，这些分支择一调用':''}</small>}{t.uncertain&&<small className="uncertain">目标还不能确定</small>}</li>;
 if(!relations.length)return <p>选择一条连接，查看代码与条件。</p>;
 if(resource)return <ResourceDetails card={resource} links={graph.links} index={index} onSource={onSource}/>;
 return <section className="relation-explanation"><h2>{explanation.title}</h2><p className="relation-conclusion">{describe(explanation.conclusion)}</p>
  <div className="explanation-actions"><button className="button" disabled={!explanation.primary.length} onClick={()=>openSource(explanation.primary[0])}>查看调用代码</button><button className="button" onClick={()=>{if(details.current)details.current.open=true;}}>详细来源</button>{explanation.ambiguous&&<button className="button" onClick={()=>{if(details.current)details.current.open=true;}}>查看可能目标</button>}</div>
  <ul className="explanation-tasks">{explanation.tasks.slice(0,3).map(task)}</ul>{explanation.tasks.length>3&&<details className="explanation-more"><summary>其余 {explanation.tasks.length-3} 个调用</summary><ul className="explanation-tasks">{explanation.tasks.slice(3).map(task)}</ul></details>}
  {explanation.notice&&<p className="detail-note">{explanation.notice}</p>}
  <details ref={details} className="explanation-more explanation-details"><summary>详细来源与原始记录</summary>
   {explanation.ambiguous&&<><h3>可能的目标</h3>{explanation.targets.map(t=><p key={t.id}>{t.name}<small className="detail-path"> · {t.id}</small></p>)}</>}
   <h3>调用与目标关联</h3>{explanation.primary.map(source)}{explanation.shared.map(source)}
   <h3>分支与调用前提</h3>{explanation.information.map((n,i)=><div className="explanation-information" key={i}><span>{({branch:'代码分支',precondition:'调用前提',configuration:'配置参照',analysis:'分析备注',uncertainty:'待核对'} as const)[n.kind]} · {n.text}</span>{n.code&&<code>{n.code}</code>}{n.location&&<button className="source-link" onClick={()=>onSource(n.location!)}>{n.location.file.split('/').at(-1)}:{n.location.range.start.line+1}</button>}</div>)}
   <div className="explanation-actions"><button className="button" onClick={()=>isolate()}>只看这条连接</button>{view.exploration?.stage==='chain'&&<button className="button" onClick={()=>isolate(true)}>只看这条业务链</button>}{view.reading?.isolate&&<button className="button" onClick={()=>onChange({reading:undefined,relationSelection:undefined})}>返回当前业务</button>}</div>
   <details><summary>分析详情 · {relations.length} 条原始关系</summary>{relations.map(raw)}</details>
  </details>
 </section>;
}
