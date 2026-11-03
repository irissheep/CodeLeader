import {useEffect,useLayoutEffect,useRef,type RefObject} from 'react';
import uiTokens from '../shared/ui-tokens';
import type {ExecutionLayer} from './execution-layer';
import {browserNodeId,type ExecutionProjection} from './execution-projection';
import type {LayoutSnapshot} from './graph-geometry';
import type {GraphLink} from './graph-model';
import {motionMs,motionPolicy as policy,useMotionMode} from './ui-motion';

type Box={left:number;top:number;width:number;height:number};
type Row={element:HTMLElement;box:Box;image:HTMLElement};
type Visual={element:HTMLElement;card:HTMLElement;body:HTMLElement;box:Box;rows:Map<string,Row>};
type Options={host:RefObject<HTMLDivElement|null>;runtime?:ExecutionLayer;projection?:ExecutionProjection;snapshot?:LayoutSnapshot;links:GraphLink[]};
const rowsSelector='.runtime-method-row,.capability,.inline-interfaces .entry-row,.backbone-inline-list li';
const numberSelector='.operation-number,.runtime-row-count,.dependency-count,.runtime-step-bubble';
const setVariable=(element:HTMLElement,name:string,value:string)=>{if(element.style.getPropertyValue(name)!==value)element.style.setProperty(name,value);};
const flag=(element:HTMLElement,key:string,value:string|undefined)=>{if(value===undefined)delete element.dataset[key];else if(element.dataset[key]!==value)element.dataset[key]=value;};

