import {useEffect,useMemo,useRef,useState}from'react';
import {ChevronLeft,ChevronRight,ImageOff,Keyboard,ShieldOff,Layers}from'lucide-react';
import type {BrowserOperation,BrowserRequest,ExecutionSession}from'../shared/execution';
import {operationNumber,relativeOperation}from'../runtime/operation-evidence';
import {primaryRequest,numberedOperations,backgroundRequests,operationRequests}from'../runtime/operation-flow';
import {replayFingerprint}from'../runtime/replay';
type Props={session:ExecutionSession;selected?:string;requestId:string;hidden:boolean;following?:boolean;requestReveal?:number;onSelect:(operation:BrowserOperation,request?:BrowserRequest,pin?:boolean)=>void;onBackground:(request:BrowserRequest)=>void;};
function Thumbnail({operation,sessionId,projectId,hidden}:{operation:BrowserOperation;sessionId:string;projectId:string;hidden:boolean}){
 const [url,setUrl]=useState<string>();
 useEffect(()=>{let active=true;setUrl(undefined);if(!hidden&&operation.thumbnail?.status==='saved')void window.codeleader.execution.forProject(projectId,sessionId).thumbnail(operation.id).then(value=>{if(active)setUrl(value);}).catch(()=>{});return()=>{active=false;};},[sessionId,operation.id,operation.thumbnail?.name,hidden]);
 const reason=hidden?'屏幕内容已隐藏':operation.thumbnail?.status==='disabled'?'局部图片已关闭':operation.click?'没有这次点击的图片':'没有点击图片';
 return !hidden&&url?<img src={url} alt="点击附近的局部屏幕内容"/>:<span className="operation-thumb-placeholder" title={reason} role="img" aria-label={reason}>{hidden?<ShieldOff size={17}/>:operation.click?<ImageOff size={17}/>:<Keyboard size={17}/>}</span>;
}
export default function OperationStrip({session,selected,requestId,hidden,following=false,requestReveal=0,onSelect,onBackground}:Props){
 const list=useRef<HTMLDivElement>(null),operations=useMemo(()=>numberedOperations(session),[session]),background=useMemo(()=>backgroundRequests(session),[session]);
 const choices=useRef(new Map<string,{key:string;requestId?:string}>());
 const mainRequests=useMemo(()=>{
  const result=new Map<string,BrowserRequest|undefined>();
  for(const operation of operations){const requests=operationRequests(session,operation.id),traces=new Set(requests.map(r=>r.traceId)),extra=new Set(requests.flatMap(r=>r.afterResponse?.calls.map(c=>c.id)||[]));
   const topology=session.spans.filter(s=>traces.has(s.traceId)||extra.has(s.traceId+':'+s.spanId)).map(s=>[s.traceId,s.spanId,s.parentSpanId,s.symbolId,s.entityId,s.versionMatch,s.kind,s.links,s.attributes]);
   const key=JSON.stringify([session.id,session.sourceVersion,session.operationVersion,requests.map(r=>[r.id,r.start,r.method,r.url,replayFingerprint(r,session.spans)]),topology,session.requests.filter(r=>traces.has(r.traceId)).map(r=>[r.traceId,r.spanId])]);
   const old=choices.current.get(operation.id),request=old?.key===key?requests.find(r=>r.id===old.requestId):primaryRequest(session,operation.id).request;
   choices.current.set(operation.id,{key,requestId:request?.id});result.set(operation.id,request);
  }
  for(const id of choices.current.keys())if(!result.has(id))choices.current.delete(id);
  return result;
 },[session,operations]);
 const [labelPreview,setLabelPreview]=useState<string>(),[expanded,setExpanded]=useState<string>(),[edges,setEdges]=useState({left:false,right:false});
 const reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches||!!list.current?.closest('.reduce-motion');
 useEffect(()=>setExpanded(undefined),[session.id]);
 useEffect(()=>{list.current?.querySelector<HTMLElement>('[aria-current=true]')?.scrollIntoView({block:'nearest',inline:'nearest',behavior:reduced()?'auto':'smooth'});},[selected,requestId,following]);
 useEffect(()=>{if(requestReveal&&selected)setExpanded(selected);},[requestReveal]);
 useEffect(()=>{const area=list.current;if(!area)return;const update=()=>setEdges({left:area.scrollLeft>2,right:area.scrollLeft+area.clientWidth<area.scrollWidth-2}),observer=new ResizeObserver(update);observer.observe(area);area.addEventListener('scroll',update);update();return()=>{observer.disconnect();area.removeEventListener('scroll',update);};},[operations.length,background.length,session.id]);
 const scroll=(direction:number)=>list.current?.scrollBy({left:direction*308,behavior:reduced()?'auto':'smooth'});
 const backgroundSelected=background.some(request=>request.id===requestId),operation=operations.find(operation=>operation.id===expanded),requests=expanded==='background'?background:operation?operationRequests(session,operation.id):[];
 return <section className="operation-strip" aria-label="操作历史"><div className="operation-history-row"><button className="operation-scroll-button" aria-label="较早的操作" disabled={!edges.left} onClick={()=>scroll(-1)}><ChevronLeft size={16}/></button><div className={`operation-thumbnails ${edges.left?'has-before':''} ${edges.right?'has-after':''}`} ref={list}>{operations.map(operation=>{
  const requests=operationRequests(session,operation.id),number=operationNumber(operations,operation),active=selected===operation.id,time=operation.observedAt?new Date(operation.observedAt).toLocaleTimeString():'';
  const main=requests.find(request=>request.id===requestId)||mainRequests.get(operation.id)!,identity=`${main.method} ${new URL(main.url).pathname}`,relative=relativeOperation(operation,Date.now())||(session.historical?'历史':'时间未记录');
  const details=[operation.label,time,...requests.slice(0,5).map(request=>`${request.method} ${new URL(request.url).pathname}`)].filter(Boolean).join('\n');
  return <div className="operation-item" key={operation.id}><button className="operation-tile" aria-label={`操作 ${number} · ${operation.label}`} aria-current={active?'true':undefined} title={details} onFocus={()=>setLabelPreview(identity)} onBlur={()=>setLabelPreview(undefined)} onPointerEnter={()=>setLabelPreview(identity)} onPointerLeave={()=>setLabelPreview(undefined)} onClick={()=>{onSelect(operation);setExpanded(undefined);}}><span className="operation-image"><Thumbnail operation={operation} sessionId={session.id} projectId={session.projectId} hidden={hidden}/></span><span className="operation-tile-text"><span className="operation-tile-identity"><span className="operation-number">{number}</span><span className="operation-tile-label">{identity}</span></span><span className="operation-tile-time">{relative}</span></span></button>{requests.length>1&&<button className="operation-requests-toggle" aria-label={`操作 ${number} 另有 ${requests.length-1} 个请求`} title={`另有 ${requests.length-1} 个请求`} aria-expanded={expanded===operation.id} onClick={()=>{if(!active)onSelect(operation);setExpanded(value=>value===operation.id?undefined:operation.id);}}><Layers size={11}/>+{requests.length-1}</button>}</div>;
 })}{background.length>0&&<div className="operation-item operation-background"><button className="operation-tile operation-background-toggle" aria-current={backgroundSelected?'true':undefined} aria-expanded={expanded==='background'} onClick={()=>setExpanded(value=>value==='background'?undefined:'background')}><Layers size={18}/><span>其他请求 {background.length}</span></button></div>}{!operations.length&&!background.length&&<span className="operation-strip-empty">等待页面操作</span>}</div><button className="operation-scroll-button" aria-label="较新的操作" disabled={!edges.right} onClick={()=>scroll(1)}><ChevronRight size={16}/></button></div>{labelPreview&&<div className="operation-label-preview" role="tooltip">{labelPreview}</div>}{requests.length>0&&<div className="operation-request-options" aria-label={expanded==='background'?'其他请求':'本操作的请求'}><header><strong>{expanded==='background'?`其他请求 ${background.length}`:operation?.label}</strong><button aria-label="关闭请求列表" onClick={()=>setExpanded(undefined)}>×</button></header>{requests.map(request=><button key={request.id} aria-current={request.id===requestId?'true':undefined} onClick={()=>{if(expanded==='background')onBackground(request);else onSelect(operation!,request,true);setExpanded(undefined);}}><span>{request.method} {new URL(request.url).pathname}</span><small>{request.id===requestId?'当前请求':'换成这个'}</small></button>)}</div>}</section>;
}
