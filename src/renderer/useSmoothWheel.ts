import {useEffect,useRef,type RefObject} from 'react';
import {useReactFlow,useStoreApi,type Viewport} from '@xyflow/react';
import tokens from '../shared/ui-tokens';
import {getMotionMode} from './ui-motion';
const p=tokens.zoom;
type Options={host:RefObject<HTMLDivElement|null>;onStart:(event:WheelEvent)=>void;onEnd:(viewport:Viewport)=>void};

/** Keep the library's viewport current; its DOM-only transform path needs no React render. */
export function useSmoothWheel({host,onStart,onEnd}:Options){
 const flow=useReactFlow(),store=useStoreApi(),active=useRef(false),latest=useRef({onStart,onEnd});latest.current={onStart,onEnd};
 useEffect(()=>{
  const root=host.current,pane=root?.querySelector<HTMLElement>('.react-flow');if(!root||!pane)return;
  let frame=0,idle=0,lastInput=0,lastFrame=0,target=1,smooth=false,area:DOMRect,anchor={x:0,y:0},world={x:0,y:0};
  const paused=new Set<Animation>();
  const pauseAnimations=()=>{for(const animation of root.getAnimations({subtree:true}))if(animation.effect?.getTiming().iterations===Infinity&&animation.playState==='running'){paused.add(animation);animation.pause();}};
  const observer=new MutationObserver(()=>{if(active.current)pauseAnimations();});
  const end=()=>{
   if(!active.current)return;active.current=false;cancelAnimationFrame(frame);frame=0;clearTimeout(idle);observer.disconnect();root.classList.remove('zooming');
   for(const animation of paused)if(animation.playState==='paused'&&(animation.effect as KeyframeEffect)?.target?.isConnected)animation.play();paused.clear();
   root.dispatchEvent(new CustomEvent('zoom-settled'));latest.current.onEnd(flow.getViewport());
  };
  const tick=(now:number)=>{
   frame=0;if(!active.current)return;
   const old=flow.getViewport(),dt=Math.max(0,now-lastFrame);lastFrame=now;
   const remaining=Math.log(target/old.zoom);let change=remaining;
   if(smooth&&now-lastInput<p.wheelDuration)change*=1-Math.exp(-dt/p.timeConstant);
   const limit=getMotionMode()==='full'?Math.log1p(p.maxFrameRatio):Infinity;change=Math.max(-limit,Math.min(limit,change));
   const zoom=Math.abs(remaining)<p.epsilon?target:old.zoom*Math.exp(change);
   if(zoom!==old.zoom)void flow.setViewport({x:anchor.x-world.x*zoom,y:anchor.y-world.y*zoom,zoom},{duration:0});
   if(Math.abs(Math.log(target/zoom))>p.epsilon||smooth&&now-lastInput<p.wheelDuration)frame=requestAnimationFrame(tick);
  };
  const wheel=(event:WheelEvent)=>{
   if(event.defaultPrevented||(event.target as Element).closest('.nowheel'))return;
   if(!event.deltaY)return;event.preventDefault();event.stopImmediatePropagation();
   const now=performance.now(),viewport=flow.getViewport();
   if(!active.current){active.current=true;target=viewport.zoom;lastFrame=now;area=pane.getBoundingClientRect();root.classList.add('zooming');pauseAnimations();observer.observe(root,{attributes:true,attributeFilter:['class'],subtree:true});latest.current.onStart(event);void flow.setViewport(viewport,{duration:0});}
   anchor={x:event.clientX-area.left,y:event.clientY-area.top};world={x:(anchor.x-viewport.x)/viewport.zoom,y:(anchor.y-viewport.y)/viewport.zoom};
   const state=store.getState(),factor=event.deltaMode===1?p.lineFactor:event.deltaMode===2?p.pageFactor:p.pixelFactor;
   target=Math.max(state.minZoom,Math.min(state.maxZoom,target*Math.pow(2,-event.deltaY*factor)));
   smooth=getMotionMode()==='full'&&(event.deltaMode!==0||Math.abs(event.deltaY)>p.trackpadDelta);lastInput=now;
   if(!frame)frame=requestAnimationFrame(tick);clearTimeout(idle);idle=window.setTimeout(end,p.idleDelay);
  };
  const takeOver=()=>{if(active.current)end();};
  pane.addEventListener('wheel',wheel,{capture:true,passive:false});document.addEventListener('pointerdown',takeOver,true);
  return()=>{cancelAnimationFrame(frame);clearTimeout(idle);observer.disconnect();active.current=false;root.classList.remove('zooming');for(const animation of paused)if(animation.playState==='paused')animation.play();pane.removeEventListener('wheel',wheel,true);document.removeEventListener('pointerdown',takeOver,true);};
 },[host,flow,store]);
 return active;
}
