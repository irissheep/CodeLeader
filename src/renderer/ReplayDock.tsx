import {useEffect,useLayoutEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import {ChevronDown,ChevronLeft,ChevronRight,Pause,Play} from 'lucide-react';
import {afterResponseText} from '../runtime/after-response';
import {replayInterval,type ReplayAction,type ReplayState} from '../runtime/replay';
import {executionCallLabel,executionStepName} from './execution-projection';
import {PhaseLegend} from './Walkthrough';
import {phaseRuns} from './walkthrough-model';
import uiTokens from '../shared/ui-tokens';
import {motionMs,useMotionMode} from './ui-motion';
import './replay-motion.css';
type Props={state:ReplayState;recording:boolean;waiting?:boolean;resources:Set<string>;receivers?:Set<string>;dispatch:(action:ReplayAction)=>void;onSpeed:(speed:number)=>void;options?:ReactNode;history?:ReactNode;walkthroughOpen?:boolean;onWalkthrough?:()=>void;};
export default function ReplayDock({state,recording,waiting=false,resources,receivers,dispatch,onSpeed,options,history,walkthroughOpen=false,onWalkthrough}:Props){
 const {model}=state,position=model.positions[state.cursor]??0;
 const {mode}=useMotionMode(),runs=useMemo(()=>phaseRuns(model,receivers),[model,receivers]);
 const viewport=useRef<HTMLDivElement>(null),dragging=useRef(false),lastDrag=useRef(-1);
 const rail=useRef<HTMLDivElement>(null),number=useRef<HTMLSpanElement>(null),numberAnimation=useRef<Animation|null>(null);
 const progress=useRef<{key:string;fraction:number;start:number;animation?:Animation}>({key:'',fraction:0,start:0});
 const [hover,setHover]=useState<number>(),[hoverAnchor,setHoverAnchor]=useState(0);
 const [phaseStart,setPhaseStart]=useState<number>(),phaseHover=runs.find(run=>run.start===phaseStart);
 const phase=(i:number)=>model.steps[i].exception?'异常':executionStepName(model.byCall[model.steps[i].callId],model.steps[i].phase);
 const name=(i:number)=>{const call=model.byCall[model.steps[i].callId];return call.kind==='browser'?'浏览器':executionCallLabel(call);};
 const description=(i:number)=>model.byCall[model.steps[i].callId].kind==='sql'&&model.steps[i].phase!=='return'?name(i):`${phase(i)} · ${name(i)}`;
 const afterStart=model.steps.findIndex(step=>step.afterResponse);
 const duration=(i:number)=>{const ms=model.byCall[model.steps[i].callId].durationMs;return typeof ms==='number'&&Number.isFinite(ms)?`调用累计耗时 ${ms.toFixed(1)} ms`:'耗时未记录';};
 const label=(i:number)=>`${String(i+1).padStart(2,'0')} / ${String(model.steps.length).padStart(2,'0')} · ${description(i)}`;
 useLayoutEffect(()=>{
  const saved=progress.current,key=model.key+':'+state.cursor,same=saved.key===key;
  const timing=saved.animation?.effect?.getComputedTiming().progress;
  const fraction=same?(typeof timing==='number'?saved.start+(1-saved.start)*timing:saved.fraction):0;
  saved.animation?.cancel();
  const done=position===model.steps.length-1,at=done?1:fraction;
  progress.current={key,fraction:at,start:at};
  for(const run of runs){
   const node=rail.current?.querySelector<HTMLElement>(`[data-phase-start="${run.start}"] .dock-phase-progress`);if(!node)continue;
   const active=position>=run.start&&position<run.start+run.count;
   const start=position>=run.start+run.count?1:position<run.start?0:(position-run.start+(mode==='off'?1:at))/run.count;
   node.style.transform=`scaleX(${start})`;node.style.opacity='1';
   if(!active||!state.playing||done||mode==='off')continue;
   const animation=node.animate(mode==='full'?[
    {transform:`scaleX(${start})`},{transform:`scaleX(${(position-run.start+1)/run.count})`}
   ]:[{opacity:uiTokens.motionPolicy.opacityFuture},{opacity:uiTokens.motionPolicy.opacityCurrent}],{duration:replayInterval(state).ms,easing:uiTokens.motion.linear,fill:'forwards'});
   progress.current.animation=animation;
  }
 },[model.key,model.steps.length,runs,state.cursor,state.playing,state.speed,state.timing,mode]);
 useLayoutEffect(()=>{
  numberAnimation.current?.cancel();
  if(mode!=='off'&&number.current)numberAnimation.current=number.current.animate([{opacity:uiTokens.motionPolicy.opacityFuture},{opacity:uiTokens.motionPolicy.opacityCurrent}],{duration:motionMs('digit'),easing:uiTokens.motion.easeInOut});
 },[position,model.steps.length,mode]);
 useEffect(()=>()=>{progress.current.animation?.cancel();numberAnimation.current?.cancel();},[]);
 useEffect(()=>{const area=viewport.current,current=area?.querySelector<HTMLElement>(`[data-step="${position}"]`);if(area&&current&&(current.offsetLeft<area.scrollLeft||current.offsetLeft+current.offsetWidth>area.scrollLeft+area.clientWidth))area.scrollLeft=Math.max(0,current.offsetLeft-area.clientWidth/2);},[position,model.steps.length]);
 useEffect(()=>{const area=viewport.current;if(!area)return;const update=()=>{const node=area.querySelector<HTMLElement>(`[data-step="${hover??position}"]`);setHoverAnchor(node?Math.max(0,Math.min(area.clientWidth,node.offsetLeft+node.offsetWidth/2-area.scrollLeft)):0);};const observer=new ResizeObserver(update);observer.observe(area);area.addEventListener('scroll',update);update();return()=>{observer.disconnect();area.removeEventListener('scroll',update);};},[position,hover,model.steps.length]);
 const jump=(i:number)=>{if(i!==lastDrag.current){lastDrag.current=i;dispatch({type:'goto',id:model.steps[i].id});}};
 const nearest=(x:number)=>{const nodes=[...viewport.current!.querySelectorAll<HTMLElement>('[data-step]')];let best=0,distance=Infinity;for(const [i,node]of nodes.entries()){const r=node.getBoundingClientRect(),d=Math.abs(x-(r.left+r.width/2));if(d<distance){best=i;distance=d;}}return best;};
 const sentence=description(position);
 return <div className="replay-dock-lane"><section className="replay-dock" data-motion={mode} aria-label="播放坞" onKeyDown={event=>{if(event.key===' ')event.stopPropagation();}}>
  {history}<div className="dock-playback"><button aria-label="上一步" title="上一步" disabled={!position} onClick={()=>dispatch({type:'previous'})}><ChevronLeft size={18}/></button><button className="dock-play" aria-label={state.playing?'暂停回放':'播放回放'} title={state.playing?'暂停回放':'播放回放'} onClick={()=>dispatch({type:state.playing?'pause':'play'})}>{state.playing?<Pause size={19}/>:<Play size={19}/>}</button><button aria-label="下一步" title="下一步" disabled={position===model.steps.length-1} onClick={()=>dispatch({type:'next'})}><ChevronRight size={18}/></button></div>
  <div className="dock-track"><button className={`dock-current ${model.steps[position].exception?'has-error':''}`} title={label(position)} aria-label="步骤走读" aria-expanded={walkthroughOpen} onClick={onWalkthrough}><span className="dock-current-name" ref={number}>{position+1} / {model.steps.length} · {sentence}</span>{state.hit&&<i role="status" title="回放断点">断点</i>}<ChevronDown size={13} className="dock-current-chevron"/></button>
   <div ref={viewport} className="dock-track-viewport" role="slider" aria-label="步骤时间轴" aria-valuemin={1} aria-valuemax={model.steps.length} aria-valuenow={position+1} aria-valuetext={label(position)} tabIndex={0} onKeyDown={event=>{const target=event.key==='ArrowRight'?Math.min(model.steps.length-1,position+1):event.key==='ArrowLeft'?Math.max(0,position-1):event.key==='Home'?0:event.key==='End'?model.steps.length-1:undefined;if(target!==undefined){event.preventDefault();event.stopPropagation();dispatch({type:'goto',id:model.steps[target].id});}}} onPointerDown={event=>{if(event.button!==0)return;dragging.current=true;lastDrag.current=-1;event.currentTarget.setPointerCapture(event.pointerId);jump(nearest(event.clientX));}} onPointerMove={event=>{if(dragging.current)jump(nearest(event.clientX));}} onPointerUp={event=>{dragging.current=false;if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);}} onPointerCancel={()=>dragging.current=false}>
    <div className="dock-segments"><div className="dock-phase-rail" ref={rail}><div className="walk-phases walk-phases-compact" aria-label="处理阶段" onPointerLeave={()=>setPhaseStart(undefined)} onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget))setPhaseStart(undefined);}}>{runs.map(run=>{const active=position>=run.start&&position<run.start+run.count,label=`${run.phase} · 第 ${run.start+1}–${run.start+run.count} 步`;return <span key={run.start} data-phase-start={run.start} tabIndex={0} role="img" className={`walk-phase phase-${run.phase} ${active?'is-current':''}`} style={{flex:run.count}} title={label} aria-label={label} aria-current={active?'step':undefined} onPointerEnter={()=>setPhaseStart(run.start)} onFocus={()=>setPhaseStart(run.start)}><i className="dock-phase-paint" aria-hidden="true"><i className="dock-phase-base"/><i className="dock-phase-progress"/></i></span>;})}</div></div>{model.steps.map((step,i)=>{const call=model.byCall[step.callId],kind=call.kind==='browser'?'browser':call.kind==='sql'||call.kind==='chroma'||call.records.some(r=>r.entityId&&resources.has(r.entityId))?'resource':'code',breakpoint=state.breakpoints.includes(step.callId);return <span key={step.id} data-step={i} role="presentation" className={`dock-segment segment-${kind} ${i<position?'is-past':i===position?'is-current':'is-future'} ${step.phase==='return'?'is-return':step.phase==='atomic'?'is-atomic':''} ${step.exception?'has-error':''} ${i===afterStart?'after-response-start':''}`} aria-label={`跳到步骤 ${label(i)} · ${duration(i)}${breakpoint?' · 断点':''}`} aria-current={i===position?'step':undefined} onClick={event=>{if(event.detail===0)dispatch({type:'goto',id:step.id});}} onPointerEnter={()=>setHover(i)} onPointerLeave={()=>setHover(undefined)} onFocus={()=>setHover(i)} onBlur={()=>setHover(undefined)}>{i===position&&<b className="dock-cursor"/>}{breakpoint&&<i className="dock-step-breakpoint"/>}</span>;})}{recording&&waiting&&<span className="dock-live-dot" role="status" aria-label="等待后续步骤"/>}</div>
   </div>{hover!==undefined&&!phaseHover&&<div className="dock-tooltip" role="tooltip" style={{left:`clamp(0px, ${hoverAnchor-120}px, max(0px, 100% - 240px))`}}><strong>{label(hover)}</strong>{model.steps[hover].afterResponse&&<span>{afterResponseText(model.steps[hover])}</span>}<span>{duration(hover)}</span></div>}
  </div><div className="dock-speed"><button aria-label="切换回放速度" title="切换回放速度；更多选项中可直接选择" onClick={()=>onSpeed(state.speed===500?1000:state.speed===1000?1800:500)}>{state.timing==='recorded'?`间隔 ${state.speed/1000}×`:`每步 ${state.speed/1000}s`}</button></div>{options}{phaseHover&&<div className="dock-phase-tooltip" role="tooltip"><strong>{phaseHover.phase} · 第 {phaseHover.start+1}–{phaseHover.start+phaseHover.count} 步</strong><PhaseLegend/></div>}
 </section></div>;
}
