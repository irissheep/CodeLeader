import {motionMs,motionPolicy,useMotionMode} from './ui-motion';
import uiTokens from '../shared/ui-tokens';
import { useEffect, useMemo, useRef } from 'react';
import { ReactFlow, Background, Controls, Handle, Position, MarkerType, BaseEdge, getSmoothStepPath, type Node, type Edge, type EdgeProps, type ReactFlowInstance } from '@xyflow/react';
import { Database, Layers3, Globe } from 'lucide-react';
import type { ProjectIndex } from '../shared/model';
import { readingSpans } from '../runtime/reading';
import type { BrowserRequest, RecordedSpan } from '../shared/execution';
import { callVisibility, replayLabel, type ReplayAction, type ReplayState } from '../runtime/replay';

// Retained for the first recording verifier; playback order comes only from replay.ts.
export const visibleSpans=(spans:RecordedSpan[],request?:BrowserRequest)=>readingSpans(spans,request).spans;
function CallNode({data}:any){return <>
  <Handle type="target" position={Position.Top}/>
  <button className="execution-node-body" onClick={data.inspect} title={data.label}><span className="execution-node-name">{data.kind==='browser'||data.kind==='http'?<Globe size={14}/>:data.kind==='sql'?<Database size={14}/>:data.kind==='chroma'?<Layers3 size={14}/>:null}<strong>{data.label}</strong></span>{data.resource&&<small>{data.resource}</small>}</button>
  {data.current&&<span className="execution-current-marker" role="img" aria-label="当前位置" title="当前位置"/>}
  <button className={`execution-breakpoint ${data.breakpoint?'set':''} ${data.pending?'next-breakpoint':''}`} aria-label={`回放断点：${data.label}`} aria-pressed={data.breakpoint} title={data.pending?'即将进入的回放断点':'仅作用于这次调用实例'} onClick={event=>{event.stopPropagation();data.toggle();}}><span/></button>
  <Handle type="source" position={Position.Bottom}/>
  </>;
}
function ReadingEdge(props:EdgeProps){
  const [path]=getSmoothStepPath(props),data=props.data as {active?:boolean;returning?:boolean;playing?:boolean;speed?:number;motion?:boolean}|undefined;
  return <><BaseEdge {...props} path={path}/>{data?.active&&data.playing&&data.motion&&motionPolicy.baseStep/(data.speed||motionPolicy.baseStep)<motionPolicy.skipPacketRate&&<circle r="4" fill="currentColor" className="execution-path-marker"><animateMotion key={`${props.id}:${data.returning}`} dur={`${Math.min(data.speed||motionPolicy.baseStep,motionMs('packet'))}ms`} repeatCount="1" fill="freeze" path={path} keyPoints={data.returning?'1;0':'0;1'} keyTimes="0;1" calcMode={uiTokens.motion.linear}/></circle>}</>;
}
const nodeTypes={call:CallNode,service:({data}:any)=><strong>{data.label}</strong>,repeat:({data}:any)=><button className="execution-repeat" onClick={data.expand}>其余已录 {data.count} 次 · 展开实例</button>};
const edgeTypes={reading:ReadingEdge};
export default function ExecutionGraph({index,state,dispatch,change}:{index:ProjectIndex;state:ReplayState;dispatch:(a:ReplayAction)=>void;change:(fn:(s:ReplayState)=>ReplayState)=>void}){
  const container=useRef<HTMLDivElement>(null),flow=useRef<ReactFlowInstance>(null),{model}=state;
  const {mode}=useMotionMode(),current=model.steps[model.positions[state.cursor]],pending=model.steps.find(s=>s.id===state.hit),motion=mode==='full';
  const layout=useMemo(()=>{
    const depth=(id:string,seen=new Set<string>()):number=>{if(seen.has(id))return 0;seen.add(id);const p=model.byCall[id]?.parentId;return p?depth(p,seen)+1:0;};
    const rows=new Map<number,number>(),positions=new Map<string,{x:number;y:number}>();
    // Sibling order is frozen with this model. Playback/inspection never changes coordinates.
    const ordered=[...model.calls].sort((a,b)=>depth(a.id)-depth(b.id)||model.positions[a.enterId]-model.positions[b.enterId]);
    for(const c of ordered){const level=depth(c.id),row=rows.get(level)||0;rows.set(level,row+1);positions.set(c.id,{x:28+row*238,y:22+level*112});}
    return positions;
  },[model]);
  const {nodes,edges}=useMemo(()=>{
    const hidden=new Set<string>(),aggregates:{id:string;last:string;count:number;group:string}[]=[];
    for(const group of model.repeats)if(!state.expanded.includes(group.id)){
      const remainder=group.calls.slice(3).filter(id=>id!==current?.callId&&id!==state.inspected&&id!==pending?.callId);
      for(const id of remainder)hidden.add(id);
      if(remainder.length)aggregates.push({id:group.id,last:remainder[0],count:remainder.length,group:group.id});
    }
    const nodes:Node[]=[],edges:Edge[]=[],services=new Map<string,Node[]>();
    for(const call of model.calls){
      const visibility=callVisibility(state,call.id);if(hidden.has(call.id)||!state.showAll&&!visibility.reached&&call.id!==pending?.callId)continue;
      const entity=index.entities?.find(e=>e.id===call.span?.entityId),symbol=index.symbols.find(s=>s.id===call.span?.symbolId);
      const label=call.kind==='browser'?'浏览器':call.kind==='method'&&symbol?symbol.qualifiedName.split('.').slice(-2).join('.'):replayLabel(call);
      const node:Node={id:call.id,type:'call',position:layout.get(call.id)!,data:{label,kind:call.kind,resource:entity?.name&&!label.includes(entity.name)?entity.name:undefined,current:current?.callId===call.id,pending:pending?.callId===call.id,breakpoint:state.breakpoints.includes(call.id),inspect:()=>dispatch({type:'inspect',id:call.id}),toggle:()=>dispatch({type:'breakpoint',id:call.id})},className:`execution-node ${call.kind==='sql'||call.kind==='chroma'?'resource':''} ${state.inspected===call.id?'selected':''} ${current?.callId===call.id?'current-step':''} ${!visibility.reached?'replay-future':''}`,style:{width:216},draggable:false};
      nodes.push(node);if(call.kind!=='browser')services.set(call.service,[...services.get(call.service)||[],node]);
      if(call.parentId){const active=current?.callId===call.id,returning=current?.phase==='return';edges.push({id:call.id+':edge',source:call.parentId,target:call.id,type:'reading',markerEnd:returning&&active?undefined:{type:MarkerType.ArrowClosed},markerStart:returning&&active?{type:MarkerType.ArrowClosed}:undefined,data:{active,returning,playing:state.playing,speed:state.speed,motion},style:{stroke:active?returning?uiTokens.color["compat-272"]:uiTokens.color["compat-273"]:uiTokens.color["compat-274"],strokeWidth:active?2.8:1.7,strokeDasharray:!visibility.reached?'5 5':undefined,opacity:!visibility.reached?.28:1}});}
    }
    for(const a of aggregates)nodes.push({id:a.id,type:'repeat',position:layout.get(a.last)!,data:{count:a.count,expand:()=>change(s=>({...s,playing:false,expanded:[...s.expanded,a.group]}))},style:{width:216}});
    for(const [service,members] of services){const left=Math.min(...members.map(n=>n.position.x))-12,top=Math.min(...members.map(n=>n.position.y))-22,right=Math.max(...members.map(n=>n.position.x))+228,bottom=Math.max(...members.map(n=>n.position.y))+108;
      nodes.unshift({id:'runtime-service:'+service,type:'service',position:{x:left,y:top},data:{label:service},selectable:false,draggable:false,zIndex:-1,className:'execution-service',style:{width:right-left,height:bottom-top,pointerEvents:'none'}});
    }
    const ids=new Set(nodes.map(n=>n.id));return {nodes,edges:edges.filter(e=>ids.has(e.source)&&ids.has(e.target))};
  },[index,model,layout,state.cursor,state.inspected,state.hit,state.breakpoints,state.expanded,state.showAll,state.playing,state.speed,dispatch,change,motion]);
  useEffect(()=>{
    if(!state.follow||!current)return;const instance=flow.current,box=container.current,node=layout.get(current.callId);if(!instance||!box||!node)return;
    const view=instance.getViewport(),x=node.x*view.zoom+view.x,y=node.y*view.zoom+view.y;
    const right=x+216*view.zoom,bottom=y+108*view.zoom;
    const dx=x<12?12-x:right>box.clientWidth-12?box.clientWidth-12-right:0,dy=y<12?12-y:bottom>box.clientHeight-12?box.clientHeight-12-bottom:0;
    if(dx||dy)void instance.setViewport({x:view.x+dx,y:view.y+dy,zoom:view.zoom},{duration:state.playing&&motion?motionMs('camera'):motionPolicy.zero});
  },[current?.id,state.follow,layout,motion]);
  return <div ref={container} className="execution-flow"><ReactFlow key={model.key} nodeTypes={nodeTypes} edgeTypes={edgeTypes} nodes={nodes} edges={edges} onInit={instance=>{flow.current=instance;if(!state.viewport&&container.current){const positions=[...layout.values()],left=Math.min(...positions.map(p=>p.x)),right=Math.max(...positions.map(p=>p.x))+216,view=instance.getViewport(),reserve=container.current.closest('.execution-workspace')?.querySelector('.execution-inspector')?0:340,width=Math.max(280,container.current.clientWidth-reserve);void instance.setViewport({...view,x:Math.max(10,(width-(right-left)*view.zoom)/2-left*view.zoom)},{duration:motionPolicy.zero});}}} onMoveEnd={(_e,viewport)=>change(s=>({...s,viewport}))} defaultViewport={state.viewport||{x:10,y:12,zoom:innerHeight<800?.8:.86}} minZoom={.65} maxZoom={1.5} nodesDraggable={false} proOptions={{hideAttribution:true}}><Background color={uiTokens.color["compat-275"]} gap={28}/><Controls showInteractive={false}/></ReactFlow></div>;
}
