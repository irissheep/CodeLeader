import type {ReactNode} from 'react';
import type {ProjectIndex,Relation,Location,ViewState} from '../shared/model';
import FrontendLinkDetails from './FrontendLinkDetails';
import {EvidenceLinks,useAnalysisNotes} from './AnalysisNotes';
import {describe} from './ui-wording';
import {viewIssues} from './view-issues';
export function unidentifiedCalls(index:ProjectIndex){const found=new Map<string,Relation>();for(const relation of index.relations)if(relation.type==='CALLS'&&relation.status==='unresolved')for(const location of relation.locations){const key=location.file+':'+JSON.stringify(location.range);if(!found.has(key))found.set(key,relation);}return [...found.values()];}
export default function AnalysisDetails({index,view,renderRelation,onSource}:{index:ProjectIndex;view:ViewState;renderRelation:(r:Relation)=>ReactNode;onSource:(location:Location)=>void}){
 const {notes,failed}=useAnalysisNotes(),stats=index.analysis,unknown=unidentifiedCalls(index),issues=viewIssues(index,view);
 return <><h2>{index.status==='partial'?'部分分析':'分析范围'}</h2>
  {!!issues.items.length&&<section data-view-issue-list={issues.items.length}><h3>{issues.items.length} {issues.label}</h3>{issues.items.map(item=><div className="relation-row" data-view-issue-item key={item.id}><strong>{item.title}</strong><p>{item.reason}</p><button className="source-link" onClick={()=>onSource(item.location)}>{item.location.file}:{item.location.range.start.line+1}</button></div>)}</section>}
  {index.status==='partial'&&<div data-partial-explanation>{notes?.partial.map(item=><section className="analysis-explanation" key={item.id} data-explanation-category={item.id}><strong>{item.text}</strong><p>{item.impact}</p><EvidenceLinks items={item.evidence.slice(0,2)}/></section>)||<p>{failed?'没能读出具体说明，请重新分析后再试。':'正在读取说明…'}</p>}</div>}
  {notes?.addresses.map(note=><details key={note.unitId} data-address-details={note.unitId}><summary>{note.count} 处地址没有确定</summary>{note.calls.map(call=><div className="relation-row" key={call.id}><strong>{call.method} {call.address}</strong><button className="source-link" onClick={()=>onSource(call.location)}>{call.location.file}:{call.location.range.start.line+1}</button>{call.variables.map(variable=><p key={variable.name}>{variable.name}：{variable.text}<EvidenceLinks items={variable.evidence}/></p>)}{!call.variables.length&&<p>地址包含运行时才能确定的内容。</p>}</div>)}</details>)}
  <details><summary>文件与调用范围</summary>
   <p>Java / Python 文件与方法调用计数；前端另列 {index.frontendFiles?.length||0} 个文件。</p>
   {stats&&<><dl className="analysis-counts">{[['扫描源码文件',stats.scanned],['读出结构的文件',stats.parsed],['未读完整的文件',stats.partialFiles],['调用位置',stats.callPositions],['已找到项目内目标',stats.semanticInternal],['按框架约定找到的目标',stats.ruleUnique],['已识别项目外目标',stats.external],['没有可打开的方法',stats.implicit],['仍有多个可能目标',stats.candidate],['还没找到目标',stats.unknown]].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl><p>已识别的项目外调用 {stats.external} / {stats.callPositions} 处{stats.callPositions?`（${(100*stats.external/stats.callPositions).toFixed(1)}%）`:''}。这些方法通常没有本项目内的源码定义；是否影响业务需要结合具体调用判断。</p><p className="detail-note">同一调用位置只计一次。导入、类型关系和数据库卡片不算调用；方法之外的 {stats.excludedInitializations} 处调用另计。读出文件不代表已找到其中的全部调用。</p></>}
  </details>
  <details><summary>前端接口与后端</summary><FrontendLinkDetails index={index} onSource={onSource}/></details>
  <details><summary>读取设置</summary><p>{describe(index.configurations?.find(c=>c.id===index.configurationId)?.name||'默认设置')}</p><p>额外查看 {index.inputs?.length||0} 个设置文件，只读文件内容，没有执行其中的命令。</p></details>
  <details><summary>未读完整的地方 · {index.diagnostics.length}</summary>{index.diagnostics.map((d,i)=><p className="diagnostic" key={i}>{d.file&&`${d.file} · `}{d.message}</p>)}</details>
  <details><summary>未找到目标的调用 · {unknown.length}</summary>{unknown.map(renderRelation)}</details>
 </>;
}
