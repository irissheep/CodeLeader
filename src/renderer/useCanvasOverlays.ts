import {useLayoutEffect,useRef,type RefObject} from 'react';
import {useStoreApi} from '@xyflow/react';
import tokens from '../shared/ui-tokens';

/** Only screen popups need a movement clock. Graph geometry stays in the viewport. */
export function useCanvasOverlays(host:RefObject<HTMLDivElement|null>){
 const store=useStoreApi();
 useLayoutEffect(()=>{
  const root=host.current;if(!root)return;
  let timer=0,pointer:{x:number;y:number}|undefined,hovered:Element|null=null,zoom=store.getState().transform[2];
  let scaled:SVGElement[]=[];
  const refresh=()=>{scaled=[...root.querySelectorAll<SVGElement>('.hierarchy-focus-band,.hierarchy-front-band')];for(const node of scaled)node.style.setProperty('--overlay-inverse-zoom',String(1/zoom));};
  const mark=(target:Element|null)=>{const card=target?.closest('.card-accessible')||null;if(card===hovered)return;hovered?.classList.remove('overlay-under-pointer');hovered=card;hovered?.classList.add('overlay-under-pointer');};
  const settle=()=>{root.dataset.overlayMoving='false';const target=pointer?document.elementFromPoint(pointer.x,pointer.y):null;mark(target);root.dispatchEvent(new CustomEvent('canvas-settled',{bubbles:true,detail:pointer}));};
  const moving=()=>{
   if(root.dataset.overlayMoving!=='true'){root.dataset.overlayMoving='true';root.dispatchEvent(new CustomEvent('canvas-moving',{bubbles:true}));}
   clearTimeout(timer);timer=window.setTimeout(settle,tokens.zoom.settleDelay);
  };
  const point=(event:PointerEvent|WheelEvent)=>{pointer={x:event.clientX,y:event.clientY};};
  const over=(event:PointerEvent)=>{point(event);if(root.dataset.overlayMoving!=='true')mark(event.target as Element);};
  const wheel=(event:WheelEvent)=>{if((event.target as Element).closest('.nowheel'))return;point(event);moving();};
  const down=(event:PointerEvent)=>{point(event);if((event.target as Element).classList.contains('react-flow__pane'))moving();};
  const dismiss=()=>{hovered?.classList.remove('overlay-under-pointer');hovered=null;root.dispatchEvent(new CustomEvent('canvas-moving',{bubbles:true}));};
  const unsubscribe=store.subscribe((state,previous)=>{
   if(state.transform.every((n,i)=>n===previous.transform[i]))return;
   if(zoom!==state.transform[2]){zoom=state.transform[2];for(const node of scaled)node.style.setProperty('--overlay-inverse-zoom',String(1/zoom));}
   moving();
  });
  const observer=new MutationObserver(refresh);observer.observe(root,{childList:true,subtree:true});refresh();root.dataset.overlayReady='true';
  root.addEventListener('pointermove',over,true);root.addEventListener('pointerdown',down,true);root.addEventListener('wheel',wheel,true);root.addEventListener('canvas-dismiss',dismiss);
  return()=>{clearTimeout(timer);unsubscribe();observer.disconnect();hovered?.classList.remove('overlay-under-pointer');root.removeEventListener('pointermove',over,true);root.removeEventListener('pointerdown',down,true);root.removeEventListener('wheel',wheel,true);root.removeEventListener('canvas-dismiss',dismiss);delete root.dataset.overlayMoving;delete root.dataset.overlayReady;};
 },[host,store]);
}

/** A screen dialog closes rather than remaining attached to an obsolete screen point. */
export function useCanvasPopup(anchor:RefObject<HTMLElement|null>,close:()=>void,resume?:()=>void){
 const callbacks=useRef({close,resume});callbacks.current={close,resume};
 useLayoutEffect(()=>{
  const root=anchor.current?.closest('.graph-canvas');if(!root)return;
  const hide=()=>callbacks.current.close();
  const settled=(event:Event)=>{const p=(event as CustomEvent<{x:number;y:number}|undefined>).detail;if(p&&anchor.current?.contains(document.elementFromPoint(p.x,p.y)))callbacks.current.resume?.();};
  root.addEventListener('canvas-moving',hide);root.addEventListener('canvas-settled',settled);
  return()=>{root.removeEventListener('canvas-moving',hide);root.removeEventListener('canvas-settled',settled);};
 },[anchor]);
}