/** Visual effects stay below ReactFlow's positioning layer and never advance replay. */
export function useGraphMotion({host,runtime,projection,snapshot,links}:Options){
 const {mode}=useMotionMode(),previous=useRef(new Map<string,Visual>()),operation=useRef<string|undefined>(undefined),entered=useRef(new Set<string>());
 const animations=useRef(new Map<Element,Map<string,Animation>>()),numberText=useRef(new WeakMap<Element,string>()),hover=useRef<string|undefined>(undefined);
 const latest=useRef({runtime,projection,links,mode});latest.current={runtime,projection,links,mode};
 const play=(element:Element,slot:string,frames:Keyframe[],options:KeyframeAnimationOptions)=>{
  let slots=animations.current.get(element);if(!slots){slots=new Map();animations.current.set(element,slots);}slots.get(slot)?.cancel();
  const animation=element.animate(frames,options);slots.set(slot,animation);
  animation.finished.then(()=>{if(slots?.get(slot)===animation){slots.delete(slot);if(!slots.size)animations.current.delete(element);animation.cancel();}}).catch(()=>{});
  return animation;
 };
 const cancel=(element:Element,slot:string)=>{const slots=animations.current.get(element);slots?.get(slot)?.cancel();slots?.delete(slot);if(!slots?.size)animations.current.delete(element);};
 const cancelTransient=()=>{for(const[element,slots]of animations.current)for(const[slot,animation]of slots)if(slot!=='breathe'){animation.cancel();slots.delete(slot);if(!slots.size)animations.current.delete(element);}host.current?.querySelectorAll('.u2-exit-layer').forEach(node=>node.remove());};
 const measure=()=>{
  const found=new Map<string,Visual>();
  for(const element of host.current?.querySelectorAll<HTMLElement>('.react-flow__node[data-id]')||[]){
   const card=element.querySelector<HTMLElement>(':scope>.card-accessible'),body=card?.firstElementChild as HTMLElement|undefined;
   if(!card||!body)continue;
   const outer=element.getBoundingClientRect(),rect=card.getBoundingClientRect(),bodyRect=body.getBoundingClientRect(),zoom=outer.width/element.offsetWidth||1;
   const rows=new Map<string,Row>();
   for(const[rowIndex,row]of [...card.querySelectorAll<HTMLElement>(rowsSelector)].entries()){
    const box=row.getBoundingClientRect(),key=row.dataset.callId||row.dataset.capabilityId||`${row.tagName}:${rowIndex}:${row.textContent}`;
    const image=row.cloneNode(true) as HTMLElement;
    image.querySelectorAll('.runtime-step-bubble,.runtime-current-ring,.motion-data-arrival,.motion-packet-layer').forEach(node=>node.remove());
    for(const copy of [image,...image.querySelectorAll<HTMLElement>('*')]){for(const attribute of [...copy.attributes])if(attribute.name==='id'||attribute.name.startsWith('data-')||attribute.name==='tabindex'||attribute.name==='aria-describedby'||attribute.name==='aria-current'||attribute.name==='role')copy.removeAttribute(attribute.name);}
    rows.set(key,{element:row,box:{left:(box.left-rect.left)/zoom,top:(box.top-rect.top)/zoom,width:box.width/zoom,height:box.height/zoom},image});
   }
   found.set(element.dataset.id!,{element,card,body,box:{left:0,top:0,width:bodyRect.width/zoom,height:bodyRect.height/zoom},rows});
  }
  return found;
 };
 const updateStates=()=>{
  const element=host.current;if(!element)return;
  const {runtime,projection,links,mode}=latest.current,enabled=!!runtime?.state;
  flag(element,'motionMode',mode);flag(element,'u2Hover',hover.current?'true':undefined);
  const neighbors=new Set<string>(hover.current?[hover.current]:[]),edgeIds=new Set<string>();
  if(hover.current)for(const link of links)if(link.source===hover.current||link.target===hover.current){neighbors.add(link.source);neighbors.add(link.target);edgeIds.add(link.id);}
  for(const node of element.querySelectorAll<HTMLElement>('.react-flow__node[data-id]')){
   const card=node.querySelector<HTMLElement>(':scope>.card-accessible');if(!card)continue;
   const id=node.dataset.id!,state=!runtime?undefined:projection?.current===id||!enabled&&id===browserNodeId&&runtime.operation?.pending?'current':projection?.active.has(id)?'past':projection?.calls.has(id)?'future':'unrelated';
   flag(node,'u2State',state);flag(node,'u2Hover',hover.current?(neighbors.has(id)?'neighbor':'other'):undefined);
   const base=state==='current'?policy.opacityCurrent:state==='past'?policy.opacityPast:state==='future'?policy.opacityFuture:state==='unrelated'?policy.opacityUnrelated:policy.opacityCurrent;
   const opacity=hover.current?(neighbors.has(id)?policy.opacityCurrent:policy.opacityHoverOther):base;
   setVariable(card,'--u2-opacity',String(opacity));setVariable(card,'--u2-lift',mode==='full'&&state==='current'?`-${policy.lift}px`:'0px');
   const glow=enabled&&state==='current'&&mode!=='off';card.classList.toggle('u2-current',glow);
   if(!glow)cancel(card,'breathe');else if(!animations.current.get(card)?.has('breathe'))play(card,'breathe',[{opacity:policy.ringLow},{opacity:policy.ringHigh},{opacity:policy.ringLow}],{pseudoElement:'::after',duration:motionMs('breathe'),iterations:Infinity,easing:uiTokens.motion.easeInOut});
   for(const row of card.querySelectorAll<HTMLElement>('.runtime-method-row')){
    const rowOpacity=state!=='current'||hover.current===id?policy.opacityCurrent:row.getAttribute('aria-current')==='step'?policy.opacityCurrent:row.dataset.reached==='true'?policy.opacityPast:policy.opacityFuture;
    setVariable(row,'--u2-row-opacity',String(rowOpacity));
   }
  }
  for(const edge of element.querySelectorAll<SVGGElement>('.react-flow__edge[data-id]')){
   const near=!!hover.current&&edgeIds.has(edge.dataset.id!);flag(edge as unknown as HTMLElement,'u2Hover',hover.current?(near?'neighbor':'other'):undefined);
  }
 };
 useLayoutEffect(()=>{
  cancelTransient();
  const measured=measure(),prior=previous.current,identity=runtime?.state?.model.key||runtime?.operation?.id;
  if(identity!==operation.current)entered.current.clear();
  const rate=runtime?.state?policy.baseStep/runtime.state.speed:1;
  const duration=motionMs('list')/Math.max(1,rate),rowDelay=motionMs('rowStagger')/Math.max(1,rate);
  updateStates();
  const interpolate=!!runtime&&mode!=='off'&&!host.current?.classList.contains('zooming');
  if(interpolate)for(const[id,next]of measured){
   const old=prior.get(id);
   if(old?.body===next.body&&old.box.height&&next.box.height&&Math.abs(old.box.height-next.box.height)>policy.resizeTolerance&&mode==='full'){
    const scale=old.box.height/next.box.height;
    play(next.body,'resize',[{transform:`scaleY(${scale})`},{transform:'scaleY(1)'}],{duration,easing:uiTokens.motion.spring});
    for(const child of next.body.querySelectorAll<HTMLElement>(':scope>.service-heading,:scope>.capability-grid,:scope>.backbone-inline-list'))play(child,'resize-content',[{transform:`scaleY(${1/scale})`},{transform:'scaleY(1)'}],{duration,easing:uiTokens.motion.spring});
   }
   const added=[...next.rows].filter(([key])=>!old?.rows.has(key));
   for(const[index,[,row]]of added.entries()){
    if(index>=policy.maxRows)break;
    flag(row.element,'u2Entering','true');
    const animation=play(row.element,'row-enter',mode==='full'?[{opacity:policy.opacityNumberFrom,transform:`translateY(-${policy.rowLift}px)`},{opacity:policy.opacityCurrent,transform:'translateY(0px)'}]:[{opacity:policy.opacityNumberFrom},{opacity:policy.opacityCurrent}],{duration,delay:index*rowDelay,easing:uiTokens.motion.easeOut,fill:'backwards'});
    animation.finished.then(()=>flag(row.element,'u2Entering',undefined)).catch(()=>flag(row.element,'u2Entering',undefined));
   }
   const removed=[...old?.rows||[]].filter(([key])=>!next.rows.has(key)).slice(-policy.maxRows).reverse();
   if(removed.length){
    const layer=document.createElement('div');layer.className='u2-exit-layer';layer.setAttribute('aria-hidden','true');layer.inert=true;next.card.append(layer);
    for(const[index,[,row]]of removed.entries()){
     const clone=row.image;clone.style.position='absolute';clone.style.left=`${row.box.left}px`;clone.style.top=`${row.box.top}px`;clone.style.width=`${row.box.width}px`;clone.style.height=`${row.box.height}px`;clone.style.margin='0';layer.append(clone);
     const animation=play(clone,'row-exit',mode==='full'?[{opacity:policy.opacityCurrent,transform:'translateY(0px)'},{opacity:policy.zero,transform:`translateY(-${policy.rowLift}px)`}]:[{opacity:policy.opacityCurrent},{opacity:policy.zero}],{duration,delay:index*rowDelay,easing:uiTokens.motion.easeOut,fill:'backwards'});
     animation.finished.then(()=>{clone.remove();if(!layer.childElementCount)layer.remove();}).catch(()=>{});
    }
   }
  }
  if(identity&&mode!=='off'&&runtime?.state){
   const state=runtime.state,ordered=[...measured].filter(([id])=>projection?.calls.has(id)&&!entered.current.has(id)).sort(([left],[right])=>{
    const first=(id:string)=>Math.min(...projection!.calls.get(id)!.map(call=>state.model.positions[call.enterId]));return first(left)-first(right);
   });
   const gap=Math.min(motionMs('entranceGap'),Math.max(0,(motionMs('entranceMax')-motionMs('list'))/Math.max(1,ordered.length-1)))/Math.max(1,rate);
   for(const[index,[id,node]]of ordered.entries()){
    entered.current.add(id);
    const opacity=Number(node.card.style.getPropertyValue('--u2-opacity'))||policy.opacityCurrent,lift=node.element.dataset.u2State==='current'?-policy.lift:0;
    play(node.card,'operation-enter',mode==='full'?[{opacity:opacity*policy.opacityNumberFrom,transform:`translateY(${policy.entranceLift}px)`},{opacity,transform:`translateY(${lift}px)`}]:[{opacity:opacity*policy.opacityNumberFrom},{opacity}],{duration,delay:index*gap,easing:uiTokens.motion.easeOut,fill:'backwards'});
   }
  }
  for(const element of host.current?.querySelectorAll<HTMLElement>(numberSelector)||[]){
   const text=element.textContent||'',old=numberText.current.get(element);numberText.current.set(element,text);
   if(mode!=='off'&&old!==undefined&&old!==text&&/\d/.test(text))play(element,'number',[{opacity:policy.opacityNumberFrom},{opacity:policy.opacityCurrent}],{duration:motionMs('digit'),easing:uiTokens.motion.easeOut});
  }
  for(const[id]of measured)if(projection?.calls.has(id))entered.current.add(id);
  previous.current=measured;operation.current=identity;
 },[host,runtime?.state?.cursor,runtime?.state?.model.key,runtime?.state?.model.fingerprint,runtime?.layoutKey,runtime?.operation?.id,projection,snapshot?.version,mode,links]);
 useEffect(()=>{
  const element=host.current;if(!element)return;
  const pick=(target:EventTarget|null)=>target instanceof Element?target.closest<HTMLElement>('.react-flow__node[data-id]')?.dataset.id:undefined;
  const over=(event:PointerEvent|FocusEvent)=>{const id=pick(event.target);if(id===hover.current)return;hover.current=id;cancelTransient();updateStates();};
  const out=(event:PointerEvent|FocusEvent)=>{const id=pick(event.relatedTarget);if(id===hover.current)return;hover.current=id;updateStates();};
  const leave=()=>{hover.current=undefined;updateStates();};
  const takeOver=()=>{previous.current=measure();cancelTransient();};
  element.addEventListener('pointerover',over);element.addEventListener('pointerout',out);element.addEventListener('pointerleave',leave);element.addEventListener('focusin',over);element.addEventListener('focusout',out);document.addEventListener('pointerdown',takeOver,true);
  return()=>{element.removeEventListener('pointerover',over);element.removeEventListener('pointerout',out);element.removeEventListener('pointerleave',leave);element.removeEventListener('focusin',over);element.removeEventListener('focusout',out);document.removeEventListener('pointerdown',takeOver,true);for(const slots of animations.current.values())for(const animation of slots.values())animation.cancel();animations.current.clear();element.querySelectorAll('.u2-exit-layer').forEach(node=>node.remove());};
 },[host]);
}
