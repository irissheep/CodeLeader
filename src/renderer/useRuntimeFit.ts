import {useCallback,useEffect,useRef,type RefObject} from 'react';
import {useReactFlow} from '@xyflow/react';
import type {ExecutionLayer} from './execution-layer';
import type {ExecutionProjection} from './execution-projection';
import type {GraphCard,GraphLink} from './graph-model';
import type {LayoutSnapshot,Rect} from './graph-geometry';
import {fitRuntime,fitZoom,rectBounds,runtimeMinZoom,visibleCanvas} from './runtime-viewport';
import {motionMs,motionPolicy,useMotionMode} from './ui-motion';

export function useRuntimeFit({runtime,host,snapshot,projection,cards,links,manual,motion}:{runtime?:ExecutionLayer;host:RefObject<HTMLDivElement|null>;snapshot?:LayoutSnapshot;projection?:ExecutionProjection;cards:GraphCard[];links:GraphLink[];manual:RefObject<boolean>;motion:boolean}){
 const {mode}=useMotionMode();
 const easeOut=(t:number)=>1-Math.pow(1-t,motionPolicy.easeOutPower);
 const flow=useReactFlow(),visible=useRef<Rect|undefined>(undefined);
 const frame=useRef(0),fit=useRef(()=>{});
 const identity=runtime?.operation?.id||runtime?.state?.model.key||runtime?.record?.id,seen=useRef<string|undefined>(undefined);
 const latest=useRef({runtime,projection,cards,links,snapshot,motion:motion&&mode==='full'});latest.current={runtime,projection,cards,links,snapshot,motion:motion&&mode==='full'};
 const pause=useCallback(()=>{manual.current=true;latest.current.runtime?.cameraPause();},[manual]);
 const schedule=useCallback(()=>{cancelAnimationFrame(frame.current);frame.current=requestAnimationFrame(()=>fit.current());},[]);
 const refit=useCallback(()=>{manual.current=false;latest.current.runtime?.cameraResume();schedule();},[manual,schedule]);
 useEffect(()=>{if(runtime?.state?.follow){manual.current=false;schedule();}},[runtime?.state?.follow,manual,schedule]);
 useEffect(()=>{if(!runtime)return;const observer=new ResizeObserver(schedule);observer.observe(host.current!);return()=>observer.disconnect();},[!!runtime,host,schedule]);
 useEffect(()=>{if(identity!==seen.current){seen.current=identity;manual.current=false;runtime?.cameraResume();}},[identity,manual]);
 fit.current=()=>{
   const {runtime:layer,projection,cards,links,snapshot,motion}=latest.current,element=host.current;if(!element||!snapshot||!layer)return;
   const box=element.getBoundingClientRect(),shell=element.closest('.runtime-shell')!,viewport=flow.getViewport();
   const rect=(node:Element):Rect=>{const r=node.getBoundingClientRect();return{x:r.x-box.x,y:r.y-box.y,width:r.width,height:r.height};};
   const obstacles=[...shell.querySelectorAll('.execution-page,.execution-inspector,.execution-technical-drawer,.operation-strip,.replay-dock-lane,.walkthrough-panel')].map(rect);
   const area=visibleCanvas({x:0,y:0,width:box.width,height:box.height},obstacles);if(area.width<1||area.height<1)return;
   visible.current=area;
   if(manual.current)return;
   const byNode=new Map(snapshot.nodes.map(node=>[node.id,{x:node.x,y:node.y-40,width:node.width,height:node.height+40}]));
   if(!byNode.size)return;
   const state=layer.state,step=state?.model.steps[state.model.positions[state.cursor]],call=step&&state?.model.byCall[step.callId];
   const owners=new Map<string,string>();for(const [node,calls]of projection?.calls||[])for(const call of calls)owners.set(call.id,node);
   const current=projection?.current||owners.get(call?.id||'')||'runtime:browser',involved=new Set([current]);
   for(const link of links)if(link.source===current||link.target===current){involved.add(link.source);involved.add(link.target);}
   const wanted=[...involved].flatMap(id=>byNode.has(id)?[byNode.get(id)!]:[]),focus=byNode.has(current)?[byNode.get(current)!]:wanted;
   const fitted=fitRuntime(wanted,focus,area);
   element.style.setProperty('--read-scale',String(1/fitted.viewport.zoom));
   element.dataset.autoFitLimited=String(fitted.limited);element.dataset.autoFitFocusFits=String(fitted.focusFits);
   if(Math.abs(viewport.x-fitted.viewport.x)>.5||Math.abs(viewport.y-fitted.viewport.y)>.5||Math.abs(viewport.zoom-fitted.viewport.zoom)>.001)void flow.setViewport(fitted.viewport,{duration:motion?motionMs('camera'):0,ease:easeOut});
 };
 useEffect(()=>{if(runtime)schedule();return()=>cancelAnimationFrame(frame.current);},[!!runtime,identity,runtime?.state?.model.key,runtime?.state?.model.fingerprint,runtime?.state?.cursor,runtime?.layoutKey,runtime?.walkthroughInset,snapshot?.version,mode,schedule]);
 const overview=useCallback(()=>{const area=visible.current,nodes=latest.current.snapshot?.nodes;if(!area||!nodes?.length){refit();return;}pause();const bounds=rectBounds(nodes),zoom=fitZoom(bounds,area);void flow.setViewport({x:area.x+area.width/2-(bounds.x+bounds.width/2)*zoom,y:area.y+area.height/2-(bounds.y+bounds.height/2)*zoom,zoom},{duration:latest.current.motion?motionMs('camera'):0,ease:easeOut});},[pause,refit,flow]);
 return{pause,refit,overview};
}
