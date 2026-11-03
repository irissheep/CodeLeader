import {useMemo,useState} from 'react';
import {ArrowUpRight,ChevronRight,Server} from 'lucide-react';
import type {EntryPoint,Location,ProjectIndex} from '../shared/model';
import type {GraphCard} from './graph-model';
import type {HierarchyModule} from './hierarchy-model';
import {sharedPrefix} from './hierarchy-model';
import {ModuleGroups,MethodBar} from './ModuleBlocks';
import {CardSurface,Row} from './Layout';
import {FrontendContent} from './BackboneContent';
import {UnitAddressExplanation} from './AnalysisNotes';
import tokens from '../shared/ui-tokens';
import BackendChoice from './BackendChoice';
import {frontendCounts} from './frontend-reading';
import {RuntimeEntry} from './RuntimeEntry';
const t=tokens.hierarchy;
export function HierarchyApplication({card,onModule,start=0}:{card:GraphCard;start?:number;onModule:(id:string)=>void}){
 const groups=card.hierarchy?.groups||[];
 return <><div className="hierarchy-application-heading service-heading"><Row leading={<Server/>} tail={<span>{card.stack}</span>}><strong title={card.name}>{card.name}</strong></Row><span>{groups.reduce((n,g)=>n+g.modules.length,0)} 个模块 · {card.unit?.interfaceCount||0} 个接口</span></div><ModuleGroups groups={groups} start={start} guideUnit={card.unit?.id} onSelect={m=>onModule(m.id)}/>{card.unit?.notice&&<p className="hierarchy-unit-note">{card.unit.notice}</p>}</>;
}
export function HierarchyFrontend({card,onExpand,onSource,onEntry,onTarget}:{card:GraphCard;onExpand:()=>void;onSource:(location:Location)=>void;onEntry:(entry:EntryPoint)=>void;onTarget?:(target?:import('../shared/frontend-links').FrontendTarget)=>void}){
 const front=card.frontend!,counts=frontendCounts(card);
 return <><div className="hierarchy-front-header"><button className="hierarchy-frontend-heading service-heading nodrag nopan" aria-label={`展开 ${card.name}`} aria-expanded={card.compact===false} onClick={e=>{e.stopPropagation();onExpand();}}><strong title={card.name}>{card.name}</strong></button><span className="hierarchy-stack" title={card.stack}>{card.stack?.split(' · ')[0]}</span></div><div className="hierarchy-front-total" data-copy-key="frontend-total"><strong>{counts.total}</strong><span>个接口调用</span></div><p className="hierarchy-front-pages" data-copy-key="frontend-match" title={`${front.pages.length} 个页面 · ${counts.unmatched?`对上 ${counts.matched}，${counts.unmatched} 个没对上`:counts.total?'全部对上':'没有接口调用'}`}>{front.pages.length} 个页面 · {counts.unmatched?`对上 ${counts.matched}，${counts.unmatched} 个没对上`:counts.total?'全部对上':'没有接口调用'}</p><RuntimeEntry card unitId={card.unit?.id}/>{card.compact===false?<><UnitAddressExplanation unitId={card.unit?.id}/><BackendChoice card={card} onChange={onTarget}/><FrontendContent card={card} onSource={onSource} onEntry={onEntry} onTarget={onTarget} summary={false}/></>:null}</>;
}
function requestPath(entry:EntryPoint){return entry.pathEvidence?.path||entry.name.split(' · ')[0].split(' ').slice(1).join(' ');}
export function HierarchyInterfaces({module,index,onEntry,onSource}:{module:HierarchyModule;index:ProjectIndex;onEntry:(entry:EntryPoint)=>void;onSource:(location:Location)=>void}){
 const [open,setOpen]=useState<string>();
 const rows=useMemo(()=>{
  const prefix=sharedPrefix(module.entries.map(requestPath));
  return module.entries.map(entry=>{
   const related=index.frontendLinks?.calls.filter(l=>['matched','path-only'].includes(l.outcome)&&l.targets.length===1&&l.targets.some(t=>t.entryId===entry.id))||[];
   const calls=index.frontend?.httpCalls.filter(c=>related.some(l=>l.callId===c.id))||[],pages=index.frontend?.pages.filter(p=>calls.some(c=>c.pageIds.includes(p.id)))||[];
   const symbol=index.symbols.find(s=>s.id===entry.symbolId),path=requestPath(entry),method=entry.pathEvidence?.method||entry.name.split(' ')[0];
   return{entry,path,relative:path.slice(prefix.length)||'/',method,calls,pages,description:symbol?.summary?.split('\n')[0]||symbol?.name||''};
  });
 },[module,index]);
 return <CardSurface className="hierarchy-interface-panel" aria-label="模块接口"><header><div><strong>{module.fullName}</strong><span>{module.count} 个接口</span></div><MethodBar methods={module.methods}/></header><div className="hierarchy-interface-list">{rows.map((row,i)=><div key={row.entry.id} className="hierarchy-interface-item" style={{'--module-enter-delay':i*t.rowEntryStep+tokens.viewMotion.rowOffset+'ms'} as React.CSSProperties}>
  <button className="hierarchy-interface-open" onClick={()=>onEntry(row.entry)}><span className="hierarchy-http-method" style={{color:(tokens.httpMethod as Record<string,string>)[row.method]||tokens.httpMethod.other}}>{row.method==='ANY'?'任意方法':row.method}</span><span className="hierarchy-interface-copy"><strong title={row.path}>{row.relative}</strong>{row.description&&<small title={row.description}>{row.description}</small>}</span></button>
  <button className="hierarchy-page-count" aria-label={`前端 ${row.calls.length} · ${row.path}`} disabled={!row.calls.length} aria-expanded={open===row.entry.id} onClick={()=>{if(row.pages.length===1){const page=row.pages[0],component=index.frontend?.modules.find(m=>page.componentModuleIds.includes(m.id));onSource(component?.location||page.location);}else setOpen(open===row.entry.id?undefined:row.entry.id);}}>前端 {row.calls.length}</button>
  {open===row.entry.id&&<div className="hierarchy-page-choices">{row.pages.length?row.pages.map(p=><button key={p.id} onClick={()=>{const component=index.frontend?.modules.find(m=>p.componentModuleIds.includes(m.id));onSource(component?.location||p.location);}}>{p.paths.join(' / ')||p.name}<ArrowUpRight size={12}/></button>):<><span>页面还没对上</span>{row.calls.map(c=><button key={c.id} onClick={()=>onSource(c.location)}>查看调用 <ChevronRight size={12}/></button>)}</>}</div>}
 </div>)}</div></CardSurface>;
}
