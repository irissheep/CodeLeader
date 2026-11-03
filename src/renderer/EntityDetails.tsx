import type { Entity, EntryPoint, Location, ProjectIndex, ViewState } from '../shared/model';
import {selectReadingStarts} from './reading-starts';
import { ChevronRight } from 'lucide-react';
import {httpRouteLabel} from '../shared/http-method';
import {describe} from './ui-wording';
import tokens from '../shared/ui-tokens';
type Props={entity:Entity;index:ProjectIndex;onEntry:(e:EntryPoint)=>void;onSource:(l:Location,id?:string)=>void;onChange:(v:Partial<ViewState>)=>void;onNavigate:(v:Partial<ViewState>)=>void};
export default function EntityDetails({entity,index,onEntry,onSource,onChange,onNavigate}:Props){
 const entries=(index.entries||[]).filter(e=>entity.entryIds?.includes(e.id)||entity.kind==='service'&&index.symbols.find(s=>s.id===e.symbolId)?.serviceId===entity.id);
 const ranks=selectReadingStarts(index,entries,tokens.orientation.recommendedLimit),children=index.entities?.filter(e=>e.parentId===entity.id)||[];
 const related=index.relations.filter(r=>r.to===entity.id||children.some(e=>e.id===r.to));
 return <><div className="detail-eyebrow">{entity.kind==='service'?'部署 / 应用边界':entity.kind==='domain'?'接口能力分组':'数据 / 外部资源'}</div><h2>{entity.name}</h2><p>{entity.summary}</p>
  <p className="detail-note">当前查看 {describe(index.configurations?.find(c=>c.id===index.configurationId)?.name||'项目设置')}。</p>
  {entity.discoveredOnly&&<p className="detail-note">只在配置里出现，还没找到读写位置。</p>}
  {entity.conditions?.map(c=><p className="condition-note" key={c}>{c}</p>)}
  {ranks.length>0&&<><h3>从这里开始</h3>{ranks.map(r=><button className="entry-choice" data-entry-id={r.entry.id} key={r.entry.id} onClick={()=>onEntry(r.entry)}><strong>{httpRouteLabel(r.entry.name)}</strong><small>前端调用 {r.calls} 次{r.tables.length?` · ${r.uncertain?'可能':''}${r.readOnly?'查':'访问'} ${r.tables[0]} 表`:r.databases.length?` · ${r.uncertain?'可能':''}访问 ${r.databases[0]}`:` · 找到 ${r.methods} 个方法`} · 看完整流程</small><ChevronRight size={15}/></button>)}</>}
  {entries.length>0&&<><button className="button" onClick={()=>onNavigate({level:'guide',focus:entity.id})}>打开接口分支</button><details open={entity.kind==='domain'}><summary>完整入口列表 · {entries.length}</summary>{entries.map(e=><button key={e.id} className="entry-choice" data-entry-id={e.id} onClick={()=>onEntry(e)}><strong>{httpRouteLabel(e.name)}</strong><small>{e.location.file}:{e.location.range.start.line+1}</small></button>)}</details></>}
  {children.length>0&&<><h3>有访问来源的数据表</h3>{children.map(child=><button className="member-link" key={child.id} onClick={()=>onChange({selected:child.id})}>{child.name}<ChevronRight size={14}/></button>)}</>}
  {entity.parentId&&<button className="button" onClick={()=>onChange({selected:entity.parentId})}>返回数据资源</button>}
  {related.length>0&&<button className="boundary-row" onClick={()=>onChange({inspector:'relations',relationIds:related.map(r=>r.id)})}>查看 {related.length} 条访问关系与条件</button>}
  <details><summary>来源</summary>{[...new Map(entity.basis.map(b=>[JSON.stringify([b.location,b.note]),b])).values()].map((b,i)=><button key={i} className="source-link evidence-link" onClick={()=>onSource(b.location)}><span>{['call','definition'].includes(b.kind)?b.note:describe(b.note)}</span><small>{b.location.file}:{b.location.range.start.line+1}</small></button>)}</details>
  {entity.kind==='service'&&<details><summary>仅配置发现 / 条件资源</summary>{index.entities?.filter(e=>e.kind==='resource'&&(e.discoveredOnly||e.conditions?.length)).map(e=><button key={e.id} className="member-link" onClick={()=>onChange({selected:e.id})}>{e.name}</button>)}</details>}
 </>;
}
