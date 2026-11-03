import {useMemo,useState} from 'react';
import {ArrowUpRight,ChevronRight,Server} from 'lucide-react';
import type {EntryPoint,Location,ProjectIndex} from '../shared/model';
import type {GraphCard} from './graph-model';
import type {HierarchyModule} from './hierarchy-model';
import {explorationColumnWidth} from './hierarchy-model';
import {ModuleGroups,MethodBar} from './ModuleBlocks';
import {CardSurface,Row} from './Layout';
import {FrontendContent} from './BackboneContent';
import {UnitAddressExplanation} from './AnalysisNotes';
import tokens from '../shared/ui-tokens';
import BackendChoice from './BackendChoice';
import {frontendCounts} from './frontend-reading';
import {RuntimeEntry} from './RuntimeEntry';
import EntryList from './EntryList';
const t=tokens.hierarchy;
export function HierarchyApplication({card,onModule,onEntry,onMore,onCollapse,start=0}:{card:GraphCard;start?:number;onModule:(id:string)=>void;onEntry:(entry:EntryPoint,target?:string)=>void;onMore:(entry:EntryPoint)=>void;onCollapse:()=>void}){
 const groups=card.hierarchy?.groups||[];
 const count=groups.reduce((n,g)=>n+g.modules.length,0),width=explorationColumnWidth(count,card.inline?.stage,card.canvasSize?.width);
 const panel=card.inline&&<section className="inline-interfaces nodrag nopan" data-domain-id={card.inline.domainId} data-stage={card.inline.stage} data-selected-entry={card.inline.entryId}><div className="inline-heading"><strong>{card.inline.name} 接口</strong><button onClick={onCollapse}>收起</button></div><EntryList selectedId={card.inline.entryId} entries={card.inline.entries} outcomes={card.destinations||{}} onEntry={onEntry} onMore={onMore}/></section>;
 return <><div className="hierarchy-application-heading service-heading"><Row leading={<Server/>} tail={<span>{card.stack}</span>}><strong title={card.name}>{card.name}</strong></Row><span>{count} 个模块 · {card.unit?.interfaceCount||0} 个接口</span></div><div className="hierarchy-exploration-content" style={card.inline?.stage==='chain'?{maxWidth:width}:undefined}><ModuleGroups groups={groups} selected={card.inline?.domainId} panel={panel} rowWidth={width} start={start} guideUnit={card.unit?.id} onSelect={m=>onModule(m.id)}/></div></>;
}
export function HierarchyFrontend({card,onExpand,onSource,onEntry,onTarget}:{card:GraphCard;onExpand:()=>void;onSource:(location:Location)=>void;onEntry:(entry:EntryPoint)=>void;onTarget?:(target?:import('../shared/frontend-links').FrontendTarget)=>void}){
 const front=card.frontend!,counts=frontendCounts(card);
 return <><div className="hierarchy-front-header"><button className="hierarchy-frontend-heading service-heading nodrag nopan" aria-label={`展开 ${card.name}`} aria-expanded={card.compact===false} onClick={e=>{e.stopPropagation();onExpand();}}><strong title={card.name}>{card.name}</strong></button><span className="hierarchy-stack" title={card.stack}>{card.stack?.split(' · ')[0]}</span></div><div className="hierarchy-front-total" data-copy-key="frontend-total"><strong>{counts.total}</strong><span>个接口调用</span></div><p className="hierarchy-front-pages" data-copy-key="frontend-match" title={`${front.pages.length} 个页面 · ${counts.unmatched?`对上 ${counts.matched}，${counts.unmatched} 个没对上`:counts.total?'全部对上':'没有接口调用'}`}>{front.pages.length} 个页面 · {counts.unmatched?`对上 ${counts.matched}，${counts.unmatched} 个没对上`:counts.total?'全部对上':'没有接口调用'}</p><RuntimeEntry card unitId={card.unit?.id}/>{card.compact===false?<><UnitAddressExplanation unitId={card.unit?.id}/><BackendChoice card={card} onChange={onTarget}/><FrontendContent card={card} onSource={onSource} onEntry={onEntry} onTarget={onTarget} summary={false}/></>:null}</>;
}
function requestPath(entry:EntryPoint){return entry.pathEvidence?.path||entry.name.split(' · ')[0].split(' ').slice(1).join(' ');}
export function HierarchyInterfaces({module,index,onEntry,onSource,onInspect,selectedId}:{module:HierarchyModule;index:ProjectIndex;onEntry:(entry:EntryPoint)=>void;onSource:(location:Location)=>void;onInspect:(entry:EntryPoint)=>void;selectedId?:string}){
 const [open,setOpen]=useState<string>();
 const rows=useMemo(()=>{
  return module.entries.map(entry=>{
   const related=index.frontendLinks?.calls.filter(l=>['matched','path-only'].includes(l.outcome)&&l.targets.length===1&&l.targets.some(t=>t.entryId===entry.id))||[];
   const calls=index.frontend?.httpCalls.filter(c=>related.some(l=>l.callId===c.id))||[],pages=index.frontend?.pages.filter(p=>calls.some(c=>c.pageIds.includes(p.id)))||[];
   const symbol=index.symbols.find(s=>s.id===entry.symbolId),path=requestPath(entry),method=entry.pathEvidence?.method||entry.name.split(' ')[0];
   const services=index.relations.filter(r=>r.type==='HTTP'&&!!entry.symbolId&&r.to===entry.symbolId&&(r.status==='resolved'||r.rule?.outcome==='unique')).flatMap(r=>{const caller=index.symbols.find(s=>s.id===r.from),service=index.entities?.find(e=>e.kind==='service'&&e.id===caller?.serviceId),location=r.locations[0]||r.rule?.basis[0]?.location;return service&&location?[{id:r.id,name:index.units?.find(u=>u.serviceId===service.id)?.root||service.name,location}]:[];});
   return{entry,path,method,calls,pages,services,description:symbol?.summary?.split('\n')[0]||symbol?.name||''};
  });
 },[module,index]);
 return <CardSurface className="hierarchy-interface-panel" aria-label="模块接口"><header><div><strong>{module.fullName}</strong><span>{module.count} 个接口</span></div><MethodBar methods={module.methods}/></header><div className="hierarchy-interface-list">{rows.map((row,i)=><div key={row.entry.id} className="hierarchy-interface-item" style={{'--module-enter-delay':i*t.rowEntryStep+tokens.viewMotion.rowOffset+'ms'} as React.CSSProperties}>
  <button className="hierarchy-interface-open" aria-current={selectedId===row.entry.id?'true':undefined} onClick={()=>onEntry(row.entry)}><span className="hierarchy-http-method" style={{color:(tokens.httpMethod as Record<string,string>)[row.method]||tokens.httpMethod.other}}>{row.method==='ANY'?'任意方法':row.method}</span><span className="hierarchy-interface-copy"><strong title={row.path}>{row.path}</strong>{row.description&&<small title={row.description}>{row.description}</small>}</span></button>
  <button className="hierarchy-page-count" aria-label={`查看 ${row.method} ${row.path} 的详情`} onClick={()=>onInspect(row.entry)}>详情</button>
  {(row.calls.length>0||row.services.length>0)&&<button className="hierarchy-page-count" aria-label={`调用方 · ${row.path}`} aria-expanded={open===row.entry.id} onClick={()=>setOpen(open===row.entry.id?undefined:row.entry.id)}>{[row.calls.length?`页面调用 ${row.calls.length} 处`:'',row.services.length?`服务调用 ${row.services.length} 处`:''].filter(Boolean).join(' · ')}</button>}
  {open===row.entry.id&&<div className="hierarchy-page-choices">{row.pages.map(p=><button key={p.id} onClick={()=>{const component=index.frontend?.modules.find(m=>p.componentModuleIds.includes(m.id));onSource(component?.location||p.location);}}>{p.paths.join(' / ')||p.name}<ArrowUpRight size={12}/></button>)}{!row.pages.length&&row.calls.map(c=><button key={c.id} onClick={()=>onSource(c.location)}>查看页面调用 <ChevronRight size={12}/></button>)}{row.services.map(service=><button key={service.id} onClick={()=>onSource(service.location)}>{service.name}<ArrowUpRight size={12}/></button>)}</div>}
 </div>)}</div></CardSurface>;
}
