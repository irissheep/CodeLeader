import uiTokens from '../shared/ui-tokens';
import { Fragment, memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import {createPortal} from 'react-dom';
import { ReactFlow, applyNodeChanges,  Handle, Position, BaseEdge, EdgeLabelRenderer, MarkerType, useReactFlow, useStoreApi, ReactFlowProvider, ViewportPortal, useUpdateNodeInternals, getSmoothStepPath, type NodeProps, type EdgeProps, type Node, type Edge } from '@xyflow/react';
import { Box, Code2, ArrowUpRight, Expand, Plus, Minus, Maximize, Layers, Crosshair, RotateCcw, FileCode2, Route, Play, Braces, ChevronRight, Server, Database, Search, Globe, Sparkles, Check } from 'lucide-react';
import { graphFor, type GraphCard, type GraphLink,type GraphResult } from './graph-model';
import { cardSize, roundedPath, nearestEdges, type LayoutSnapshot, type Port, type Point } from './graph-geometry';
import {runtimeEnvelopes,runtimeLayout} from './runtime-layout';
import { symbolView } from './entry-model';
import {httpMethodLabel,httpRouteLabel} from '../shared/http-method';
import { recommendations, readingPath } from './flow-model';
import EntryList from './EntryList';
import type {ExecutionLayer} from './execution-layer';
import {useRuntimeFit} from './useRuntimeFit';
import {useSmoothWheel} from './useSmoothWheel';
import {useCanvasOverlays} from './useCanvasOverlays';
import {useGraphMotion} from './useGraphMotion';
import {usePacketMotion,readingStage} from './usePacketMotion';
import {motionMs,motionPolicy} from './ui-motion';
import {graphCommit} from './graph-diagnostics';
import {methodRows,methodRowTitle} from './method-list';
import DependencyScope from './DependencyScope';
import dependencyPolicy from '../shared/dependency-policy.json';
import './dependency.css';
import './backbone.css';
import {FrontendContent} from './BackboneContent';
import {visibleCapabilities} from './backbone-model';
import backbonePolicy from '../shared/backbone-policy.json';
import {adaptiveViewport,appearancePolicy,cardRole,graphDensity,look,presentGraph} from './adaptive-look';
import {useSemanticZoom} from './useSemanticZoom';
import {RoleIcon} from './CardAppearance';
import {Row,CardSurface} from './Layout';
import GraphAbsence from './GraphAbsence';
import {presentHierarchy,hierarchyViewport} from './hierarchy-model';
import {ModuleBlock,ModuleTooltipProvider} from './ModuleBlocks';
import {HierarchyApplication,HierarchyFrontend,HierarchyInterfaces} from './HierarchyContent';
import {FrontendBand,HierarchyHoverBand,useHierarchyHover} from './hierarchy-band';
import {presentDependencyLanes,laneMainLinks,laneNames,primaryKind,type LaneOrientation} from './dependency-lanes';
import {DependencyLaneCard,DependencyLaneEdge,useDependencyLaneFocus,laneEdgeStyle} from './DependencyLanes';
import {useAnalysisNotes,UnitAddressExplanation} from './AnalysisNotes';
import {browserNodeId,projectExecution,runtimeGraph,executionDomains,executionStepName,executionCallLabel,type ExecutionProjection} from './execution-projection';
import {callVisibility} from '../runtime/replay';
import {rowProgress} from './call-reading';
import {singlePage,frontendCounts} from './frontend-reading';
import SinglePageState from './SinglePageState';
import {wording,wordingTable} from './ui-wording';
import {GuideMark} from './Orientation';
import type { ProjectIndex, ViewState, Location, SymbolInfo, EntryPoint } from '../shared/model';
import '@xyflow/react/dist/style.css';
type CardData=GraphCard & Record<string,unknown> & {hierarchySelected?:string;hierarchyStart?:number;dependencyEnterOrder?:number;selectModule?:(id:string)=>void;visualRole?:import('./adaptive-look').CardRole;source:(location:Location)=>void;runtime?:ExecutionLayer;projection?:ExecutionProjection;inspectRuntime?:()=>void;ports:Port[];selected:boolean;related:boolean;expanded:boolean;selectedCapability?:string;focusAction:()=>void;expand:()=>void;collapse:()=>void;openEntry:(e:EntryPoint,target?:string)=>void;entryDetails:(e:EntryPoint)=>void;capability:(id:string,open?:boolean)=>void;pick:(s:SymbolInfo,focus?:boolean)=>void;evidence:(ids:string[])=>void;reveal:(ids:string[])=>void};
function PositionBadge({runtime}:{runtime?:ExecutionLayer}){
  const state=runtime?.state;if(!state)return <i className="runtime-position" aria-label="当前位置"/>;
  const number=state.model.positions[state.cursor]+1,step=state.model.steps[number-1],call=state.model.byCall[step.callId];
  return <span className={`runtime-step-bubble ${step.exception?'has-error':''}`} data-current-step={number}><i className="runtime-position" aria-hidden="true"/>第 {number} 步 · {executionStepName(call,step.phase)}</span>;
}
function MethodLabel({text}:{text:string}){
  const parts=text.split('.'),name=parts.length>2?parts.slice(-2).join('.'):text;
  return <strong title={text}>{name}</strong>;
}
function RuntimeExpansion({data}:{data:CardData}){
  const area=useRef<HTMLDivElement>(null),state=data.runtime?.state,expansion=data.runtimeExpansion;
  const rows=useMemo(()=>state&&expansion?methodRows(state.model,expansion.calls,state.display):[],[state?.model,expansion?.calls,state?.display]);
  useEffect(()=>{area.current?.querySelector<HTMLElement>('[aria-current=step]')?.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});},[state?.cursor]);
  if(!state||!expansion)return null;
  const step=state.model.steps[state.model.positions[state.cursor]];
  return <div className="runtime-method-wrap nodrag nopan" onClick={e=>e.stopPropagation()}><div className="runtime-method-chain" ref={area} style={{maxHeight:expansion.height}}>{rows.map(row=>{
    const {current,reached,returned}=rowProgress(state,row.callIds),name=[row.name,row.detail].filter(Boolean).join(' · ');
    return <button key={row.id} data-call-id={row.id} data-depth={row.depth} data-merged-count={row.callIds.length} data-first-step={state.model.positions[row.stepId]+1} data-returned={returned} data-reached={reached} aria-label={name} aria-current={current?'step':undefined} className={`runtime-method-row ${reached?'is-reached':'is-future'} ${current?'is-current':''} ${current&&step.exception?'has-error':''}`} style={{marginLeft:row.depth*18,width:`calc(100% - ${row.depth*18}px)`}} title={methodRowTitle(state.model,row,state.display)} onClick={()=>{data.runtime?.dispatch({type:'goto',id:row.stepId});data.runtime?.inspect(row.id);}}>{row.callIds.slice(1).map(id=><span key={id} data-call-id={id} className="runtime-call-anchor" aria-hidden="true"/>)}<Row mainClassName="runtime-row-main" leading={<span className="runtime-row-status" aria-label={current?'当前':returned?'已过':reached?'进行中':'未到'}>{current?<i className="runtime-current-ring"/>:returned?<Check size={18}/>:reached?'●':<span className="runtime-future-ring"/>}</span>} detail={row.detail&&<small title={row.detail}>{row.detail}</small>} tail={<>{current&&<PositionBadge runtime={data.runtime}/>}{row.callIds.length>1&&<span className="runtime-row-count">×{row.callIds.length}</span>}</>}><MethodLabel text={row.sql===undefined?executionCallLabel(state.model.byCall[row.id]):row.name}/></Row></button>;
  })}</div></div>;
}
function CardBody({id,data}:NodeProps<Node<CardData>>){
  const pointer=useRef<Point|undefined>(undefined);
  const frontendSummary=data.frontend?frontendCounts(data):undefined;
  const update=useUpdateNodeInternals(),portKey=JSON.stringify(data.ports);useEffect(()=>update(id),[id,portKey,update]);
  const compact=data.compact,role=data.visualRole||data.appearance?.role||cardRole(data);
  const runtime=data.runtime,projection=data.projection;
  const current=runtime?.state?.model.steps[runtime.state.model.positions[runtime.state.cursor]];
  if(data.dependencyLane)return <><DependencyLaneCard card={data} enterOrder={data.dependencyEnterOrder} skeleton={!!data.laneSkeleton}/>{data.ports.map(p=><Handle key={p.id} id={p.id} type={p.type} position={p.side==='left'?Position.Left:p.side==='top'?Position.Top:p.side==='bottom'?Position.Bottom:Position.Right} style={{left:p.x,top:p.y,opacity:0}}/>)}</>;
  if(data.hierarchy?.module){const module=data.hierarchy.module;return <><ModuleBlock module={module} index={data.hierarchyStart} selected={data.hierarchySelected===module.id} onSelect={()=>data.selectModule?.(module.id)}/>{data.ports.map(p=><Handle key={p.id} id={p.id} type={p.type} position={Position.Right} style={{opacity:0}}/>)}</>;}
  if(data.hierarchy?.groups||data.hierarchy?.frontend)return <CardSurface className={`service-container hierarchy-unit ${data.frontend?'hierarchy-frontend':'hierarchy-application'}`} data-unit-id={data.unit?.id} data-summary-kind={frontendSummary?'frontend':undefined} data-total={frontendSummary?.total} data-matched={frontendSummary?.matched} data-unmatched={frontendSummary?.unmatched}>
   {data.ports.map(p=><Handle key={p.id} id={p.id} type={p.type} position={p.side==='left'?Position.Left:p.side==='top'?Position.Top:p.side==='bottom'?Position.Bottom:Position.Right} style={{left:p.x,top:p.y}}/>)}
   {data.frontend?<HierarchyFrontend card={data} onExpand={data.expand} onSource={data.source} onEntry={data.openEntry} onTarget={data.backendTarget as ((target?:import('../shared/frontend-links').FrontendTarget)=>void)|undefined}/>:<HierarchyApplication card={data} start={data.hierarchyStart} onModule={data.capability} onEntry={data.openEntry} onMore={data.entryDetails} onCollapse={data.collapse}/>}
  </CardSurface>;
  if(data.kind==='browser'||data.runtimeCall)return <CardSurface className={`graph-card runtime-card ${data.selected?'is-selected':''}`}>
    {data.ports.map(p=><Handle key={p.id} id={p.id} type={p.type} position={p.side==='left'?Position.Left:p.side==='top'?Position.Top:p.side==='bottom'?Position.Bottom:Position.Right} style={{left:p.x,top:p.y}}/>)}
    <button className="runtime-card-main nodrag" onClick={event=>{event.stopPropagation();data.inspectRuntime?.();}}><Row leading={data.kind==='browser'?<Globe size={17}/>:<Code2 size={17}/>} tail={data.kind==='browser'&&runtime?.operation&&<span className={`operation-node-mark operation-number ${runtime.operation.stale?'is-old':''}`} title={runtime.operation.label}>{runtime.operation.marker}</span>}><strong title={data.name}>{data.name}</strong></Row></button>
    {data.runtimeCall&&<button className="runtime-breakpoint nodrag" aria-label={`回放断点：${data.name}`} aria-pressed={runtime?.state?.breakpoints.includes(data.runtimeCall)||false} onClick={e=>{e.stopPropagation();runtime?.dispatch({type:'breakpoint',id:data.runtimeCall!});}}><i/></button>}
    {(projection?.current===id||data.kind==='browser'&&!runtime?.state)&&<PositionBadge runtime={runtime}/>}
  </CardSurface>;
  if(data.kind==='anchor')return <div className="interface-anchor">{data.ports.map(p=><Handle key={p.id} id={p.id} type={p.type} position={p.side==='left'?Position.Left:p.side==='top'?Position.Top:p.side==='bottom'?Position.Bottom:Position.Right} style={{left:p.x,top:p.y,opacity:0}}/>)}</div>;
  if(data.external)return <CardSurface className={`graph-card backbone-external ${data.selected?'is-selected':''}`} title={data.name}>
   {data.ports.map(p=><Handle key={p.id} id={p.id} type={p.type} position={p.side==='left'?Position.Left:p.side==='top'?Position.Top:p.side==='bottom'?Position.Bottom:Position.Right} style={{left:p.x,top:p.y}}/>)}
   <Row className="card-heading" leading={<Globe size={17}/>} detail={<span title={data.external.origin}>{new URL(data.external.origin).host}</span>}><strong title={data.name}>项目外接口</strong></Row>
  </CardSurface>;
  if(data.frontend||data.foldedCards)return <div className={`service-container backbone-frontend ${data.selected?'is-selected':''}`} onDoubleClick={e=>e.stopPropagation()}>
   {data.ports.map(p=><Handle key={p.id} id={p.id} type={p.type} position={p.side==='left'?Position.Left:p.side==='top'?Position.Top:p.side==='bottom'?Position.Bottom:Position.Right} style={{left:p.x,top:p.y}}/>)}
   <div className="service-heading"><button className="backbone-title nodrag nopan" aria-expanded={data.compact===false} onClick={e=>{e.stopPropagation();data.expand();}}><Row leading={data.appearance?<RoleIcon role="frontend" size={17}/>:<Globe size={17}/>} tail={<><span title={data.stack}>{data.stack||'展开'}</span><ChevronRight size={16}/></>}><strong title={data.name}>{data.name}</strong></Row></button></div>
   {data.frontend?<FrontendContent card={data} onSource={data.source} onEntry={data.openEntry} onTarget={data.backendTarget as ((target?:import('../shared/frontend-links').FrontendTarget)=>void)|undefined}/>:<div className="backbone-fold nodrag nopan"><button onClick={data.expand}>{data.compact===false?'收起':'点开'}</button>{data.compact===false&&<ul>{data.foldedCards!.map(c=><li key={c.id}>{c.name} · {c.stack||c.summary}</li>)}</ul>}</div>}
  </div>;
  if(data.capabilities){const tiles=data.appearance?.tiles,columns=tiles?look.tileColumns:2,all=(data.allCapabilities as GraphCard['capabilities'])||data.capabilities,shown=tiles?[...all].sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name)):visibleCapabilities({...data,compact:data.expanded?false:data.compact}),other=all.length-shown.length;return <div className={`service-container ${tiles?'has-module-tiles':''} ${data.selected?'is-selected':''}`}>
    {data.ports.map(p=><Handle key={p.id} id={p.id} type={p.type} position={p.side==='left'?Position.Left:p.side==='top'?Position.Top:p.side==='bottom'?Position.Bottom:Position.Right} style={{left:p.x,top:p.y,transform:'translate(-50%, -50%)'}}/>)}
    {[...new Set(data.ports.map(p=>p.side))].map(side=>{const p=data.ports.find(p=>p.side===side)!;return <span key={side} className="logical-port" style={{left:p.x,top:p.y}}/>;})}
    <div className="service-heading" onClick={data.inspectRuntime}><Row leading={<RoleIcon role={role}/>} tail={<>{data.stack&&<span title={data.stack}>{data.stack}</span>}{projection?.current===id&&!projection.currentDomain&&<i key={current?.id} className="runtime-position" aria-label="当前位置"/>}</>}><strong title={data.name}>{data.name}</strong></Row></div>
    <UnitAddressExplanation unitId={data.unit?.id}/><div className={`capability-grid nodrag nopan ${tiles?'module-tiles':''}`} style={data.unit&&!data.inline&&!data.runtimeExpansion?{maxHeight:backbonePolicy.thresholds.detailsHeight.value,overflowY:'auto'}:undefined} onPointerDownCapture={e=>{pointer.current={x:e.clientX,y:e.clientY};}} onPointerCancel={()=>pointer.current=undefined} onClickCapture={e=>{if(e.detail&&pointer.current&&Math.hypot(e.clientX-pointer.current.x,e.clientY-pointer.current.y)>6){e.preventDefault();e.stopPropagation();}}} onClick={e=>e.stopPropagation()} onDoubleClick={e=>e.stopPropagation()}>{shown.map((c,i)=><Fragment key={c.id}><div data-capability-id={c.id} className={`capability ${runtime&&!projection?.domains.has(c.id)?'runtime-domain-future':''} ${data.selectedCapability===c.id?'active':''} ${projection?.domains.has(c.id)?'runtime-domain-active':''} ${projection?.currentDomain===c.id?'runtime-domain-current':''}`}><button aria-label={`展开 / 收起 ${c.name} 接口`} aria-expanded={data.inline?.domainId===c.id||data.runtimeExpansion?.domainId===c.id} onClick={()=>data.capability(c.id)}>{<span className="capability-name" title={c.name}>{c.name}</span>}<span className="capability-hint" role="tooltip">{c.name} · {c.count} 个接口 · 按 Enter 打开</span></button></div>{data.runtimeExpansion&&Math.floor(i/columns)===Math.floor(shown.findIndex(c=>c.id===data.runtimeExpansion!.domainId)/columns)&&(i%columns===columns-1||i===shown.length-1)&&<RuntimeExpansion data={data}/>} {data.inline&&Math.floor(i/columns)===Math.floor(shown.findIndex(c=>c.id===data.inline!.domainId)/columns)&&(i%columns===columns-1||i===shown.length-1)&&<section className="inline-interfaces" data-domain-id={data.inline.domainId} data-stage={data.inline.stage} data-selected-entry={data.inline.entryId} style={{height:data.inline.height}}><div className="inline-heading"><strong>{data.inline.name} 接口</strong><button onClick={data.collapse}>{data.inline.stage==='chain'?`返回 ${data.inline.name} 接口`:'收起接口'}</button></div><EntryList selectedId={data.inline.entryId} entries={data.inline.entries} outcomes={data.destinations||{}} onEntry={data.openEntry} onMore={data.entryDetails}/></section>}</Fragment>)}</div>
    {runtime?.expandedDomain&&data.capabilities.some(c=>c.id===runtime.expandedDomain)&&<button className="service-more nodrag" onClick={e=>{e.stopPropagation();runtime.explore(undefined);}}>收起方法</button>}{(other>0||data.expanded)&&<button className="service-more nodrag" onClick={e=>{e.stopPropagation();data.expand();}}>{data.expanded?'收起业务模块':`另外 ${other} 个`}</button>}
    
   </div>;}
  const resourceIcon=data.entity?.resourceKind==='vector'?<Search size={18}/>:data.entity?.resourceKind==='cache'?<Layers size={18}/>:data.entity?.resourceKind==='file'?<FileCode2 size={18}/>:data.entity?.resourceKind==='model'?<Sparkles size={18}/>:data.entity?.resourceKind==='external'?<Globe size={18}/>:<Database size={18}/>;
  const icon=data.kind==='resource'?resourceIcon:data.kind==='service'?<Server size={18}/>:data.kind==='domain'?<Route size={18}/>:data.kind==='entry-group'?(data.entries?.[0].kind==='http'?<Route size={18}/>:<Play size={18}/>):data.kind==='type'?<Braces size={18}/>:data.kind==='file'?<FileCode2 size={18}/>:data.kind==='module'?<Box size={18}/>:data.kind==='group'?<Layers size={18}/>:data.entry||data.tag.includes('Controller')?<Route size={17}/>:<Code2 size={17}/>;
  return <CardSurface className={`graph-card ${data.dependency?'dependency-card dependency-'+data.dependency.color:''} ${data.hierarchy?.resource?.configuredOnly?'configuration-only':''} kind-${data.kind} ${data.summary?'flow-card':''} ${data.focus?'is-focus':''} ${data.selected?'is-selected':''} ${data.related?'is-related':''} ${compact?'compact':''} ${data.entry?'is-entry':''}`} title={data.symbol?`${data.symbol.signature}\n${data.tag} · ${data.symbol.file}`:data.subtitle}>
    {(data.resource?.kind==='database'||data.entity?.resourceKind==='database')&&<GuideMark kind="database" id={data.resource?.id||data.entity?.id}/>}
    {projection?.current===id&&!projection.currentDomain&&<PositionBadge runtime={runtime}/>}
    {data.ports.map(p=><Handle key={p.id} id={p.id} type={p.type} position={p.side==='left'?Position.Left:p.side==='top'?Position.Top:p.side==='bottom'?Position.Bottom:Position.Right} style={{left:p.x,top:p.y,transform:'translate(-50%, -50%)'}}/>)}
    {[...new Set(data.ports.map(p=>p.side))].map(side=>{const p=data.ports.find(p=>p.side===side)!;return <span key={side} className="logical-port" style={{left:p.x,top:p.y}}/>;})}
    <Row className="card-heading" leading={<span className="card-top"><span className="card-icon">{data.appearance?<RoleIcon role={role}/>:icon}</span></span>} tail={<>{data.cycle&&<span className="cycle-badge">循环</span>}{!runtime&&data.ownerId&&!!data.hidden?.length&&<button className="flow-reveal nodrag nopan" title={`展开 ${data.hidden.length} 个直接调用`} aria-label={`展开 ${data.hidden.length} 个直接调用`} onClick={event=>{event.stopPropagation();data.reveal([id,...data.hidden!]);}}>+{data.hidden.length}</button>}</>} detail={data.summary&&(!compact||data.dependency)&&data.kind!=='entry-group'&&<span className="card-summary" title={data.summary}>{data.summary}</span>}><span className="card-name" title={data.name}>{data.name}</span></Row>
    {data.route&&!compact&&<div className="card-route"><span className="http-method">{httpMethodLabel(data.route.split(' ')[0])}</span><span>{data.route.split(' ').slice(1).join(' ')}</span></div>}
    {data.kind==='entry-group'&&!compact&&data.entries?.[0].kind==='http'&&<div className="card-content nodrag" onClick={e=>e.stopPropagation()}><EntryList entries={data.entries.slice(0,uiTokens.layout.guideRows)} outcomes={data.destinations||{}} onEntry={data.openEntry} onMore={data.entryDetails}/></div>}
    {!compact&&data.rows&&<div className="file-symbols nodrag">{data.rows.map(s=><div key={s.id}><button title={`${s.signature} · 单击看源码`} onClick={e=>{e.stopPropagation();data.pick(s);}}><Code2 size={12}/><span>{s.name}</span></button><button title={`打开 ${s.name}`} onClick={e=>{e.stopPropagation();data.pick(s,true);}}><ArrowUpRight size={14}/></button></div>)}</div>}

  </CardSurface>;
}
const Card=memo(function Card(props:NodeProps<Node<CardData>>){
 const {data,id}=props,[closed,setClosed]=useState(false),pointer=useRef<Point|undefined>(undefined);
 const location=data.symbol?{file:data.symbol.file,range:data.symbol.selection}:data.dependency?.location||data.entryPoint?.location||(data.detailLocation as Location|undefined);
 const fullCapabilities=(data.allCapabilities as GraphCard['capabilities'])||data.capabilities;
 const count=data.frontend?`页面 ${data.frontend.pages.length} · 调用 ${data.frontend.calls.length} 个接口 · 已对上 ${data.frontend.matched} / 未对上 ${data.frontend.unmatched}`:fullCapabilities?`${fullCapabilities.length} 个模块 · ${fullCapabilities.reduce((n,c)=>n+c.count,0)} 个接口`:data.dependency?(data.dependency.classes?`${data.dependency.classes} 个类`:'文件'):data.entries?`${data.entries.length} 个接口`:data.subtitle||data.summary;
 const open=()=>data.inspectRuntime?data.inspectRuntime():(data.details as (()=>void)|undefined)?.();
 const adaptive=!!data.appearance||!!data.runtime,role=data.visualRole||data.appearance?.role||cardRole(data),scale=data.appearance?.scale||1,bodyProps=scale===1?props:{...props,data:{...data,ports:data.ports.map(p=>({...p,x:p.x/scale,y:p.y/scale}))}};
 if(data.kind==='anchor')return <CardBody {...props}/>;
 return <div className={`card-accessible ${data.hierarchy?'hierarchy-card':''} ${closed?'hint-closed':''}`} data-card-role={role} data-continuity-owner={!data.runtime?data.ownerId:undefined} data-zoom-priority={data.frontend?frontendCounts(data).total:data.unit?.interfaceCount??data.entries?.length??data.count??0} style={{'--card-scale':scale,'--role-color':`var(--color-phase-${appearancePolicy.roles[role].color})`} as React.CSSProperties} tabIndex={0} role="group" aria-label={data.name} aria-describedby={`hint-${id}`} onPointerDownCapture={event=>{pointer.current={x:event.clientX,y:event.clientY};}} onClick={event=>{if((event.target as Element).closest('button,summary,a'))return;if(event.detail&&pointer.current&&Math.hypot(event.clientX-pointer.current.x,event.clientY-pointer.current.y)>6)return;event.stopPropagation();open();}} onClickCapture={event=>{if(!(event.target as Element).closest('.card-hint'))setClosed(true);}} onPointerLeave={()=>setClosed(false)} onFocusCapture={()=>setClosed(false)} onKeyDown={event=>{if(event.key==='Escape'&&!closed&&!event.currentTarget.closest('.graph-canvas[data-hierarchy-view=main]')?.querySelector('.inline-interfaces')){event.preventDefault();event.stopPropagation();setClosed(true);}else if(event.key==='Enter'&&event.target===event.currentTarget){event.preventDefault();event.stopPropagation();setClosed(true);open();}}}>{adaptive?<div className="card-body-layer"><div className="card-size-layer"><CardBody {...bodyProps}/></div></div>:<CardBody {...props}/>}{adaptive&&<button className="semantic-token nodrag nopan" tabIndex={-1} aria-label={`放大查看 ${data.name}`} title={data.name} onClick={event=>{event.stopPropagation();event.currentTarget.closest('.graph-canvas')?.dispatchEvent(new CustomEvent('graph-detail',{detail:{id}}));}}><RoleIcon role={role} size={24}/><span title={data.hierarchy?.module?.name||data.name}>{data.hierarchy?.module?.name||data.name}{data.frontend?` · ${frontendCounts(data).total} 个调用`:null}</span><i/></button>}<aside id={`hint-${id}`} className="card-hint nodrag nopan" role="tooltip" onClick={event=>event.stopPropagation()}>{data.runtime?<><strong>{data.name}</strong>{data.unit?.notice&&<p>{data.unit.notice}</p>}{count&&<span className={data.dependency?'dependency-count':''}>{count}</span>}{location&&<button className="hint-location" title={location.file} onClick={()=>data.runtime?.source?data.runtime.source(location):data.source(location)}>{location.file}:{location.range.start.line+1}</button>}<button onClick={open}>按 Enter 打开</button>{!!data.unknownRelations?.length&&<button onClick={()=>data.evidence(data.unknownRelations!)}>后续待确认 {data.unknownRelations.length}</button>}{!!data.toolRelations?.length&&<button onClick={()=>data.evidence(data.toolRelations!)}>工具调用 {data.toolRelations.length}</button>}{!!data.modelRelations?.length&&<button onClick={()=>data.evidence(data.modelRelations!)}>数据类型 {data.modelRelations.length}</button>}{!!data.hidden?.length&&<button onClick={()=>data.reveal([id,...data.hidden!])}>继续查看 {data.hidden.length} 个</button>}{!!data.innerRelations?.length&&<button onClick={()=>data.evidence(data.innerRelations!)}>查看关系</button>}{(data.kind==='group'||data.kind==='symbol'&&!data.summary)&&<button onClick={data.expand}>{data.expanded?'收起':'展开'}</button>}{data.entryPoint&&<button onClick={()=>data.openEntry(data.entryPoint!)}>阅读接口</button>}</>:<><strong>{data.name}</strong>{location&&<span className="hint-location" title={location.file}>{location.file.split(/[\\/]/).at(-1)}:{location.range.start.line+1}</span>}</>}</aside></div>;
});
/** The selected route and its definition are the same entry, not a separate call. */
function EntryConnector({host,entryId,symbolId,snapshot}:{host:RefObject<HTMLDivElement|null>;entryId:string;symbolId:string;snapshot?:LayoutSnapshot}){
 const svg=useRef<SVGSVGElement>(null);
 useLayoutEffect(()=>{
  const root=host.current,canvas=svg.current;if(!root||!canvas)return;
  const path=canvas.querySelector('[data-route]');if(!path)return;let row:HTMLElement|undefined,target:HTMLElement|undefined;
  const paint=()=>{const matrix=canvas.getScreenCTM()?.inverse();if(!matrix||!row||!target)return;const a=row.getBoundingClientRect(),b=target.getBoundingClientRect(),start=new DOMPoint(a.right,a.top+a.height/2).matrixTransform(matrix),end=new DOMPoint(b.left,b.top+b.height/2).matrixTransform(matrix),middle=(start.x+end.x)/2;path.setAttribute('d',`M ${start.x} ${start.y} C ${middle} ${start.y} ${middle} ${end.y} ${end.x} ${end.y}`);};
  const sizes=new ResizeObserver(paint),connect=()=>{const nextRow=[...root.querySelectorAll<HTMLElement>('[data-entry-id]')].find(e=>e.dataset.entryId===entryId),nextTarget=[...root.querySelectorAll<HTMLElement>('.react-flow__node[data-id]')].find(e=>e.dataset.id===symbolId);if(nextRow!==row||nextTarget!==target){sizes.disconnect();row=nextRow;target=nextTarget;if(row)sizes.observe(row);if(target)sizes.observe(target);}paint();};
  const mounted=new MutationObserver(connect);mounted.observe(root,{childList:true,subtree:true});const frame=requestAnimationFrame(connect);return()=>{cancelAnimationFrame(frame);mounted.disconnect();sizes.disconnect();};
 },[host,entryId,symbolId,snapshot]);
 return <svg ref={svg} className="entry-definition-link" aria-hidden="true"><defs><marker id="entry-definition-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M1 1 L9 5 L1 9" fill="none" stroke="currentColor"/></marker></defs><path data-route="" fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" markerEnd="url(#entry-definition-arrow)"/></svg>;
}
const RoutedEdge=memo(function RoutedEdge(props:EdgeProps){
  const data=props.data as {lane?:{points:Point[];main:boolean;common:boolean;kind?:string;color:string};points:Point[];label:Point;labelWidth:number;temporary:boolean;inspect:()=>void;status:string;active:boolean;showLabel:boolean;feedback:boolean;frontendBand?:boolean;contextFade?:boolean;sourceId?:string;targetId?:string;markerId?:string;rule?:boolean;tooltip?:string};
  const temporary=getSmoothStepPath({...props,borderRadius:7});
  if(data.lane)return DependencyLaneEdge(props,{...data.lane,path:data.temporary?temporary[0]:undefined});
  const d=data.temporary?temporary[0]:roundedPath(data.points);
  if(data.frontendBand)return <g data-continuity-source={data.sourceId} data-continuity-target={data.targetId}><FrontendBand id={props.id} path={d} dashed={!!props.style?.strokeDasharray} onClick={data.inspect}/></g>;
  const label=data.temporary?{x:temporary[1],y:temporary[2]}:data.label;
  return <><g className={data.contextFade?'main-context-edge':undefined} data-continuity-source={data.contextFade?data.sourceId:undefined} data-continuity-target={data.contextFade?data.targetId:undefined}><BaseEdge id={props.id} path={d} markerStart={props.markerStart} markerEnd={data.markerId?`url(#${data.markerId})`:props.markerEnd} style={props.style} interactionWidth={18}/></g>{data.showLabel&&<EdgeLabelRenderer><button title={data.tooltip||'查看连接与源码'} className={`edge-label nodrag nopan ${data.status} ${data.active?'selected':''}`} style={{width:data.labelWidth,transform:`translate(-50%,-50%) translate(${label.x}px,${label.y}px)`}} onClick={e=>{e.stopPropagation();data.inspect();}}>{data.feedback?'↩ ':''}{String(props.label||'')}{data.rule?' Ⓡ':''}{data.status==='candidate'||data.status==='mixed'?' ◇':''}</button></EdgeLabelRenderer>}</>;
});
const nodeTypes={card:Card},edgeTypes={routed:RoutedEdge};
function useStableList<T>(items:T[]){
  const saved=useRef(items);if(saved.current.length!==items.length||items.some((item,i)=>item!==saved.current[i]))saved.current=items;return saved.current;
}
type Props={runtime?:ExecutionLayer;index:ProjectIndex;view:ViewState;onChange:(patch:Partial<ViewState>)=>void;onNavigate:(view:Partial<ViewState>)=>void;onSource:(location:Location,id?:string)=>void;onRelations:(links:GraphLink[])=>void;onEntry?:(entry:EntryPoint,target?:string)=>void;onExplore:(id:string)=>void;onCollapse:()=>void;onLocate:(id:string)=>void;toolbar?:(actions:ReactNode,viewportControls:ReactNode)=>ReactNode;motion:boolean};
type CameraCommands={focus:()=>void;overview:()=>void;pause:()=>void;playback?:(playing:boolean)=>void};
type CanvasProps=Props&{live:RefObject<Props>;commands:RefObject<CameraCommands>};
function Inner({live,commands}:CanvasProps){
  const {notes}=useAnalysisNotes();
  const {runtime,index,view,onChange,onNavigate,onSource,onRelations,onEntry,onExplore,onCollapse,onLocate,toolbar,motion}=live.current;
  const hierarchyView=!runtime&&['main','guide'].includes(view.level);
  const laneView=!runtime&&view.level==='overview';
  useLayoutEffect(()=>graphCommit({operation:runtime?.operation?.id,cursor:runtime?.state?.model.positions[runtime.state.cursor],playing:runtime?.state?.playing,expanded:runtime?.expandedDomain,layout:runtime?.layoutKey,model:runtime?.state?.model.fingerprint.length}));
  const flow=useReactFlow(),host=useRef<HTMLDivElement>(null),worker=useRef<Worker|null>(null);
  const laneOrientations=useRef(new Map<string,LaneOrientation>());
  const freshLaneProjects=useRef(new Set<string>());
  if(laneView&&!laneOrientations.current.has(index.id)){
    const name='codeleader.dependency-orientation.'+index.id;let saved:string|null=null;try{saved=localStorage.getItem(name);}catch{}
    const area=host.current?.getBoundingClientRect(),orientation=saved==='rows'||saved==='columns'?saved:(area?.width||innerWidth)/(area?.height||innerHeight)>dependencyPolicy.thresholds.laneWideAspect.value?'columns':'rows';
    if(saved!=='rows'&&saved!=='columns')freshLaneProjects.current.add(index.id);
    laneOrientations.current.set(index.id,orientation);try{localStorage.setItem(name,orientation);}catch{}
  }
  const laneOrientation=laneOrientations.current.get(index.id);
  useEffect(()=>{const area=host.current;if(!area)return;const detail=(event:Event)=>{const id=(event as CustomEvent<{id:string}>).detail.id,node=flow.getNode(id);if(!node)return;const bounds=area.getBoundingClientRect(),zoom=Math.min(1.25,(bounds.width-2*look.padding)/(node.width||1),(bounds.height-2*look.padding)/(node.height||1));void flow.setCenter(node.position.x+(node.width||0)/2,node.position.y+(node.height||0)/2,{zoom,duration:motion?motionMs('normal'):0});};area.addEventListener('graph-detail',detail);return()=>area.removeEventListener('graph-detail',detail);},[flow,motion]);
  const [storedNodes,setNodes]=useState<Node<CardData>[]>([]),[storedSnapshot,setSnapshot]=useState<LayoutSnapshot>(),[busy,setBusy]=useState(false),[layoutError,setLayoutError]=useState('');
  const [revision,setRevision]=useState(0),[dragging,setDragging]=useState(false),[trace,setTrace]=useState(false);
  const zoom=flow.getViewport().zoom;
  
  const runtimeColumn=useRef<boolean|undefined>(undefined);
  const runtimeReserve=useRef<{session:string;sizes:Record<string,{width:number;height:number}>}|undefined>(undefined);
  const runtimePositions=useRef<Record<string,Point>|undefined>(undefined);
  const geometryCache=useRef(new Map<string,LayoutSnapshot>());
  const measured=useRef(new Map<string,Node<CardData>['measured']>());
  const sequence=useRef(0),lastKey=useRef(''),navigating=useRef(false),dragPositions=useRef<Record<string,Point>|undefined>(undefined),organize=useRef(false);
  const lastExploration=useRef<string|undefined>(undefined);
  const appliedGuideCamera=useRef<number|undefined>(undefined);
  const lastIndex=useRef<ProjectIndex|undefined>(undefined);
  const userViewport=useRef(false);
  const fitRef=useRef<()=>void>(()=>{});
  const motionEpoch=useRef(0);
  const manualViewportEpoch=useRef(0);
  const previousRuntimeDomain=useRef<string|undefined>(undefined),runtimeRestore=useRef<{positions:Record<string,Point>;viewport:{x:number;y:number;zoom:number}}|undefined>(undefined),runtimeRestoring=useRef(false);
  useEffect(()=>{if(!runtime){previousRuntimeDomain.current=undefined;runtimeRestore.current=undefined;runtimeRestoring.current=false;return;}if(runtime.expandedDomain&&!previousRuntimeDomain.current)runtimeRestore.current={positions:Object.fromEntries(flow.getNodes().map(n=>[n.id,n.position])),viewport:flow.getViewport()};if(previousRuntimeDomain.current&&!runtime.expandedDomain)runtimeRestoring.current=true;previousRuntimeDomain.current=runtime.expandedDomain;},[!!runtime,runtime?.expandedDomain,flow]);
  useEffect(()=>{if(view.cameraRevision){motionEpoch.current++;void flow.setViewport(view.viewport,{duration:motionPolicy.zero});}},[view.cameraRevision,flow]);
  const servicePositions=useRef(new Map<string,Record<string,Point>>());
  const lastDensity=useRef(view.density);
  const lastDependencyScope=useRef<{index:string;scope?:string;camera?:number}>(undefined);
  const lastFrontendLayout=useRef<string|undefined>(undefined);
  const [laneModel,setLaneModel]=useState<{key:string;project:string;graph:GraphResult}>(),laneModelSequence=useRef(0),laneWorkerIndex=useRef<ProjectIndex|undefined>(undefined);
  const laneModelKey=JSON.stringify([index.id,index.createdAt,index.status,index.relations.length,index.symbols.length,view.focus,view.filter,view.expanded,view.direction,view.showTests,view.entryId,view.showAll,view.relationFilter,view.fullDependencies,view.dependencyScope,view.dependencyEntryId,view.reading,view.relationSelection]);
  const laneModelPending=laneView&&laneModel?.key!==laneModelKey;
  const baseResult=useMemo(()=>laneView?(laneModel?.project===index.id?laneModel.graph:{cards:[],links:[],omitted:0}):graphFor(index,view),[index,view.level,view.focus,view.filter,view.expanded,view.direction,view.density,view.showTests,view.entryId,view.showAll,view.relationFilter,view.fullDependencies,view.dependencyScope,view.dependencyEntryId,view.reading,view.relationSelection,view.exploration,view.frontendTargets,laneView,laneModel]);
  const dependencyKey=view.level==='overview'?':'+(baseResult.dependencyScope||'chain')+':'+(view.dependencyEntryId||''):'';
  const lanePositionKey='codeleader.dependency-positions.'+index.id+':'+(baseResult.dependencyScope||'chain')+':'+(view.dependencyEntryId||view.focus||'');
  const key=`${index.id}:${index.createdAt}${dependencyKey}:${view.level}:${view.focus}:${view.filter}:${view.level==='main'?'':view.direction||'both'}:${view.level==='main'?'':view.entryId||''}`;
  const domains=useMemo(()=>runtime?.state?executionDomains(index,runtime.state.model):undefined,[index,runtime?.state?.model]);
  const currentCall=runtime?.state?.model.steps[runtime.state.model.positions[runtime.state.cursor]]?.callId;
  const displayDomain=runtime?.operation?.pending||runtime?.collapseAuto?undefined:runtime?.expandedDomain||(currentCall&&domains?.get(currentCall));
  const runtimeTopology=displayDomain?runtime?.state?.model.calls.map(c=>[c.id,c.parentId,c.span?.symbolId,c.span?.entityId].join('|')).join(';'):undefined;
  const explained=useMemo(()=>{const addresses=notes?.addresses.filter(n=>baseResult.cards.some(c=>c.unit?.id===n.unitId&&!c.frontend));if(!addresses?.length)return baseResult;return {...baseResult,cards:baseResult.cards.map(card=>{const note=addresses.find(n=>n.unitId===card.unit?.id);return note&&card.unit?{...card,unit:{...card.unit,notice:card.unit.notice||note.count+' 处调用的地址还不能确定'}}:card;})};},[baseResult,notes]);
  const result=useMemo(()=>{if(!runtime){const shown=presentGraph(explained,index);if(laneView){const lanes=presentDependencyLanes(shown);return singlePage(index,lanes.cards)?{...lanes,cards:lanes.cards.map(card=>({...card,appearance:{...card.appearance!,scale:1}}))}:lanes;}return hierarchyView?presentHierarchy(shown,index,view):shown;}const graph=runtimeGraph(index,baseResult,runtime.state?.model,displayDomain),involved=new Set(domains?.values());return {...graph,cards:graph.cards.map(card=>!card.capabilities?card:{...card,allCapabilities:card.capabilities,capabilities:view.expanded.includes(card.id)?card.capabilities:card.capabilities.filter(c=>involved.has(c.id))})};},[baseResult,explained,!!runtime,hierarchyView,laneView,displayDomain,runtimeTopology,runtime?.state?.model.fingerprint,domains,view.expanded]);
  const guideModules=result.cards.flatMap(c=>c.hierarchy?.module?[c.hierarchy.module]:[]).sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name));
  const guideModule=view.level==='guide'?(guideModules.find(m=>m.id===view.guideModuleId||m.cardId===view.guideModuleId)||guideModules.find(m=>m.id===view.selected||m.cardId===view.selected)||guideModules[0]):undefined;
  if(runtime&&runtimeReserve.current?.session!==runtime.record?.id){runtimeReserve.current={session:runtime.record?.id||'',sizes:runtimeEnvelopes(index,runtime.record,result.cards)};runtimePositions.current=undefined;geometryCache.current.clear();}
  if(runtime&&runtimeColumn.current===undefined)runtimeColumn.current=(host.current?.clientWidth||document.querySelector('.runtime-canvas-stack')?.clientWidth||800)<600;
  const geometryKey=JSON.stringify([runtimeColumn.current,result.cards.map(card=>[card.id,cardSize(card),card.kind,card.section,card.ownerId,card.vertical,card.inline?.top,card.inline?.height,card.capabilities?.map(c=>c.id)]),result.links.map(link=>[link.id,link.source,link.target,link.type,link.label,link.conditional,link.optional,link.feedback]),runtimePositions.current]);
  const runtimeGeometry=useMemo(()=>{if(!runtime)return;const old=geometryCache.current.get(geometryKey);if(old)return old;const next=runtimeLayout(++sequence.current,result.cards,result.links,runtimeReserve.current?.sizes||{},!!runtimeColumn.current,runtimePositions.current);if(geometryCache.current.size>=16)geometryCache.current.delete(geometryCache.current.keys().next().value!);geometryCache.current.set(geometryKey,next);return next;},[!!runtime,geometryKey,revision]);
  const snapshot=runtimeGeometry||storedSnapshot;
  const loadingView=!runtime&&(busy||laneModelPending||lastKey.current!==key);
  useSemanticZoom(host,snapshot,true);
  useCanvasOverlays(host);
  useHierarchyHover(host,hierarchyView&&view.level==='main');
  useDependencyLaneFocus(host,laneView,snapshot,result.cards,result.links,view.selected);
  const nodes=useMemo<Node<CardData>[]>(()=>runtimeGeometry?result.cards.map(card=>{const n=runtimeGeometry.nodes.find(n=>n.id===card.id)!;return{id:card.id,type:'card',position:{x:n.x,y:n.y},width:n.width,height:n.height,measured:measured.current.get(card.id),zIndex:card.kind==='service'?0:2,draggable:!card.ownerId,style:card.kind==='service'?{pointerEvents:'none' as const}:undefined,data:{...card,detailLocation:card.unit?index.units?.find(unit=>unit.id===card.unit!.id)?.basis[0]?.location:result.links.filter(l=>l.source===card.id||l.target===card.id).flatMap(l=>l.relations.flatMap(r=>r.locations))[0],source:(location:Location)=>current.current.onSource(location),ports:n.ports,selected:false,related:false,expanded:view.expanded.includes(card.id),focusAction:()=>{},expand:()=>onChange({expanded:view.expanded.includes(card.id)?view.expanded.filter(id=>id!==card.id):[...view.expanded,card.id]}),collapse:()=>onCollapse(),capability:id=>runtime?.explore(id),openEntry:(entry,target)=>live.current.onEntry?.(entry,target),entryDetails:()=>{},pick:(symbol)=>live.current.onSource({file:symbol.file,range:symbol.selection},symbol.id),evidence:()=>{},reveal:()=>{}}};}):storedNodes,[runtimeGeometry,storedNodes,result,view.expanded]);
  const recordedProjection=runtime?.state?projectExecution(index,result.cards,result.links,runtime.state):undefined;
  const projection=runtime?.operation?.pending&&recordedProjection?{...recordedProjection,active:new Set([browserNodeId]),current:browserNodeId,currentDomain:undefined,domains:new Set<string>(),edges:new Set<string>(),currentEdge:undefined}:recordedProjection;
  useEffect(()=>{
    if(!runtime||!host.current)return;
    const root=host.current;let frame=0;const update=()=>{cancelAnimationFrame(frame);if(root.dataset.overlayMoving==='true')return;frame=requestAnimationFrame(()=>{const node=root.querySelector<HTMLElement>('[data-id="runtime:browser"]'),area=root.getBoundingClientRect(),r=node?.getBoundingClientRect();if(!r||root.dataset.overlayMoving==='true')return;void window.codeleader.execution.forProject(index.id,runtime.record?.id).echoAnchor({x:r.left+6,y:r.top+r.height/2,visible:r.right>area.left&&r.left<area.right&&r.bottom>area.top&&r.top<area.bottom,operationId:runtime.operation?.id,preview:runtime.operation?.preview,reducedMotion:!motion||matchMedia('(prefers-reduced-motion: reduce)').matches});});};
    const moving=()=>{cancelAnimationFrame(frame);void window.codeleader.execution.forProject(index.id,runtime.record?.id).echoAnchor({x:0,y:0,visible:false,operationId:runtime.operation?.id});};
    const observer=new MutationObserver(update),resize=new ResizeObserver(update);observer.observe(root,{attributes:true,attributeFilter:['style'],subtree:true});resize.observe(root);root.addEventListener('canvas-moving',moving);root.addEventListener('canvas-settled',update);update();return()=>{cancelAnimationFrame(frame);observer.disconnect();resize.disconnect();root.removeEventListener('canvas-moving',moving);root.removeEventListener('canvas-settled',update);};
  },[!!runtime,snapshot?.version,runtime?.operation?.id,runtime?.operation?.preview,motion]);
  const runtimeFit=useRuntimeFit({runtime,host,snapshot,projection,cards:result.cards,links:result.links,manual:userViewport,motion});
  const wheelZoom=useSmoothWheel({host,onStart:()=>{motionEpoch.current++;manualViewportEpoch.current++;userViewport.current=true;if(runtime)runtimeFit.pause();},onEnd:viewport=>{if(runtime)runtime.viewport(viewport);else live.current.onChange({viewport});}});
  const receivers=new Set((index.entries||[]).filter(e=>e.kind==='http'&&e.symbolId).map(e=>e.symbolId!));
  useGraphMotion({host,runtime,projection,snapshot,links:result.links});
  usePacketMotion({host,runtime,projection,receivers,links:result.links});
  if(!runtime)runtimeColumn.current=undefined;

  const current=useRef({view,result,key,onChange,onNavigate,onSource,onRelations,onExplore,onCollapse,onLocate,motion,runtime});current.current={view,result,key,onChange,onNavigate,onSource,onRelations,onExplore,onCollapse,onLocate,motion,runtime};
  useLayoutEffect(()=>{
    const list=host.current?.querySelector<HTMLElement>('.hierarchy-interface-list'),moduleId=guideModule?.id;if(runtime||view.level!=='guide'||!list||!moduleId)return;
    list.scrollTop=view.guideScrolls?.[moduleId]||0;
    const save=()=>{const active=live.current.view;if(active.level!=='guide')return;const top=list.scrollTop;if(active.guideScrolls?.[moduleId]!==top)live.current.onChange({guideScrolls:{...active.guideScrolls,[moduleId]:top}});};
    list.addEventListener('scroll',save,{passive:true});return()=>list.removeEventListener('scroll',save);
  },[index.id,index.root,view.level,guideModule?.id,!!runtime]);
  useLayoutEffect(()=>{if(!runtime)host.current?.dispatchEvent(new Event('canvas-dismiss'));},[index.id,index.root,view.level,view.selected,view.entryId,view.inspector,!!runtime]);
  const selectedEdge=view.relationSelection;
  const located=useRef<number|undefined>(undefined);
  useEffect(()=>{const request=view.locateRequest;if(!request||located.current===request.token)return;const node=snapshot?.nodes.find(n=>n.id===request.id);if(!node)return;located.current=request.token;const v=flow.getViewport(),area=host.current!.getBoundingClientRect(),left=node.x*v.zoom+v.x,top=node.y*v.zoom+v.y;
    if(left<20||top<80||left+node.width*v.zoom>area.width-20||top+node.height*v.zoom>area.height-20){motionEpoch.current++;void flow.setCenter(node.x+node.width/2,node.y+node.height/2,{zoom:v.zoom,duration:motionPolicy.zero});}
  },[view.locateRequest,snapshot,flow]);
  const [edgeChoices,setEdgeChoices]=useState<{ids:string[];x:number;y:number}>();
  useEffect(()=>{const root=host.current;if(!root||!edgeChoices)return;const close=()=>setEdgeChoices(undefined);root.addEventListener('canvas-moving',close);return()=>root.removeEventListener('canvas-moving',close);},[edgeChoices]);
  const selectLink=(id:string)=>{const state=current.current,link=state.result.links.find(l=>l.id===id);if(!link)return;setEdgeChoices(undefined);if(state.runtime){state.runtime.relation(link.source,link.target);return;}state.onChange({relationSelection:id,reading:{...state.view.reading,viewport:state.view.reading?.viewport||state.view.viewport,viewportWidth:state.view.reading?.viewportWidth||host.current!.getBoundingClientRect().width}});state.onRelations([link]);};
  const previousReading=useRef(view.reading);
  useEffect(()=>{const saved=previousReading.current;if(saved&&!view.reading&&lastKey.current===key){const width=host.current!.getBoundingClientRect().width;void flow.setViewport({...view.viewport,x:view.viewport.x+(width-(saved.viewportWidth||width))/2},{duration:motionPolicy.zero});}previousReading.current=view.reading;},[view.reading,flow,view.viewport,key]);
  useEffect(()=>{if(!selectedEdge||!snapshot||view.exploration)return;const link=result.links.find(l=>l.id===selectedEdge),ends=snapshot.nodes.filter(n=>n.id===link?.source||n.id===link?.target);if(!ends.length)return;const x=Math.min(...ends.map(n=>n.x)),y=Math.min(...ends.map(n=>n.y));const width=Math.max(...ends.map(n=>n.x+n.width))-x,height=Math.max(...ends.map(n=>n.y+n.height))-y,area=host.current!.getBoundingClientRect();void flow.setCenter(x+width/2,y+height/2,{zoom:Math.max(.9,Math.min(1,(area.width-70)/width,(area.height-100)/height)),duration:motionPolicy.zero});},[selectedEdge,view.reading?.isolate]);
  const focusReadable=(saved?:LayoutSnapshot)=>{
    if(runtime){runtimeFit.refit();return Promise.resolve(true);}
    const geometry=saved||snapshot;if(!geometry?.nodes.length)return;
    const state=current.current,selected=geometry.nodes.find(n=>n.id===(state.view.selected||state.view.focus));
    const area=(host.current!.querySelector('.react-flow')||host.current!).getBoundingClientRect();
    if(laneView&&singlePage(index,state.result.cards)){const node=geometry.nodes[0];return flow.setViewport({x:area.width/2-node.x-node.width/2,y:area.height*wordingTable.limits.singleCenter.value-node.y-node.height/2,zoom:1},{duration:motionPolicy.zero});}
    if(state.view.exploration){
      const owner=geometry.nodes.find(n=>n.id===state.view.exploration?.serviceId);
      if(owner){const children=new Set(state.result.cards.filter(c=>c.ownerId===owner.id).map(c=>c.id)),resources=new Set(state.result.links.filter(l=>l.source===owner.id||children.has(l.source)).map(l=>l.target)),nodes=geometry.nodes.filter(n=>n.id===owner.id||children.has(n.id)||resources.has(n.id));
       const x=Math.min(...nodes.map(n=>n.x)),y=Math.min(...nodes.map(n=>n.y)),right=Math.max(...nodes.map(n=>n.x+n.width)),bottom=Math.max(...nodes.map(n=>n.y+n.height)),viewport=flow.getViewport(),pad=look.padding;
       if(x*viewport.zoom+viewport.x>=pad&&y*viewport.zoom+viewport.y>=pad&&right*viewport.zoom+viewport.x<=area.width-pad&&bottom*viewport.zoom+viewport.y<=area.height-pad)return Promise.resolve(true);
       if(state.view.exploration.stage==='chain'){
        const target=nodes.find(n=>n.id===state.view.selected)||nodes.find(n=>children.has(n.id));if(target){const left=target.x*viewport.zoom+viewport.x,top=target.y*viewport.zoom+viewport.y,r=left+target.width*viewport.zoom,b=top+target.height*viewport.zoom,dx=left<pad?pad-left:r>area.width-pad?area.width-pad-r:0,dy=top<pad?pad-top:b>area.height-pad?area.height-pad-b:0;if(!dx&&!dy)return Promise.resolve(true);return flow.setViewport({...viewport,x:viewport.x+dx,y:viewport.y+dy},{duration:motion&&!matchMedia('(prefers-reduced-motion: reduce)').matches?uiTokens.continuity.flowDuration:0});}
       }
       const zoom=Math.min(1,(area.width-pad*2)/(right-x),(area.height-pad*2)/(bottom-y)),duration=motion&&!matchMedia('(prefers-reduced-motion: reduce)').matches?(state.view.exploration.stage==='chain'?uiTokens.continuity.flowDuration:uiTokens.continuity.expandDuration):0;
       return flow.setViewport({x:area.width/2-(x+right)/2*zoom,y:area.height/2-(y+bottom)/2*zoom,zoom},{duration});
      }
    }
    const rects=[...geometry.nodes,...geometry.regions];
    const bounds={x:Math.min(...rects.map(n=>n.x)),y:Math.min(...rects.map(n=>n.y)),width:Math.max(...rects.map(n=>n.x+n.width))-Math.min(...rects.map(n=>n.x)),height:Math.max(...rects.map(n=>n.y+n.height))-Math.min(...rects.map(n=>n.y))};
    if(hierarchyView&&view.level==='main')return flow.setViewport(hierarchyViewport(geometry,area.width,area.height),{duration:motionPolicy.zero});
    if(['main','guide','overview'].includes(state.view.level)){const badgeTargets=new Set(geometry.edges.filter(e=>e.bundle?.leader).flatMap(e=>state.result.links.filter(l=>l.id===e.id).map(l=>l.target))),fitGeometry={...geometry,nodes:geometry.nodes.map(n=>badgeTargets.has(n.id)?{...n,y:n.y-uiTokens.layout.headerReserve,height:n.height+uiTokens.layout.headerReserve}:n)},viewport=adaptiveViewport(fitGeometry,area.width,area.height);if(state.view.level==='guide'){const top=Math.min(...geometry.nodes.map(node=>node.y),...geometry.regions.map(region=>region.y));viewport.y=look.padding-top*viewport.zoom;}return flow.setViewport(viewport,{duration:motionPolicy.zero});}
    const minimum=state.view.entryId?0.9:state.view.level==='function'?0.76:0.84;
    const fit=Math.min((area.width-64)/bounds.width,(area.height-64)/bounds.height),z=Math.min(!runtime&&state.view.level==='main'?1.25:1,state.view.level==='main'?fit:Math.max(minimum,fit));
    const center=selected&&fit<minimum&&state.view.level!=='main'?{x:selected.x+selected.width/2,y:selected.y+selected.height/2}:{x:bounds.x+bounds.width/2,y:bounds.y+bounds.height/2};
    if(!selected&&fit<minimum&&state.view.level!=='main')center.y=bounds.y+(area.height/2-55)/z;
    return flow.setCenter(center.x,center.y,{zoom:z,duration:motionPolicy.zero});
  };
  fitRef.current=()=>{void focusReadable();};
  const priorInspector=useRef(view.inspector);
  useEffect(()=>{const opening=!!view.inspector&&!priorInspector.current;priorInspector.current=view.inspector;if(opening&&!runtime)userViewport.current=true;},[view.inspector,!!runtime]);
  useEffect(()=>{worker.current=new Worker(new URL('./layout.worker.ts',import.meta.url),{type:'module'});return()=>worker.current?.terminate();},[]);
  useEffect(()=>{
    if(!laneView||!worker.current)return;const requestId=++laneModelSequence.current,project=index.id;let active=true;
    const listener=(event:MessageEvent)=>{if(!active||event.data.kind!=='dependency-model'||event.data.requestId!==requestId||live.current.index.id!==project)return;if(event.data.error){setLayoutError(event.data.error);return;}if(host.current)host.current.dataset.laneModelMs=String(event.data.modelMs);setBusy(true);setLaneModel({key:laneModelKey,project,graph:event.data.graph});};
    worker.current.addEventListener('message',listener);const transferred=laneWorkerIndex.current===index?undefined:index;laneWorkerIndex.current=index;
    worker.current.postMessage({kind:'dependency-model',requestId,index:transferred,view});return()=>{active=false;worker.current?.removeEventListener('message',listener);};
  },[laneView,index,laneModelKey]);
  useEffect(()=>{
    let previous:{width:number;height:number}|undefined,frame=0;
    const observer=new ResizeObserver(([entry])=>{const next=entry.contentRect;
      if(previous&&(previous.width!==next.width||previous.height!==next.height)){cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{if(current.current.runtime)return;if(!userViewport.current)fitRef.current();else{const viewport=flow.getViewport(),node=flow.getNode(current.current.view.selected||current.current.view.focus||'');if(!node)return;const left=node.position.x*viewport.zoom+viewport.x,right=left+(node.measured?.width||node.width||0)*viewport.zoom,top=node.position.y*viewport.zoom+viewport.y,bottom=top+(node.measured?.height||node.height||0)*viewport.zoom,pad=look.padding,dx=left<pad?pad-left:right>next.width-pad?next.width-pad-right:0,dy=top<pad?pad-top:bottom>next.height-pad?next.height-pad-bottom:0;if(dx||dy)void flow.setViewport({...viewport,x:viewport.x+dx,y:viewport.y+dy},{duration:motionPolicy.zero});}});}
      previous={width:next.width,height:next.height};
    });observer.observe(host.current!.querySelector('.react-flow')||host.current!);return()=>{observer.disconnect();cancelAnimationFrame(frame);};
  },[flow]);
  useEffect(()=>{
    if(runtime||laneModelPending)return;
    const frontendContext=view.level==='overview'&&(view.filter==='frontend'||!index.files.length&&!!index.frontend?.modules.length)?index.id:undefined;
    const enteringFrontend=!!frontendContext&&lastFrontendLayout.current!==frontendContext;
    const scope=baseResult.dependencyScope,previousScope=lastDependencyScope.current;
    const scopeChanged=!!scope&&!!previousScope?.scope&&previousScope.index===index.id+index.createdAt&&previousScope.scope!==scope&&previousScope.camera===view.cameraRevision;
    lastDependencyScope.current={index:index.id+index.createdAt,scope,camera:view.cameraRevision};
    const epoch=motionEpoch.current,manualEpoch=manualViewportEpoch.current,explorationKey=view.exploration?`${view.exploration.domainId}:${view.exploration.stage}:${view.exploration.entryId||''}`:undefined,explorationChanged=lastExploration.current!==explorationKey;const id=++sequence.current,changed=lastKey.current!==key,restore=changed&&view.level!=='main'&&result.cards.some(c=>view.positions[c.id]);
    if(changed)userViewport.current=false;
    if(!runtime)setBusy(true);setLayoutError('');navigating.current=changed;
    const indexChanged=lastIndex.current!==index;lastIndex.current=index;
    const densityChanged=lastDensity.current!==view.density&&!changed;lastDensity.current=view.density;
    const candidates=flow.getNodes().filter(n=>result.cards.some(c=>c.id===n.id)),area=host.current!.getBoundingClientRect();
    const center=flow.screenToFlowPosition({x:area.left+area.width/2,y:area.top+area.height/2});
    const nearest=candidates.sort((a,b)=>Math.hypot(a.position.x-center.x,a.position.y-center.y)-Math.hypot(b.position.x-center.x,b.position.y-center.y))[0]?.id;
    const anchor=result.cards.some(c=>c.id===view.focus)?view.focus:result.cards.some(c=>c.id===view.selected)?view.selected:nearest;
    const retained=anchor&&view.positions[anchor]?{[anchor]:view.positions[anchor]}:{};
    let laneSaved:Record<string,Point>|undefined;
    if(laneView&&!candidates.length)try{const saved=JSON.parse(localStorage.getItem(lanePositionKey)||'null');if(saved?.version===1&&saved.orientation===laneOrientation)laneSaved=Object.fromEntries(Object.entries(saved.positions as Record<string,Point>).filter(([id,p])=>result.cards.some(c=>c.id===id)&&Number.isFinite(p.x)&&Number.isFinite(p.y)));}catch{}
    const positions=laneSaved|| (laneView&&freshLaneProjects.current.has(index.id)?{}:enteringFrontend?view.positions:view.level==='overview'&&!organize.current?{...view.positions,...Object.fromEntries(candidates.map(n=>[n.id,n.position]))}:runtimeRestoring.current&&runtimeRestore.current?runtimeRestore.current.positions:organize.current||densityChanged&&!view.exploration?retained:(indexChanged&&view.level!=='function')?{}:dragPositions.current||view.positions);organize.current=false;dragPositions.current=undefined;
    let skeletonPending=false;
    const commit=(event:MessageEvent)=>{
      if(event.data.id!==id||id!==sequence.current||current.current.key!==key)return;
      if(event.data.skeleton&&flow.getNodes().some(n=>result.cards.some(c=>c.id===n.id)))return;
      if(!event.data.skeleton)setBusy(false);
      if(event.data.error){setLayoutError(event.data.error);navigating.current=false;return;}
      if(event.data.skeleton){skeletonPending=true;if(host.current)host.current.dataset.laneSkeleton=JSON.stringify(event.data.snapshot.nodes.map((n:{id:string;x:number;y:number})=>[n.id,n.x,n.y]));}
      if(laneView&&host.current&&event.data.workerMs!==undefined)host.current.dataset.laneWorkerMs=String(event.data.workerMs);
      lastFrontendLayout.current=frontendContext;
      setDragging(false);
      const geometry=event.data.snapshot as LayoutSnapshot,state=current.current;
      setSnapshot(geometry);lastExploration.current=explorationKey;
      const built=state.result.cards.map(card=>{
        const n=geometry.nodes.find(n=>n.id===card.id)!;
        const focusAction=()=>{const s=current.current;if(card.dependency){if(card.kind==='group')s.onChange({expanded:s.view.expanded.includes(card.id)?s.view.expanded.filter(id=>id!==card.id):[...s.view.expanded,card.id]});else if(card.dependency.location)s.onSource(card.dependency.location,card.symbol?.id);}else if(card.entryPoint)onEntry?.(card.entryPoint);else if(card.kind==='service'||card.kind==='domain')s.onNavigate({level:'guide',focus:card.id});else if(card.kind==='resource'){const relations=s.result.links.filter(l=>l.target===card.id||l.source===card.id).flatMap(l=>l.relations);s.onChange({selected:card.id,relationSelection:undefined,inspector:relations.length?'relations':'details',relationIds:[...new Set(relations.map(r=>r.id))]});}else if(card.kind==='entry-group')s.onChange({selected:card.id,inspector:'details'});else if(card.kind==='group')s.onChange({expanded:[...new Set([...s.view.expanded,...card.members!])]});else if(card.kind==='file')s.onNavigate({level:'file',focus:card.id.slice(5)});else if(card.kind==='module')s.onNavigate({level:'module',focus:card.id.slice(7)});else if(card.symbol)s.onLocate(card.symbol.id);};
        return {id:card.id,type:'card',zIndex:card.kind==='service'?0:2,draggable:!card.ownerId,className:card.dependency?'dependency-flow-node':undefined,style:card.kind==='anchor'||card.kind==='service'?{pointerEvents:'none' as const}:undefined,position:{x:n.x,y:n.y},width:n.width,height:n.height,data:{...card,laneSkeleton:!!event.data.skeleton,source:(location:Location)=>current.current.onSource(location),ports:n.ports,selected:state.view.selected===card.id,related:false,detailLocation:card.dependency?.location||card.entryPoint?.location||(card.unit&&index.units?.find(unit=>unit.id===card.unit!.id)?.basis[0]?.location)||state.result.links.filter(l=>l.source===card.id||l.target===card.id).flatMap(l=>l.relations.flatMap(r=>r.locations))[0],details:()=>{const active=current.current;if(card.kind==='resource')focusAction();else if(card.kind==='group')active.onChange({expanded:active.view.expanded.includes(card.id)?active.view.expanded.filter(id=>id!==card.id):[...active.view.expanded,card.id]});else active.onChange({selected:card.id,inspector:'details'});},expanded:state.view.expanded.includes(card.id),focusAction,
          pick:(s:SymbolInfo,focus=false)=>{const active=current.current;focus?active.onLocate(s.id):active.onSource({file:s.file,range:s.selection},s.id);},
          openEntry:(entry:EntryPoint,target?:string)=>onEntry?.(entry,target),entryDetails:(entry:EntryPoint)=>current.current.onChange({selected:'entry-group:'+entry.group,inspector:'details'}),selectedCapability:state.view.exploration?.domainId||state.view.reading?.scope,capability:(id:string)=>current.current.onExplore(id),collapse:()=>current.current.onCollapse(),
          evidence:(ids:string[])=>current.current.onChange({inspector:'relations',relationIds:ids}),
          reveal:(ids:string[])=>current.current.onChange({expanded:[...new Set([...current.current.view.expanded,...ids])]}),
          expand:()=>{const active=current.current;if(card.frontend||card.foldedCards){active.onChange({expanded:active.view.expanded.includes(card.id)?active.view.expanded.filter(id=>id!==card.id):[...active.view.expanded,card.id]});}else if(card.dependency){active.onChange({expanded:active.view.expanded.includes(card.id)?active.view.expanded.filter(id=>id!==card.id):[...active.view.expanded,card.id]});}else if(card.capabilities){const expanded=active.view.expanded.includes(card.id);if(!expanded){const resources=new Set(active.result.links.filter(l=>l.source===card.id&&l.type==='DATA').map(l=>l.target));servicePositions.current.set(card.id,Object.fromEntries(Object.entries(active.view.positions).filter(([id])=>resources.has(id))));}active.onChange({expanded:expanded?active.view.expanded.filter(id=>id!==card.id):[...active.view.expanded,card.id],positions:expanded?{...active.view.positions,...servicePositions.current.get(card.id)}:active.view.positions});}else if(card.kind==='group')active.onChange({expanded:[...new Set([...active.view.expanded,...card.members!])]});else if(active.view.level!=='function')active.onNavigate({level:'function',focus:card.id});else active.onChange({expanded:active.view.expanded.includes(card.id)?active.view.expanded.filter(id=>id!==card.id):[...active.view.expanded,card.id]});}}};
      });
      setNodes(previous=>built.map(node=>{const old=previous.find(n=>n.id===node.id),ports=old&&JSON.stringify(old.data.ports)===JSON.stringify(node.data.ports)?old.data.ports:node.data.ports;return {...old,...node,measured:measured.current.get(node.id)||old?.measured,data:{...node.data,ports}};}));lastKey.current=key;
      if(event.data.skeleton)return;
      if(laneView)freshLaneProjects.current.delete(index.id);
      if(state.runtime){navigating.current=false;return;}
      state.onChange({positions:{...state.view.positions,...Object.fromEntries(geometry.nodes.map(n=>[n.id,{x:n.x,y:n.y}]))}});
      const frame=requestAnimationFrame(()=>requestAnimationFrame(()=>{
        if(id!==sequence.current||current.current.key!==key)return;
        const initialOverview=indexChanged&&['main','overview','guide'].includes(state.view.level)&&!state.view.selected&&!userViewport.current;
        const guideCamera=state.view.level==='main'&&state.view.guideToMain&&appliedGuideCamera.current!==state.view.guideToMain.token?state.view.guideToMain:undefined;
        if(guideCamera)appliedGuideCamera.current=guideCamera.token;
        const target=guideCamera&&geometry.nodes.find(n=>n.id===state.view.selected),owner=guideCamera&&geometry.nodes.find(n=>n.id===state.view.exploration?.serviceId),area=host.current!.getBoundingClientRect(),preferred=guideCamera?.viewport;
        const targetX=preferred&&target?Math.min(area.width-look.padding-target.width*preferred.zoom,Math.max(area.width*.3,owner?(target.x-owner.x)*preferred.zoom+look.padding:0)):0;
        const viewport=preferred&&target?{...preferred,x:targetX-target.x*preferred.zoom,y:Math.max(look.padding-target.y*preferred.zoom,Math.min(preferred.y,area.height-look.padding-(target.y+target.height)*preferred.zoom))}:preferred;
        const movement=state.runtime?Promise.resolve(true):runtimeRestoring.current&&runtimeRestore.current?flow.setViewport(runtimeRestore.current.viewport,{duration:motionPolicy.zero}):viewport?(manualEpoch!==manualViewportEpoch.current?Promise.resolve(true):flow.setViewport(viewport,{duration:motionPolicy.zero})):epoch!==motionEpoch.current?Promise.resolve(true):scopeChanged||explorationChanged&&!!state.view.exploration?focusReadable(geometry):changed?(restore?flow.setViewport(state.view.viewport,{duration:motionPolicy.zero}):focusReadable(geometry)):initialOverview?focusReadable(geometry):Promise.resolve(true);runtimeRestoring.current=false;
        void movement?.then(()=>{if(id!==sequence.current||current.current.key!==key)return;navigating.current=false;current.current.onChange({viewport:flow.getViewport()});});
      }));void frame;
    };
    const listener=(event:MessageEvent)=>{if(skeletonPending&&!event.data.skeleton)requestAnimationFrame(()=>requestAnimationFrame(()=>commit(event)));else commit(event);};
    worker.current?.addEventListener('message',listener);worker.current?.postMessage({id,cards:result.cards,links:result.links,positions,focus:anchor,level:view.level,laneOrientation});
    return()=>{sequence.current++;worker.current?.removeEventListener('message',listener);};
  },[result,key,revision,flow,laneModelPending]);
  useEffect(()=>{if(runtime)return;setTrace(true);const timer=setTimeout(()=>setTrace(false),1050);return()=>clearTimeout(timer);},[selectedEdge,view.selected,!!runtime]);
  const active=selectedEdge?undefined:view.selected;
  const path=selectedEdge?new Set<string>():readingPath(index,result.links.filter(l=>!l.context),view.entryId?(view.selected||view.focus):undefined);
  const related=new Set(result.links.filter(e=>e.source===active||e.target===active).flatMap(e=>[e.source,e.target]));
  const nodeCache=useRef(new Map<string,{signature:string;node:Node<CardData>}>());
  const handlers=useRef(new Map<string,{inspect:()=>void;capability:(id:string)=>void}>());
  let hierarchyOrder=0;const hierarchyStarts=new Map(result.cards.map(card=>{const start=hierarchyOrder;hierarchyOrder+=card.hierarchy?.groups?.reduce((n,g)=>n+g.modules.length,0)||(card.hierarchy?.module?1:0);return[card.id,start];}));
  const hierarchyLinkDelay=Math.max(parseFloat(uiTokens.viewMotion.lineDelay),Math.max(0,hierarchyOrder-1)*uiTokens.hierarchy.entryStep+uiTokens.hierarchy.entryDuration)+'ms';
  const laneEntries=new Map([...result.cards].sort((a,b)=>Object.keys(laneNames).indexOf(a.dependencyLane?.id||'')-Object.keys(laneNames).indexOf(b.dependencyLane?.id||'')||(a.dependencyLane?.order||0)-(b.dependencyLane?.order||0)).map((card,i)=>[card.id,i]));
  const renderedNodes=nodes.map(saved=>{
    const card=result.cards.find(card=>card.id===saved.id),n={...saved,data:{...saved.data,...card,dependencyEnterOrder:laneEntries.get(saved.id),hierarchyStart:hierarchyStarts.get(saved.id),hierarchySelected:guideModule?.id,selectModule:(id:string)=>current.current.onChange({guideModuleId:id,selected:id,entryId:undefined,inspector:undefined}),runtimeExpansion:card?.runtimeExpansion,inline:card?.inline,backendTarget:card?.unit?.kind==='frontend'?(target?:import('../shared/frontend-links').FrontendTarget)=>{if(live.current.index.id!==index.id||live.current.index.contextId!==index.contextId)return;const state=current.current,choices={...state.view.frontendTargets};if(target)choices[card.unit!.id]=target;else delete choices[card.unit!.id];state.onChange({frontendTargets:choices});void window.codeleader.setFrontendTargets?.(choices,index.id,index.contextId).catch(()=>{});}:undefined}};
    const call=n.data.runtimeCall&&runtime?.state?.model.byCall[n.data.runtimeCall],options=projection?.calls.get(n.id)||[];
    const inspected=call||options.find(c=>c.id===currentCall)||options.find(c=>runtime?.state&&runtime.state.model.positions[c.enterId]<=runtime.state.model.positions[runtime.state.cursor])||options[0];
    handlers.current.set(n.id,{inspect:()=>current.current.runtime?.inspect(inspected?.id||n.id),capability:id=>current.current.runtime?.explore(displayDomain===id?undefined:id)});
    const className=runtime?`${projection?.active.has(n.id)||n.id===browserNodeId?'runtime-path-node':'runtime-background'} ${projection?.current===n.id?'runtime-current-node':''} ${projection?.current===n.id&&runtime.state?.model.steps[runtime.state.model.positions[runtime.state.cursor]].exception?'has-error':''}`:n.className;
    const selected=runtime?inspected?.id===runtime.state?.inspected:view.selected===n.id;
    const signature=JSON.stringify([n.position,n.width,n.height,n.data,className,selected,related.has(n.id),n.data.capabilities?.some(c=>c.id===runtime?.expandedDomain)?runtime?.expandedDomain:undefined,!!n.data.runtimeCall&&runtime?.state?.breakpoints.includes(n.data.runtimeCall),n.id===browserNodeId?runtime?.operation:undefined,projection?.current===n.id?runtime?.state?.cursor:undefined,n.data.capabilities?.map(c=>[c.id,projection?.domains.has(c.id),projection?.currentDomain===c.id]),n.data.runtimeExpansion?.calls.map(id=>[id,runtime?.state&&callVisibility(runtime.state,id).reached,runtime?.state&&callVisibility(runtime.state,id).returned,id===currentCall])]);
    const previous=nodeCache.current.get(n.id);if(previous?.signature===signature)return previous.node;
    const node={...n,className,data:{...n.data,visualRole:cardRole(n.data,index),runtime,projection,selected,related:related.has(n.id),inspectRuntime:runtime?()=>handlers.current.get(n.id)?.inspect():undefined,focusAction:runtime?()=>handlers.current.get(n.id)?.inspect():n.data.focusAction,capability:runtime?(id:string)=>handlers.current.get(n.id)?.capability(id):n.data.capability,selectedCapability:runtime?.expandedDomain||n.data.selectedCapability}};
    nodeCache.current.set(n.id,{signature,node});return node;
  });
  for(const id of nodeCache.current.keys())if(!nodes.some(n=>n.id===id)){nodeCache.current.delete(id);handlers.current.delete(id);}
  const edgeCache=useRef(new Map<string,{signature:string;edge:Edge}>());
  const browserCall=runtime?.state?.model.calls.find(call=>call.kind==='browser'),browserTargets=new Set((browserCall?.children||[]).flatMap(id=>[...projection?.calls||[]].filter(([,calls])=>calls.some(call=>call.id===id)).map(([owner])=>owner)));
  const laneMain=laneView?laneMainLinks(result.cards,result.links):new Set<string>();
  const edges:Edge[]=snapshot?result.links.flatMap<Edge>(link=>{
    const e=snapshot.edges.find(e=>e.id===link.id);if(!e)return [];
    if(laneView){const source=result.cards.find(c=>c.id===link.source)!,target=result.cards.find(c=>c.id===link.target)!,main=laneMain.has(link.id),common=!!(source.dependencyLane?.common||target.dependencyLane?.common),color=uiTokens.lanes[(source.dependencyLane?.id||'common') as 'entry'|'business'|'data'|'object'|'common'];return[{id:link.id,type:'routed',source:link.source,target:link.target,sourceHandle:e.sourcePort,targetHandle:e.targetPort,className:`dependency-lane-edge ${main?'is-main':'is-auxiliary'} ${common?'is-common':''}`,style:laneEdgeStyle(link,main,common,color),data:{...e,temporary:dragging,lane:{points:e.points,main,common,kind:primaryKind(link),color},inspect:()=>selectLink(link.id)}}];}
    if(runtime&&link.id.startsWith('runtime:')&&!projection?.edges.has(link.id)&&!(link.source===browserNodeId&&browserTargets.has(link.target)))return [];const played=!!projection?.edges.has(link.id),runtimeCurrent=projection?.currentEdge===link.id||currentCall===browserCall?.id&&link.source===browserNodeId&&browserTargets.has(link.target);const highlighted=runtime?played:path.has(link.id)||link.source===active||link.target===active||selectedEdge===link.id;
    const baseColor=({HTTP:uiTokens.color["compat-024"],DATA:uiTokens.color["success"],READS:uiTokens.color["success"],WRITES:uiTokens.color["compat-191"],EXTENDS:uiTokens.color["compat-432"],IMPLEMENTS:uiTokens.color["compat-432"],IMPORTS:uiTokens.color["compat-433"]} as Record<string,string>)[link.type]||uiTokens.color["compat-434"];
    const dependencyColor=view.level==='overview'?result.cards.find(c=>c.id===link.source)?.dependency?.color:undefined;
    const semanticColor=dependencyColor?({receive:'var(--secondary)',business:'var(--accent)',data:'var(--path)',common:'var(--muted)'} as Record<string,string>)[dependencyColor]:undefined;
    const color=runtime?(runtimeCurrent&&runtime.state?uiTokens.color[`phase-${readingStage(runtime.state,receivers)}`]:uiTokens.color[(['DATA','READS','WRITES'].includes(link.type)?'phase-data':link.source===browserNodeId?'phase-receive':'phase-business')]):semanticColor|| (highlighted?(link.type==='CALLS'?uiTokens.color["path"]:baseColor):active?uiTokens.color["compat-435"]:baseColor);
    const resourceStyle=hierarchyView&&result.cards.find(c=>c.id===link.target)?.hierarchy?.resource;
    const dash=runtime?(runtimeCurrent||projection?.asyncEdges.has(link.id)?'6 5':undefined):resourceStyle?(resourceStyle.configuredOnly?'6 5':undefined):['IMPLEMENTS','MAPS'].includes(link.type)?'8 5':link.type==='IMPORTS'?'2 4 8 4':link.optional?'6 5':undefined;
    const bundle=!runtime&&e.bundle?.members.every(id=>result.links.some(l=>l.id===id))?e.bundle:undefined;
    const inspect=()=>{if(!bundle){selectLink(link.id);return;}const bounds=host.current!.getBoundingClientRect(),point=flow.flowToScreenPosition(e.label);setEdgeChoices({ids:bundle.members,x:Math.max(0,Math.min(bounds.width-dependencyPolicy.thresholds.memberMenuWidth.value,point.x-bounds.left)),y:Math.max(0,Math.min(bounds.height-dependencyPolicy.thresholds.memberMenuHeight.value,point.y-bounds.top))});};
    const dataCount=new Set(link.relations.filter(r=>r.type==='READS'||r.type==='WRITES').flatMap(r=>r.locations.map(l=>r.type+':'+l.file+':'+JSON.stringify(l.range)))).size;
    return [{id:link.id,type:'routed',source:link.source,target:link.target,sourceHandle:e.sourcePort,targetHandle:e.targetPort,label:bundle?`被 ${bundle.users} 个使用`:link.label,className:`relation-${link.type} ${trace&&motion&&(selectedEdge===link.id||path.has(link.id))?'reading-edge':''}`,markerStart:runtimeCurrent&&projection?.returning?{type:MarkerType.ArrowClosed,width:16,height:16,color}:undefined,markerEnd:runtimeCurrent&&projection?.returning?undefined:{type:MarkerType.ArrowClosed,width:16,height:16,color},style:{stroke:color,strokeWidth:runtime?(runtimeCurrent?2.3:played?1.7:1):highlighted?2.3:link.type==='DATA'&&!link.optional?uiTokens.orientation.dataWidths.find(b=>dataCount>=b.minimum)!.width:link.type==='IMPORTS'?1.2:1.7,strokeDasharray:dash,opacity:runtime?runtime.operation?.pending?motionPolicy.edgeFuture:runtimeCurrent?motionPolicy.opacityCurrent:played?motionPolicy.edgePast:motionPolicy.edgeFuture:selectedEdge&&selectedEdge!==link.id?.12:link.context&&!highlighted?.35:1,animationDelay:path.has(link.id)?`${[...path].indexOf(link.id)*motionMs('entranceGap')}ms`:undefined},data:{...e,sourceId:link.source,targetId:link.target,contextFade:hierarchyView&&view.level==='main',frontendBand:hierarchyView&&view.level==='main'&&!!result.cards.find(c=>c.id===link.source)?.frontend,tooltip:bundle?bundle.members.map(id=>{const member=result.links.find(l=>l.id===id)!;return `${result.cards.find(c=>c.id===member.source)?.name} → ${result.cards.find(c=>c.id===member.target)?.name} · ${member.label}`;}).join('\n'):link.tooltip,status:link.status,temporary:dragging,active:highlighted,rule:false,markerId:['EXTENDS','IMPLEMENTS'].includes(link.type)?'type-triangle':undefined,runtimePlaying:runtimeCurrent&&runtime?.state?.playing&&motion&&!runtime.operation?.pending,operationPreview:runtimeCurrent&&!runtime?.operation?.pending?(link.source===browserNodeId?runtime?.operation?.preview:link.label):undefined,runtimeReturning:runtimeCurrent?projection?.returning:undefined,runtimeStep:runtimeCurrent?runtime?.state?.cursor:undefined,showLabel:false,inspect}}];
  }):[];
  commands.current={focus:()=>{void focusReadable();},overview:()=>{if(runtime)runtimeFit.overview();else void focusReadable();},pause:runtimeFit.pause,playback:playing=>host.current?.dispatchEvent(new CustomEvent('motion-playback',{detail:{playing}}))};
  const stableNodes=useStableList(renderedNodes);
  const stableEdges=useStableList(edges.map(edge=>{const signature=JSON.stringify(edge),old=edgeCache.current.get(edge.id);if(old?.signature===signature)return old.edge;edgeCache.current.set(edge.id,{signature,edge});return edge;}));
  for(const id of edgeCache.current.keys())if(!edges.some(edge=>edge.id===id))edgeCache.current.delete(id);
  const viewportControls=<CameraControls commands={commands} motion={motion}/>;
  const actions=<>
    <button onClick={event=>{const menu=event.currentTarget.closest('details');if(menu)menu.open=false;onChange({inspector:'connections'});}}>选择 / 筛选关系</button>
    {(view.level==='overview'||view.level==='module'||view.level==='class')&&<label>关系 <select aria-label="关系类型" value={view.relationFilter||'imports'} onChange={e=>onChange({relationFilter:e.target.value as ViewState['relationFilter']})}><option value="imports">导入 / 依赖</option><option value="calls">方法调用</option><option value="types">继承 / 实现</option><option value="all">全部结构关系</option></select></label>}
    
    <label><input type="checkbox" checked={!!view.showAll} onChange={e=>onChange({showAll:e.target.checked})}/>显示全部支线 / 辅助入口</label>
    {view.level==='function'&&<div className="direction-tabs">{(['callers','both','callees'] as const).map(d=><button key={d} className={(view.direction||'both')===d?'active':''} onClick={()=>onNavigate({level:'function',focus:view.focus,direction:d})}>{d==='callers'?'调用者':d==='callees'?'被调用者':'双向'}</button>)}</div>}
    {viewportControls}
    <button title="基于当前关系重新整理位置" onClick={()=>{organize.current=true;setRevision(r=>r+1);}}><RotateCcw size={14}/>整理布局</button>
    {view.expanded.length>0&&<button onClick={()=>onChange({expanded:[]})}>收起扩展</button>}
    <label><input type="checkbox" checked={!!view.showTests} onChange={e=>onChange({showTests:e.target.checked})}/>显示测试区域</label>
  </>;
  return <div ref={host} data-dependency-lanes={laneView?laneOrientation:undefined} data-hierarchy-view={hierarchyView?view.level:undefined} data-guide-panel={!!guideModule} className={`graph-canvas ${motion?'motion':''} ${dragging?'is-dragging':''}`} data-adaptive={!runtime} data-density={runtime?undefined:graphDensity(result.cards)} style={{'--hierarchy-link-delay':hierarchyLinkDelay,...(!runtime?{'--read-scale':1}:{}),'--layout-current-color':runtime?.state?uiTokens.color[`phase-${readingStage(runtime.state,receivers)}`]:uiTokens.color.accent,'--dependency-transition':dependencyPolicy.thresholds.transitionMs.value+'ms','--dependency-menu-width':dependencyPolicy.thresholds.memberMenuWidth.value+'px','--dependency-menu-height':dependencyPolicy.thresholds.memberMenuHeight.value+'px'} as React.CSSProperties} data-testid="graph" data-layout-version={snapshot?.version} data-layout-busy={loadingView} onClickCapture={event=>{
    if(!(event.target as Element).closest('.react-flow__edge')||(event.target as Element).closest('.edge-label')||!snapshot)return;
    event.stopPropagation();const point=flow.screenToFlowPosition({x:event.clientX,y:event.clientY}),ids=nearestEdges(snapshot,point,12/zoom).filter(id=>!laneView||Number(getComputedStyle(host.current!.querySelector(`.react-flow__edge[data-id="${CSS.escape(id)}"] .react-flow__edge-path`)!).opacity)>0);if(!ids.length)return;
    if(ids.length===1)selectLink(ids[0]);else{const bounds=host.current!.getBoundingClientRect();setEdgeChoices({ids,x:event.clientX-bounds.left,y:event.clientY-bounds.top});}
  }}>
    <ReactFlow nodes={stableNodes} edges={stableEdges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} onlyRenderVisibleElements={renderedNodes.length>uiTokens.zoom.visibleThreshold} nodesConnectable={false} edgesReconnectable={false} deleteKeyCode={null} minZoom={.15} maxZoom={hierarchyView?uiTokens.hierarchy.maximumZoom:1.8}
      onNodesChange={changes=>{for(const change of changes)if(change.type==='dimensions'&&change.dimensions)measured.current.set(change.id,change.dimensions);const edits=changes.filter(change=>change.type!=='dimensions'&&change.type!=='select');if(edits.length)setNodes(old=>applyNodeChanges(edits,old));}}
      onNodeClick={(_event,node)=>{const data=node.data as CardData;if(data.frontend||data.foldedCards){data.expand();return;}if(!runtime&&data.dependency){if(data.kind==='group')data.expand();else data.focusAction();return;}if(runtime){if(data.kind==='browser')runtime.browser();else data.inspectRuntime?.();return;}if(data.kind==='resource')data.focusAction();else if(data.entryPoint)onEntry?.(data.entryPoint);else if(data.kind==='domain')onNavigate({level:'guide',focus:data.id});else if(data.symbol&&data.kind==='symbol')onSource({file:data.symbol.file,range:data.symbol.selection},node.id);else onChange({selected:node.id,inspector:'details'});}}
      onNodeDoubleClick={(_event,node)=>{if(!runtime)(node.data as CardData).focusAction();}}
      
      onNodeDragStart={()=>{if(runtime)runtimeFit.pause();sequence.current++;setDragging(true);}}
      onNodeDragStop={()=>{dragPositions.current=Object.fromEntries(flow.getNodes().map(n=>[n.id,n.position]));if(runtime)runtimePositions.current=dragPositions.current;else{if(laneView)try{localStorage.setItem(lanePositionKey,JSON.stringify({version:1,orientation:laneOrientation,positions:dragPositions.current}));}catch{}onChange({positions:dragPositions.current});}setRevision(r=>r+1);}}
      onEdgeClick={(_e,e)=>(e.data as {inspect:()=>void}).inspect()} onEdgeMouseEnter={(_e,e)=>host.current?.querySelector(`[data-id="${CSS.escape(e.id)}"]`)?.classList.add('is-pointer-hover')} onEdgeMouseLeave={(_e,e)=>host.current?.querySelector(`[data-id="${CSS.escape(e.id)}"]`)?.classList.remove('is-pointer-hover')}
      onPaneClick={()=>onChange({selected:undefined,relationSelection:undefined})}
      onMoveStart={event=>{if(event){if(runtime)runtimeFit.pause();motionEpoch.current++;manualViewportEpoch.current++;userViewport.current=true;}}} onMove={()=>{}} onMoveEnd={(event,viewport)=>{if(wheelZoom.current)return;if(event)userViewport.current=true;if(!event&&(navigating.current||lastKey.current!==current.current.key))return;if(runtime){runtime.viewport(viewport);return;}onChange({viewport});}}
      defaultViewport={view.viewport} proOptions={{hideAttribution:false}}>
      <div className="canvas-dots" aria-hidden="true"/>
      <svg className="relation-marker-defs"><defs><marker id="type-triangle" viewBox="0 0 12 12" refX="11" refY="6" markerWidth="12" markerHeight="12" orient="auto"><path d="M1 1 L11 6 L1 11 Z" fill={uiTokens.color["compat-437"]} stroke={uiTokens.color["compat-432"]} strokeWidth="1.4"/></marker></defs></svg>
      <ViewportPortal>{!runtime&&snapshot?.edges.filter(e=>e.bundle?.leader&&e.bundle.members.every(id=>result.links.some(l=>l.id===id))).map(edge=>{const link=result.links.find(l=>l.id===edge.id)!,node=snapshot.nodes.find(n=>n.id===link.target)!;return <button key={edge.bundle!.id} className="edge-label dependency-bundle-label nodrag nopan" data-bundle-id={edge.bundle!.id} title={edge.bundle!.members.map(id=>{const member=result.links.find(l=>l.id===id)!;return `${result.cards.find(c=>c.id===member.source)?.name} → ${node.id===link.target?result.cards.find(c=>c.id===link.target)?.name:''} · ${member.label}`;}).join('\n')} style={{transform:`translate(-50%, -100%) translate(${node.x+node.width/2}px,${node.y-dependencyPolicy.thresholds.channelGap.value}px)`}} onClick={event=>{event.stopPropagation();(edges.find(e=>e.id===edge.id)!.data as {inspect:()=>void}).inspect();}}>被 {edge.bundle!.users} 个使用</button>;})}{snapshot?.junctions?.map((p,i)=><i key={'junction'+i} className="route-junction" style={{position:'absolute',left:p.x,top:p.y}}/>)}{snapshot?.regions.map(r=><div key={r.id} className={`graph-region ${r.id.startsWith('无已解析')?'unconnected':''}`} style={{position:'absolute',left:0,top:0,width:r.width,height:r.height,transform:`translate(${r.x}px,${r.y}px)`}}><span>{r.label}</span></div>)}</ViewportPortal>
      {hierarchyView&&view.level==='main'&&<EdgeLabelRenderer><HierarchyHoverBand/></EdgeLabelRenderer>}
      {!runtime&&view.exploration?.stage==='chain'&&view.exploration.entryId&&(()=>{const entry=index.entries?.find(e=>e.id===view.exploration?.entryId);return entry?.symbolId&&result.cards.some(c=>c.id===entry.symbolId)?<EdgeLabelRenderer><EntryConnector host={host} entryId={entry.id} symbolId={entry.symbolId} snapshot={snapshot}/></EdgeLabelRenderer>:null;})()}
    </ReactFlow>
    {loadingView&&<div className="orientation-loading" role="status"><i/><i/><span>{layoutError?'暂时没能整理好，请重新打开视图':'正在整理布局…'}</span><i/></div>}
    {guideModule&&<HierarchyInterfaces module={guideModule} index={index} selectedId={view.entryId} onEntry={entry=>onEntry?.(entry)} onSource={onSource} onInspect={entry=>onChange({guideModuleId:guideModule.id,selected:entry.symbolId||entry.id,entryId:entry.id,inspector:'details',source:entry.location})}/>}
    {!runtime&&<TitlebarTools>{toolbar?toolbar(actions,viewportControls):actions}</TitlebarTools>}
    {!runtime&&view.level==='overview'&&<ContextTools><DependencyScope omitted={result.omitted} frontend={view.filter==='frontend'||!index.files.length} view={{...view,dependencyScope:baseResult.dependencyScope}} onChange={onChange}/></ContextTools>}
    {edgeChoices&&<div className="edge-choices" style={{left:edgeChoices.x,top:edgeChoices.y}}><strong>选择此处关系</strong>{edgeChoices.ids.map(id=>{const link=result.links.find(l=>l.id===id)!;return <button key={id} onClick={()=>selectLink(id)}>{result.cards.find(c=>c.id===link.source)?.name} → {result.cards.find(c=>c.id===link.target)?.name} · {link.label}</button>;})}<button onClick={()=>setEdgeChoices(undefined)}>取消</button></div>}
    {!runtime&&view.level==='function'&&view.entryId&&result.cards.length===1&&<div className="leaf-reader"><strong>{result.cards[0].unknownRelations?.length?'后续关系待确认，请查看卡片中的来源':result.cards[0].summary||'当前方法没有已定位的项目内下游'}</strong><button onClick={()=>onNavigate({level:'guide',focus:result.cards[0].serviceId})}>返回接口列表</button>{recommendations(index).filter(r=>r.score>0).slice(0,2).map(r=><button key={r.entry.id} onClick={()=>onEntry?.(r.entry)}>阅读 {httpRouteLabel(r.entry.name)}</button>)}</div>}
    {!runtime&&busy&&<div className="layout-indicator">正在整理布局…</div>}{layoutError&&<div className="graph-budget" role="alert">{layoutError}</div>}{result.omitted>0&&view.level!=='overview'&&<div className="graph-budget">{`另有 ${result.omitted} 条关系，请进一步聚焦`}</div>}
    {dragging&&<div className="routing-hint">{wording('dragConnections')}</div>}
    {laneView&&<SinglePageState index={index} cards={result.cards} onNavigate={onNavigate}/>}
    {!runtime&&<GraphAbsence index={index} view={view} empty={!result.cards.length}/>}
  </div>;
}
const Canvas=memo(Inner,(a,b)=>{
  if(!a.runtime||!b.runtime)return false;
  if(a.index!==b.index||a.motion!==b.motion)return false;
  const keys=['level','focus','filter','expanded','direction','showTests','entryId','showAll','relationFilter','fullDependencies','dependencyScope','dependencyEntryId','reading','relationSelection','exploration','cameraRevision','locateRequest'] as const;
  if(keys.some(key=>a.view[key]!==b.view[key]))return false;
  const x=a.runtime,y=b.runtime,s=x.state,t=y.state;
  if(s&&!t&&x.record?.id===y.record?.id)return true;
  const browserOnly=!!s&&!!t&&!x.expandedDomain&&!y.expandedDomain&&s.model.positions[s.cursor]===0&&t.model.positions[t.cursor]===0;
  return x.record?.id===y.record?.id&&x.expandedDomain===y.expandedDomain&&x.collapseAuto===y.collapseAuto&&x.layoutKey===y.layoutKey&&x.walkthroughInset===y.walkthroughInset&&JSON.stringify(x.operation)===JSON.stringify(y.operation)&&s?.model.key===t?.model.key&&(browserOnly||s?.model.fingerprint===t?.model.fingerprint)&&s?.cursor===t?.cursor&&s?.inspected===t?.inspected&&s?.speed===t?.speed&&s?.timing===t?.timing&&s?.follow===t?.follow&&s?.display===t?.display&&JSON.stringify(s?.breakpoints)===JSON.stringify(t?.breakpoints);
});
function CameraControls({commands,motion}:{commands:RefObject<CameraCommands>;motion:boolean}){
  const flow=useReactFlow(),store=useStoreApi(),value=useRef<HTMLSpanElement>(null);
  useLayoutEffect(()=>{const update=()=>{const text=Math.round(store.getState().transform[2]*100)+'%';if(value.current&&value.current.textContent!==text)value.current.textContent=text;};update();return store.subscribe(update);},[store]);
  return <div className="graph-controls"><button title="放大" onClick={()=>{commands.current.pause();void flow.zoomIn({duration:motion?motionMs('normal'):0});}}><Plus size={17}/></button><button title="缩小" onClick={()=>{commands.current.pause();void flow.zoomOut({duration:motion?motionMs('normal'):0});}}><Minus size={17}/></button><span ref={value} className="zoom-value"/><button title="聚焦可读" onClick={()=>commands.current.focus()}><Crosshair size={16}/>聚焦</button><button title="查看全部" onClick={()=>commands.current.overview()}><Maximize size={16}/>全部</button></div>;
}
export default function Graph(props:Props){
  const live=useRef(props),commands=useRef<CameraCommands>({focus:()=>{},overview:()=>{},pause:()=>{}});
  if(!live.current.runtime?.state||props.runtime?.state||!props.runtime)live.current=props;
  useLayoutEffect(()=>{commands.current.playback?.(!!props.runtime?.state?.playing);},[props.runtime?.state?.playing,props.runtime?.state?.cursor]);
  return <ModuleTooltipProvider><ReactFlowProvider><Canvas {...props} live={live} commands={commands}/>{props.runtime&&<TitlebarTools>{props.toolbar?.(null,<CameraControls commands={commands} motion={props.motion}/>)}</TitlebarTools>}</ReactFlowProvider></ModuleTooltipProvider>;
}
function TitlebarTools({children}:{children:ReactNode}){
  const [host,setHost]=useState<HTMLElement|null>(null);
  useEffect(()=>setHost(document.getElementById('titlebar-content')),[]);
  return host?createPortal(<div className="graph-toolbar titlebar-toolbar" onKeyDown={event=>{if(event.key===' ')event.stopPropagation();}}>{children}</div>,host):null;
}
function ContextTools({children}:{children:ReactNode}){const [host,setHost]=useState<HTMLElement|null>(null);useEffect(()=>setHost(document.getElementById('view-context-controls')),[]);return host?createPortal(children,host):null;}
