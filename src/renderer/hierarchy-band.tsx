import {useId,useLayoutEffect,useRef,type RefObject} from 'react';
import {BaseEdge} from '@xyflow/react';
import tokens from '../shared/ui-tokens';
import type {HierarchyModule} from './hierarchy-model';
const t=tokens.hierarchy;
/** Geometry is sampled once; CSS owns the clock, including pauses and frame seeking. */
function travel(root:SVGElement,line:SVGPathElement,name:string,period:string){
 const length=line.getTotalLength(),sheet=root.querySelector('style')!.sheet;
 if(!sheet)return;
 while(sheet.cssRules.length)sheet.deleteRule(0);
 sheet.insertRule(`@keyframes ${name}{${Array.from({length:t.bandSamples+1},(_,i)=>{const p=line.getPointAtLength(length*i/t.bandSamples);return`${100*i/t.bandSamples}%{transform:translate(${p.x}px,${p.y}px)}`;}).join('')}}`);
 root.querySelectorAll<SVGCircleElement>('.hierarchy-travel-dot').forEach((dot,i)=>{
  const point=line.getPointAtLength(length*i/t.bandPoints);
  dot.style.transform=`translate(${point.x}px,${point.y}px)`;
  dot.style.animationName=name;dot.style.setProperty('--band-period',period);dot.style.setProperty('--band-phase',-parseFloat(period)*i/t.bandPoints+'ms');
 });
}
export function FrontendBand({id,path,dashed,onClick}:{id:string;path:string;dashed:boolean;onClick:()=>void}){
 const root=useRef<SVGGElement>(null),gradient='frontend-band-'+id.replace(/[^\w-]/g,'');
 useLayoutEffect(()=>{
  const line=root.current?.querySelector<SVGPathElement>('.react-flow__edge-path');if(root.current&&line)travel(root.current,line,gradient+'-travel',t.bandPeriod+'ms');
 },[path,gradient]);
 return <g ref={root} className="hierarchy-front-band" onClick={onClick}><style/><defs><linearGradient id={gradient}><stop stopColor={t.bandFrom}/><stop offset="100%" stopColor={t.bandTo}/></linearGradient></defs><BaseEdge id={id} path={path} style={{stroke:`url(#${gradient})`,strokeWidth:t.bandWidth,strokeDasharray:dashed?'6 5':undefined,vectorEffect:'non-scaling-stroke'}}/>{Array.from({length:t.bandPoints},(_,i)=><circle className="hierarchy-travel-dot" key={i} r={t.bandDotRadius}/>)}</g>;
}
export function HierarchyHoverBand(){
 const mask='hover-band-'+useId().replace(/[^\w-]/g,'');
 return <svg className="hierarchy-focus-band" aria-hidden="true"><style/><defs><mask id={mask} data-hover-mask="" maskUnits="userSpaceOnUse"><rect data-hover-background="" fill={tokens.overlay.maskVisible}/><g data-hover-cutouts=""/></mask></defs><g mask={`url(#${mask})`}><path data-hover-path=""/><circle className="hierarchy-travel-dot"/><circle className="hierarchy-travel-dot"/></g><circle className="hierarchy-endpoint"/></svg>;
}
export function useHierarchyHover(host:RefObject<HTMLDivElement|null>,enabled:boolean){
 useLayoutEffect(()=>{
  const root=host.current;if(!root||!enabled)return;
  let active:HierarchyModule|undefined,last:HierarchyModule|undefined;
  const paint=(module:HierarchyModule|undefined)=>{
   const overlay=root.querySelector<SVGSVGElement>('.hierarchy-focus-band');if(!overlay)return;
   root.classList.toggle('has-module-focus',!!module?.frontendCount);overlay.style.opacity='0';if(!module?.frontendCount)return;
   const block=root.querySelector<HTMLElement>(`[data-module-block="${CSS.escape(module.id)}"]`),front=[...root.querySelectorAll<HTMLElement>('.hierarchy-frontend[data-unit-id]')].find(e=>module.frontUnits.includes(e.dataset.unitId!));if(!block||!front)return;
   const matrix=overlay.getScreenCTM()?.inverse();if(!matrix)return;
   const point=(x:number,y:number)=>new DOMPoint(x,y).matrixTransform(matrix),a=front.getBoundingClientRect(),b=block.getBoundingClientRect(),scale=b.width/block.offsetWidth;
   const stripe=(parseFloat(getComputedStyle(block).borderLeftWidth)+parseFloat(getComputedStyle(block,'::before').width)/2)*scale;
   const start=point(a.right,a.top+a.height/2),end=point(b.left+stripe,b.top+b.height/2),middle=(start.x+end.x)/2;
   const max=Math.max(...[...root.querySelectorAll<HTMLElement>('[data-frontend-count]')].map(e=>Number(e.dataset.frontendCount))),path=overlay.querySelector<SVGPathElement>('[data-hover-path]')!,dot=overlay.querySelector('.hierarchy-endpoint')!;
   path.setAttribute('d',`M${start.x} ${start.y} C${middle} ${start.y} ${middle} ${end.y} ${end.x} ${end.y}`);
   path.style.setProperty('--overlay-stroke',String(Math.min(tokens.overlay.maximumStroke,Math.max(tokens.overlay.minimumStroke,t.bandMinimum+module.frontendCount/max*t.bandRange))));
   dot.setAttribute('cx',String(end.x));dot.setAttribute('cy',String(end.y));overlay.style.opacity='1';
   overlay.dataset.source=front.dataset.unitId;overlay.dataset.target=module.id;
   const pad=tokens.overlay.maximumStroke,maskBounds={x:Math.min(start.x,end.x)-pad,y:Math.min(start.y,end.y)-pad,width:Math.abs(end.x-start.x)+pad*2,height:Math.abs(end.y-start.y)+pad*2};
   for(const node of [overlay.querySelector('[data-hover-mask]')!,overlay.querySelector('[data-hover-background]')!])for(const [key,value]of Object.entries(maskBounds))node.setAttribute(key,String(value));
   // Occlusion is equivalent to placing the path under blocks, but above the service background.
   // All cutouts use the same world coordinates and transform; none is recomputed on zoom.
   const mask=overlay.querySelector('[data-hover-cutouts]')!;mask.replaceChildren();
   for(const node of root.querySelectorAll<HTMLElement>('[data-module-block],.hierarchy-application-heading,.module-group-heading')){
    const r=node.getBoundingClientRect(),p=point(r.left,r.top),q=point(r.right,r.bottom),rect=document.createElementNS('http://www.w3.org/2000/svg','rect');
    rect.setAttribute('x',String(p.x));rect.setAttribute('y',String(p.y));rect.setAttribute('width',String(q.x-p.x));rect.setAttribute('height',String(q.y-p.y));rect.setAttribute('fill',tokens.overlay.maskClear);rect.setAttribute('data-block-mask','');mask.append(rect);
   }
   travel(overlay,path,'hierarchy-hover-travel',tokens.viewMotion.dotHoverPeriod);
  };
  const hover=(event:Event)=>{active=(event as CustomEvent<HierarchyModule|undefined>).detail;if(active)last=active;paint(active);};
  const refresh=()=>{paint(active||last);if(!active){root.classList.remove('has-module-focus');const overlay=root.querySelector<SVGElement>('.hierarchy-focus-band');if(overlay)overlay.style.opacity='0';}};
  const moved=(event:TransitionEvent)=>{if(event.propertyName==='transform'&&(event.target as Element).matches('[data-module-block]'))refresh();};
  // A semantic tier can reflow hidden headings. Observe real content sizes, not viewport transforms.
  const sizes=new ResizeObserver(refresh),observed=new Set<Element>();
  const connect=()=>{for(const node of root.querySelectorAll('.module-group,.module-blocks,.hierarchy-unit,.hierarchy-application-heading,.module-group-heading'))if(!observed.has(node)){observed.add(node);sizes.observe(node);}};
  const mounted=new MutationObserver(connect);mounted.observe(root,{childList:true,subtree:true});connect();
  root.addEventListener('hierarchy-hover',hover);root.addEventListener('transitionend',moved);
  return()=>{mounted.disconnect();sizes.disconnect();root.removeEventListener('hierarchy-hover',hover);root.removeEventListener('transitionend',moved);};
 },[enabled,host]);
}
