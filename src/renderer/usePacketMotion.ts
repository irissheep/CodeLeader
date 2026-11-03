import {useLayoutEffect,useRef,type RefObject} from 'react';
import type {ReplayCall,ReplayState} from '../runtime/replay';
import {replayInterval} from '../runtime/replay';
import type {SafeValue} from '../shared/execution';
import uiTokens from '../shared/ui-tokens';
import type {ExecutionLayer} from './execution-layer';
import type {ExecutionProjection} from './execution-projection';
import type {GraphLink} from './graph-model';
import {bodyValue,isObject,visibleValue,valueLimits} from './execution-data';
import {rowsOf} from './sql-facts';
import {phaseRuns} from './walkthrough-model';
import {motionMs,motionPolicy,useMotionMode} from './ui-motion';

const ns='http://www.w3.org/2000/svg';
const stateDisplay=(runtime?:ExecutionLayer)=>runtime?.state?.display;
export function readingStage(state:ReplayState,receivers?:Set<string>){
 const position=state.model.positions[state.cursor],phase=phaseRuns(state.model,receivers).find(run=>position>=run.start&&position<run.start+run.count)?.phase;
 return phase==='接收'?'receive':phase==='数据'?'data':phase==='返回'?'return':'business';
}
/** Summaries only use values available at this recorded boundary. */
export function packetSummary(state:ReplayState,call:ReplayCall):string|undefined{
 const step=state.model.steps[state.model.positions[state.cursor]],returning=step.phase!=='enter';
 const raw=returning?call.output:call.input,value=visibleValue(raw,state.display),body=bodyValue(value);
 if(isObject(value)&&value.bodyBytes===0&&value.body===null)return returning&&call.kind==='browser'&&state.model.request.status!==undefined?String(state.model.request.status):undefined;
 if(value===undefined){const status=returning&&call.kind==='browser'?state.model.request.status:undefined;return status===undefined?undefined:String(status);}
 const limit=valueLimits(raw)[0];if(limit)return limit.message;
 if(returning&&call.kind==='sql'){const rows=rowsOf(call,state.display);if(rows!==undefined)return `${rows} 行`;}
 const status=returning?(isObject(value)&&typeof value.status==='number'?value.status:call.kind==='browser'?state.model.request.status:undefined):undefined;
 const summary=(v:SafeValue|undefined):string|undefined=>{
  if(v===undefined)return;
  if(Array.isArray(v))return `${v.length} 条`;
  if(isObject(v)){const lists=Object.values(v).filter(Array.isArray);return returning&&lists.length===1?`${lists[0].length} 条`:`${Object.keys(v).length} 个字段`;}
  if(v===null)return '空值';
  return typeof v==='string'?v:String(v);
 };
 const text=summary(body);return [status,text].filter(v=>v!==undefined&&v!=='').join(' · ')||undefined;
}
type Options={host:RefObject<HTMLDivElement|null>;runtime?:ExecutionLayer;projection?:ExecutionProjection;receivers?:Set<string>;links:GraphLink[]};
type Flight={animations:Animation[];nodes:Element[];step:string;playing:boolean;manual:boolean};
export function usePacketMotion({host,runtime,projection,receivers,links}:Options){
 const {mode}=useMotionMode(),flight=useRef<Flight|undefined>(undefined),exits=useRef(new Map<Element,Animation>()),seen=useRef<string|undefined>(undefined),displayed=useRef(stateDisplay(runtime));
 const state=runtime?.state,step=state?.model.steps[state.model.positions[state.cursor]],call=step&&state?.model.byCall[step.callId];
 const clear=(fade=false)=>{if(!fade){for(const[node,animation]of exits.current){animation.cancel();node.remove();}exits.current.clear();}const old=flight.current;if(old){const opacity=new Map(old.nodes.map(node=>[node,getComputedStyle(node).opacity]));for(const animation of old.animations)animation.cancel();for(const node of old.nodes){if(fade&&node.classList.contains('motion-data-arrival')){const animation=node.animate([{opacity:opacity.get(node)},{opacity:0}],{duration:motionMs('fast'),easing:uiTokens.motion.easeOut,fill:'both'});exits.current.set(node,animation);animation.finished.then(()=>{node.remove();exits.current.delete(node);}).catch(()=>{});}else node.remove();}flight.current=undefined;}};
 useLayoutEffect(()=>{
  const root=host.current;if(!root||!state||!step||!call){clear();return;}
  const identity=state.model.key+':'+step.id,initial=seen.current===undefined;seen.current=identity;const displayChanged=displayed.current!==state.display;displayed.current=state.display;clear(mode!=='off'&&!displayChanged);
  const owner=(id:string)=>[...projection?.calls||[]].find(([,calls])=>calls.some(c=>c.id===id))?.[0];
  const element=(id:string)=>root.querySelector<HTMLElement>(`.runtime-method-row[data-call-id="${CSS.escape(id)}"]`)||root.querySelector<HTMLElement>(`[data-call-id="${CSS.escape(id)}"]`)?.closest<HTMLElement>('.runtime-method-row')||root.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(owner(id)||'')}"] .card-accessible`);
  const parent=call.parentId?state.model.byCall[call.parentId]:undefined,child=call.kind==='browser'&&call.children.length===1?state.model.byCall[call.children[0]]:undefined;
  const from=parent?element(parent.id):element(call.id),to=parent?element(call.id):child?element(child.id):undefined;
  const returning=step.phase==='return',target=returning?from:to;
  if(!from||!to||from===to)return;
  const edge=projection?.currentEdge||links.find(link=>link.source===owner(child?call.id:parent?.id||call.id)&&link.target===owner(child?.id||call.id))?.id;
  const route=edge&&root.querySelector<SVGPathElement>(`.react-flow__edge[data-id="${CSS.escape(edge)}"] .react-flow__edge-path`);
  if(!edge&&owner(child?call.id:parent?.id||call.id)!==owner(child?.id||call.id))return;
  const viewport=root.querySelector<HTMLElement>('.react-flow__viewport'),renderer=root.querySelector<HTMLElement>('.react-flow__renderer');
  if(!viewport||!renderer)return;
  const overlay=document.createElementNS(ns,'svg');overlay.setAttribute('class','motion-packet-overlay');overlay.setAttribute('width','1');overlay.setAttribute('height','1');overlay.setAttribute('aria-hidden','true');viewport.append(overlay);
  const group=document.createElementNS(ns,'g');group.setAttribute('class','motion-packet-layer');group.setAttribute('aria-hidden','true');overlay.append(group);
  let path=route||undefined;
  if(!path){
   const matrix=new DOMMatrixReadOnly(getComputedStyle(viewport).transform),base=renderer.getBoundingClientRect();
   const point=(node:Element,bottom:boolean)=>{const r=node.getBoundingClientRect();return {x:(r.x+r.width/2-base.x-matrix.e)/matrix.a,y:((bottom?r.bottom:r.top)-base.y-matrix.f)/matrix.d};};
   const a=point(from,true),b=point(to,false),middle=(a.y+b.y)/2;
   path=document.createElementNS(ns,'path');path.setAttribute('d',`M ${a.x} ${a.y} L ${a.x} ${middle} L ${b.x} ${middle} L ${b.x} ${b.y}`);path.setAttribute('class','motion-internal-route');group.append(path);
  }
  const color=uiTokens.color[`phase-${readingStage(state,receivers)}`],length=path.getTotalLength(),animations:Animation[]=[],nodes:Element[]=[overlay];
  group.style.color=color;
  const current:Flight={animations,nodes,step:step.id,playing:state.playing,manual:!state.playing};flight.current=current;
  const label=packetSummary(state,call),short=label&&Array.from(label).slice(0,motionPolicy.labelLimit).join('')+(Array.from(label).length>motionPolicy.labelLimit?'…':'');
  const arrived=()=>{
   if(flight.current!==current||!short||!target)return;
   const badge=document.createElement('span');badge.className='motion-data-arrival';badge.textContent=short;badge.title=label!;badge.style.setProperty('--packet-color',color);badge.setAttribute('role','status');badge.setAttribute('data-motion-tag',step.id);(target.querySelector('[data-packet-slot]')||target).append(badge);nodes.push(badge);
   if(mode!=='off')animations.push(badge.animate(mode==='full'?[{opacity:0,transform:`translateY(${uiTokens.space.half})`},{opacity:1,transform:'translateY(0)'}]:[{opacity:0},{opacity:1}],{duration:motionMs('fast'),easing:uiTokens.motion.easeOut,fill:'both'}));
  };
  const fast=motionPolicy.baseStep/state.speed>=motionPolicy.skipPacketRate;
  if(mode!=='full'||fast||initial&&!state.playing){arrived();return;}
  const duration=Math.min(motionMs('packet')*state.speed/motionPolicy.baseStep,replayInterval(state).ms),points=Array.from({length:motionPolicy.pathSamples+1},(_,i)=>{
   const progress=i/motionPolicy.pathSamples,p=path!.getPointAtLength(length*(returning?1-progress:progress));return {transform:`translate(${p.x}px,${p.y}px)`};
  });
  const dot=document.createElementNS(ns,'circle');dot.setAttribute('class','motion-packet');dot.setAttribute('data-motion-packet',step.id);dot.setAttribute('r',String(motionPolicy.packetRadius));group.append(dot);
  const travel=dot.animate(points,{duration,easing:uiTokens.motion.easeInOut,fill:'both'});animations.push(travel);
  travel.finished.then(()=>{if(flight.current===current){dot.remove();arrived();}}).catch(()=>{});
  // Moving dashes are translated capsules; stroke-dashoffset never animates.
  if(state.playing)for(let i=0;i<motionPolicy.skipPacketRate;i++){
   const dash=document.createElementNS(ns,'rect');dash.setAttribute('x',String(-motionPolicy.packetRadius));dash.setAttribute('y',String(-motionPolicy.packetRadius/4));dash.setAttribute('width',String(motionPolicy.packetRadius*2));dash.setAttribute('height',String(motionPolicy.packetRadius/2));dash.setAttribute('rx',String(motionPolicy.packetRadius/4));dash.setAttribute('class','motion-flow-dash');group.append(dash);
   const dashes=points.map((point,i)=>{const a=path!.getPointAtLength(length*(returning?1-i/motionPolicy.pathSamples:i/motionPolicy.pathSamples)),b=path!.getPointAtLength(length*(returning?Math.max(0,1-(i+1)/motionPolicy.pathSamples):Math.min(1,(i+1)/motionPolicy.pathSamples)));return {transform:point.transform+` rotate(${Math.atan2(b.y-a.y,b.x-a.x)*180/Math.PI}deg)`};});
   animations.push(dash.animate(dashes,{duration,easing:uiTokens.motion.linear,iterations:Infinity,delay:-duration*i/motionPolicy.skipPacketRate}));
  }
 },[state?.model.key,step?.id,mode,state?.speed,state?.timing,state?.display,projection?.currentEdge]);
 useLayoutEffect(()=>{
  const current=flight.current;if(!current||!state||current.step!==step?.id)return;
  if(current.playing&&!state.playing){current.manual=false;for(const animation of current.animations)animation.pause();}
  else if(!current.playing&&state.playing)for(const animation of current.animations)animation.play();
  current.playing=state.playing;
 },[state?.playing,step?.id]);
 useLayoutEffect(()=>{
  const root=host.current;if(!root)return;
  const playback=(event:Event)=>{const playing=(event as CustomEvent<{playing:boolean}>).detail.playing,current=flight.current;if(!current||current.playing===playing)return;for(const animation of current.animations){if(playing)animation.play();else animation.pause();}current.playing=playing;};
  root.addEventListener('motion-playback',playback);return()=>{root.removeEventListener('motion-playback',playback);clear(false);};
 },[]);
}
