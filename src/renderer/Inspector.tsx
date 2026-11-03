import { useRef } from 'react';
import { X, Code2, ArrowUpRight, ChevronRight } from 'lucide-react';
import Source from './Source';
import EntityDetails from './EntityDetails';
import AnalysisDetails from './AnalysisDetails';
import RelationReader from './RelationReader';
import EntryList from './EntryList';
import RelationExplanation from './RelationExplanation';
import { entryOutcome } from './reading-model';
import {httpRouteLabel} from '../shared/http-method';
import { boundaries, entryGroups, isCallable, isTestFile, symbolCategory } from './entry-model';
import { graphFor, relationNames } from './graph-model';
import {withFrontendTargets} from '../shared/frontend-targets';
import ResourceDetails from './ResourceDetails';
import FrontendPageDetails from './FrontendPageDetails';
import {describe,wording} from './ui-wording';
import type { EntryPoint, Location, ProjectIndex, Relation, ViewState } from '../shared/model';
type Props={index:ProjectIndex;view:ViewState;maxWidth:number;onChange:(v:Partial<ViewState>)=>void;onNavigate:(v:Partial<ViewState>)=>void;onSource:(l:Location,id?:string)=>void;onEntry:(e:EntryPoint,target?:string)=>void;onLocate:(id:string)=>void;onClose:()=>void};
export default function Inspector({index,view,maxWidth,onChange,onNavigate,onSource,onEntry,onLocate,onClose}:Props){
  index=withFrontendTargets(index,view.frontendTargets);
  const drag=useRef<{x:number;width:number}|null>(null),width=Math.min(view.panelWidth||420,maxWidth);
  const symbol=index.symbols.find(s=>s.id===(view.selected||view.focus));
  const entity=index.entities?.find(e=>e.id===(view.selected||view.focus));
  const file=view.selected?.startsWith('file:')?view.selected.slice(5):view.level==='file'?view.focus:symbol?.file;
  const module=view.selected?.startsWith('module:')?view.selected.slice(7):view.level==='module'?view.focus:symbol?.module;
  const group=entryGroups(index,view.filter,view.showTests).find(g=>g.id===view.selected);
  const graph=graphFor(index,view),visible=new Set(graph.cards.map(c=>c.id));
  const folded=graph.cards.find(c=>c.id===view.selected&&c.kind==='group');
  const related=folded?index.symbols.filter(s=>folded.members?.includes(s.id)):symbol?(isCallable(symbol)?[]:index.symbols.filter(s=>s.parent===symbol.id)):file?index.symbols.filter(s=>s.file===file):index.symbols.filter(s=>s.module===module);
  const selectedRelations=[...new Map([...index.relations,...graph.links.flatMap(l=>l.relations),...graph.dependencyRelations||[]].map(r=>[r.id,r])).values()].filter(r=>view.relationIds?.includes(r.id));
  const resourceCard=graph.cards.find(c=>c.id===(view.selected||view.focus)&&(c.resource||c.entity?.kind==='resource'));
  const frontendModule=index.frontend?.modules.find(m=>m.id===(view.selected||view.focus));
  const readingBoundaries=symbol&&isCallable(symbol)?boundaries(index,symbol,visible):[];
  const hiddenRelations=readingBoundaries.filter(b=>['folded','candidate'].includes(b.kind)).flatMap(b=>b.relations).filter(r=>r.to&&!visible.has(r.to));
  const hiddenTargets=[...new Set(hiddenRelations.map(r=>r.to!))],uncertainTargets=new Set(hiddenRelations.filter(r=>r.status==='candidate').map(r=>r.to));
  const origin=index.entries?.find(e=>e.id===view.entryId);
  const source=()=>{if(symbol)onSource({file:symbol.file,range:symbol.selection},symbol.id);else if(file)onSource({file,range:{start:{line:0,character:0},end:{line:0,character:0}}},`file:${file}`);};
  return <aside className="inspector" style={{width}} aria-label="检查面板">
    <div className="inspector-resize" role="separator" tabIndex={0} aria-label="调整检查面板宽度" aria-orientation="vertical" onPointerDown={e=>{drag.current={x:e.clientX,width};e.currentTarget.setPointerCapture(e.pointerId);}} onPointerMove={e=>{if(drag.current)onChange({panelWidth:Math.max(300,Math.min(maxWidth,drag.current.width+drag.current.x-e.clientX))});}} onPointerUp={()=>drag.current=null} onPointerCancel={()=>drag.current=null} onKeyDown={e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();onChange({panelWidth:Math.max(300,Math.min(maxWidth,width+(e.key==='ArrowLeft'?20:-20)))});}}}/>
    <div className="inspector-tabs" role="tablist">{(['details','source','relations'] as const).map(tab=><button key={tab} role="tab" aria-selected={view.inspector===tab} disabled={tab==='source'&&!view.source} onClick={()=>onChange({inspector:tab})}>{tab==='details'?'详情':tab==='source'?'源码':'来源'}</button>)}{view.inspector==='analysis'&&<span>分析范围</span>}<button className="inspector-close" title="关闭检查面板" onClick={onClose}><X size={17}/></button></div>
    {origin&&<div className="inspector-origin">探索起点 · {origin.name}</div>}
    {view.inspector==='source'&&view.source?<Source location={view.source} index={index} embedded onNavigate={onLocate} onClose={onClose}/>:<div className="inspector-content">
      {view.inspector==='details'&&(resourceCard?<ResourceDetails card={resourceCard} links={graph.links} index={index} onSource={onSource}/>:frontendModule?<FrontendPageDetails index={index} moduleId={frontendModule.id} onSource={onSource}/>:entity?<EntityDetails entity={entity} index={index} onEntry={onEntry} onSource={onSource} onChange={onChange} onNavigate={onNavigate}/>:group?<>
        <div className="detail-eyebrow">{group.area}</div><h2>{graph.cards.find(c=>c.id===group.id)?.name||group.name}</h2>
        <EntryList full selectedId={view.exploration?.entryId} entries={group.entries} outcomes={Object.fromEntries(group.entries.map(e=>[e.id,entryOutcome(index,e)]))} onEntry={onEntry}/>
        <details><summary>{wording('source')}</summary>{[...new Set(group.entries.map(e=>[e.basis,e.reason].filter(Boolean).join(' · ')))].map(text=><p key={text}>{describe(text)}</p>)}</details>
      </>:<>
        <div className="detail-eyebrow">{folded?'收起的方法':symbol?symbolCategory(index,symbol):file?'文件':'代码模块'}</div><h2>{symbol?(isCallable(symbol)&&index.symbols.find(s=>s.id===symbol.parent)?index.symbols.find(s=>s.id===symbol.parent)!.name+'.'+symbol.name:symbol.name):folded?.name||file?.split('/').at(-1)||module||'选择图中内容'}</h2>
        {symbol?.signature?<details><summary>参数与返回类型</summary><p className="detail-path">{symbol.signature}</p></details>:<p className="detail-path">{file||module}</p>}
        {(symbol||file)&&<button className="button" onClick={source}><Code2 size={14}/>查看源码</button>}
        {folded&&<><p className="detail-note">聚合了 {folded.members?.length} 个{folded.id.startsWith('cycle:')?'模块，形成强连通分量':'代码项'}；原始方向、关系类型和调用位置仍保留。</p>{folded.members?.filter(id=>id.startsWith('module:')).map(id=><p key={id}>{id.slice(7)}</p>)}<button className="button" onClick={()=>onChange({expanded:[...new Set([...view.expanded,...folded.members!])]})}>展开这些内容</button>{!!folded.innerRelations?.length&&<button className="boundary-row" onClick={()=>onChange({inspector:'relations',relationIds:folded.innerRelations})}>查看 {folded.innerRelations.length} 条组内关系</button>}</>}
        {symbol?.routes.map(route=><div className="detail-route" key={route}>{httpRouteLabel(route)}</div>)}
        {symbol?.summary&&<p>{symbol.summary}</p>}
        {symbol&&!isCallable(symbol)&&<button className="button" onClick={()=>onNavigate({level:'class',focus:symbol.id,relationFilter:'types'})}>检查继承 / 实现关系</button>}
        {symbol&&isCallable(symbol)&&<>
          <section data-summary-kind="method" data-hidden-total={hiddenTargets.length}>
          {hiddenTargets.length>0&&<><p>{wording('hiddenMethods',{count:hiddenTargets.length})}{uncertainTargets.size>0&&wording('uncertainMethods',{count:uncertainTargets.size})}</p><button className="button" onClick={()=>{const expanded=[...new Set([...view.expanded,symbol.id,...hiddenTargets])];if(view.level!=='function'&&!view.exploration)onNavigate({level:'function',focus:symbol.id,expanded,selected:symbol.id,inspector:'details'});else onChange({expanded});}}>{wording('expand')}</button><details><summary>方法名单</summary>{hiddenTargets.map(id=>{const target=index.symbols.find(s=>s.id===id)!,owner=index.symbols.find(s=>s.id===target.parent);return <button className="member-link" key={id} data-hidden-target={id} onClick={()=>onLocate(id)}>{owner?owner.name+'.':''}{target.name}</button>;})}</details></>}
          {readingBoundaries.filter(b=>!['folded','candidate'].includes(b.kind)).map(boundary=><button className={`boundary-row ${boundary.kind}`} key={boundary.kind} disabled={!boundary.relations.length} onClick={()=>onChange({inspector:'relations',relationIds:boundary.relations.map(r=>r.id)})}>{describe(boundary.label)}{!!boundary.relations.length&&<ArrowUpRight size={14}/>}</button>)}
          </section>{index.status!=='complete'&&<p className="detail-note">{wording('unfinished')}</p>}
          <button className="button" onClick={()=>onLocate(symbol.id)}>以此方法继续追踪</button>
        </>}
        {symbol&&!isCallable(symbol)&&<p className="detail-note">{isTestFile(symbol.file,index)?'测试内容按源码路径归类，不占用默认生产入口主干。':symbol.kind==='interface'?'接口本身不是一次函数调用；继承与实现关系见下方。':'这是类型定义，可以查看它的成员和使用位置。'}</p>}
        {related.length>0&&<><h3>{file&&!symbol?'文件内定义':'成员'} · {related.length}</h3>{related.map(s=><button key={s.id} className="member-link" onClick={()=>onLocate(s.id)}><span><strong>{s.name}</strong><small>{symbolCategory(index,s)} · {s.file}:{s.selection.start.line+1}</small></span><ChevronRight size={14}/></button>)}</>}
        {symbol&&index.relations.filter(r=>['EXTENDS','IMPLEMENTS','INJECTS'].includes(r.type)&&(r.from===symbol.id||r.to===symbol.id)).map(r=><RelationRow key={r.id} relation={r} index={index} onSource={onSource}/>)}
        {!symbol&&!related.length&&<p className="detail-note">当前未识别到可展示关系；可从文件或源码继续阅读。</p>}
      </>)}
      {view.inspector==='connections'&&<RelationReader index={index} view={view} onChange={onChange}/>}
      {view.inspector==='relations'&&<RelationExplanation index={index} view={view} relations={selectedRelations} onSource={onSource} onChange={onChange} raw={r=><RelationRow key={r.id} relation={r} index={index} onSource={onSource}/>}/>}
      {view.inspector==='analysis'&&<AnalysisDetails index={index} view={view} onSource={onSource} renderRelation={r=><RelationRow key={r.id} relation={r} index={index} onSource={onSource}/>}/>}
    </div>}
  </aside>;
}
export function RelationRow({relation:r,index,onSource}:{relation:Relation;index?:ProjectIndex;onSource:(l:Location,id?:string)=>void}){
 const target=index?.symbols.find(s=>s.id===r.to)||index?.symbols.find(s=>['class','interface'].includes(s.kind)&&(r.target.startsWith(s.qualifiedName+'.')||r.target.startsWith(s.qualifiedName+'('))),basis=r.rule?.basis||[];
 return <div className="relation-row" data-relation-id={r.id} data-relation-type={r.type}><div><span className={`relation-kind kind-${r.type}`}>{relationNames[r.type]}</span><span className={`resolution ${r.status}`}>{r.rule?r.rule.outcome==='unique'?'规则唯一':r.rule.outcome==='candidate'?'还不能确定':'待确认':r.status==='resolved'?'语义定位':r.status==='candidate'?'还不能确定':'待确认'}</span>{r.invocation&&<span className="invocation-kind">{r.invocation==='async'?'异步':r.invocation==='scheduled'?'后台调度':'同步'}</span>}</div>
  <strong title={r.target}>{r.http?`${r.http.method} ${r.http.path}`:r.target}</strong>{r.http?.baseUrl&&<p>请求地址：{r.http.baseUrl}</p>}{r.reason&&<p>{describe(r.reason)}</p>}
  {r.rule&&<><small>{r.rule.id} / v{r.rule.version}</small>{r.rule.conditions.map(c=><p className="condition-note" key={c}>{c}</p>)}{r.rule.applicability==='excluded'&&<p className="condition-note">当前静态配置参照下折叠此分支；运行环境未确认。</p>}</>}
  {r.data?.sql&&<pre className="sql-evidence">{r.data.sql}</pre>}
  {r.rule?.alternatives&&r.rule.alternatives.length>1&&<details><summary>赋值 / 条件分支 · {r.rule.alternatives.length}</summary>{r.rule.alternatives.map((a,i)=><div key={i}><p>可能的分支 {i+1}</p>{a.conditions.map(c=><p className="condition-note" key={c}>{c}</p>)}</div>)}</details>}
  {r.locations.map((l,i)=><button key={'call'+i} className="source-link" data-evidence-kind="call" onClick={()=>onSource(l,r.from)}><Code2 size={12}/>{l.file}:{l.range.start.line+1}<ArrowUpRight size={12}/></button>)}
  {basis.map((b,i)=><button key={i} className="source-link evidence-link" data-evidence-kind={b.kind} onClick={()=>onSource(b.location,b.kind==='definition'?r.to:r.from)}><span>{['call','definition'].includes(b.kind)?b.note:describe(b.note)}</span><small>{b.location.file}:{b.location.range.start.line+1}</small></button>)}
  {target&&!basis.some(b=>b.kind==='definition'&&b.location.file===target.file)&&<button className="source-link" data-evidence-kind="definition" onClick={()=>onSource({file:target.file,range:target.selection},target.id)}>目标定义 · {target.file}:{target.selection.start.line+1}</button>}
 </div>;
}
