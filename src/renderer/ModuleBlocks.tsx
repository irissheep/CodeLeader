import {createContext,memo,useCallback,useContext,useLayoutEffect,useMemo,useRef,useState,type CSSProperties,type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import tokens from '../shared/ui-tokens';
import {Row} from './Layout';
import {GuideMark} from './Orientation';
import {moduleHeat,moduleTitle,type HierarchyGroup,type HierarchyModule} from './hierarchy-model';
const t=tokens.hierarchy,colors=tokens.httpMethod;
const moduleElements=new WeakMap<HTMLElement,HierarchyModule>();
const TooltipContext=createContext<{show:(module:HierarchyModule,anchor:HTMLElement)=>void;hide:()=>void}>({show:()=>{},hide:()=>{}});
export function MethodBar({methods}:{methods:HierarchyModule['methods']}){
 return <span className="module-method-bar" aria-hidden="true">{methods.map(m=><i key={m.name} style={{flexGrow:m.count,backgroundColor:(colors as Record<string,string>)[m.name]||colors.other}}/>)}</span>;
}
export const ModuleBlock=memo(function ModuleBlock({module,selected=false,index=0,onSelect,guideUnit}:{module:HierarchyModule;selected?:boolean;index?:number;onSelect:()=>void;guideUnit?:string}){
 const tip=useContext(TooltipContext),heat=moduleHeat(module.heatAvailable?module.frontendCount:0);
 const moving=(element:HTMLElement)=>element.closest<HTMLElement>('.graph-canvas')?.dataset.overlayMoving==='true';
 const enter=(element:HTMLElement)=>{if(moving(element))return;tip.show(module,element);element.dispatchEvent(new CustomEvent('hierarchy-hover',{bubbles:true,detail:module}));};
 const leave=(element:HTMLElement)=>{tip.hide();if(!moving(element))element.dispatchEvent(new CustomEvent('hierarchy-hover',{bubbles:true}));};
 const register=useCallback((element:HTMLButtonElement|null)=>{if(element)moduleElements.set(element,module);},[module]);
 return <button ref={register} type="button" className="module-block nodrag nopan" data-module-block={module.id} data-module-name={module.name} data-entry-count={module.count} data-module-width={module.width} data-module-scale={module.scale} data-frontend-count={module.frontendCount} data-has-tooltip="true" aria-label={moduleTitle(module)} aria-pressed={selected} style={{width:module.width*module.scale,height:t.blockHeight*module.scale,'--module-tint':heat.fill,'--module-heat-line':heat.line,'--module-enter-delay':index*t.entryStep+'ms'} as CSSProperties} onMouseEnter={e=>enter(e.currentTarget)} onMouseLeave={e=>leave(e.currentTarget)} onFocus={e=>enter(e.currentTarget)} onBlur={e=>leave(e.currentTarget)} onKeyDown={e=>{if(e.key==='Escape'){tip.hide();e.currentTarget.blur();}}} onClick={e=>{e.stopPropagation();tip.hide();onSelect();}}>
  {guideUnit&&<GuideMark kind="backend" id={guideUnit}/>}<Row className="module-title"><span className="module-name card-name">{module.name}</span></Row>
  <Row className="module-metric" visual leading={<span className="module-amount"><span>{module.count}</span><kbd>Enter</kbd></span>}><MethodBar methods={module.methods}/></Row>
 </button>;
});
export function ModuleGroups({groups,selected,start=0,onSelect,guideUnit}:{groups:HierarchyGroup[];selected?:string;start?:number;onSelect:(module:HierarchyModule)=>void;guideUnit?:string}){
 let order=start,first=true;return <div className="module-groups">{groups.map(group=><section className="module-group" key={group.name||'modules'}>{group.name&&<div className="module-group-heading"><strong>{group.name}</strong><span>{group.modules.length} 个模块 · {group.count} 个接口</span></div>}<div className="module-blocks">{group.modules.map(module=>{const marker=first?guideUnit:undefined;first=false;return <ModuleBlock key={module.id} module={module} selected={selected===module.id} index={order++} guideUnit={marker} onSelect={()=>onSelect(module)}/>;})}</div></section>)}</div>;
}
type Active={module:HierarchyModule;anchor:HTMLElement};
function placeTooltip(active:Active,element:HTMLDivElement){
 const root=active.anchor.closest<HTMLElement>('.graph-canvas');if(!root||root.dataset.overlayMoving==='true')return;
 const area=root.getBoundingClientRect(),anchor=active.anchor.getBoundingClientRect(),box=element.getBoundingClientRect();
 const bounds={left:Math.max(t.tooltipMargin,area.left+t.tooltipMargin),right:Math.min(innerWidth,area.right)-t.tooltipMargin,top:Math.max(t.tooltipTop,area.top)+t.tooltipMargin,bottom:Math.min(innerHeight,area.bottom)-t.tooltipMargin};
 const rects=(selector:string)=>[...root.querySelectorAll<HTMLElement>(selector)].filter(e=>e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true})).map(e=>e.getBoundingClientRect()).filter(r=>r.width&&r.height&&r.bottom>bounds.top&&r.top<bounds.bottom);
 const blocks=rects('[data-module-block]'),headings=rects('.hierarchy-application-heading,.hierarchy-frontend-heading,.module-group-heading'),obstacles=[...blocks,...headings];
 const overlap=(x:number,y:number,r:DOMRect)=>x<r.right&&x+box.width>r.left&&y<r.bottom&&y+box.height>r.top;
 const xs=[anchor.x+(anchor.width-box.width)/2,Math.max(...blocks.map(r=>r.right))+t.tooltipGap,bounds.left,bounds.right-box.width].map(x=>Math.max(bounds.left,Math.min(bounds.right-box.width,x)));
 const above=[anchor.top-box.height-t.tooltipGap,...blocks.map(r=>r.top-box.height-t.tooltipGap)].filter(y=>y>=bounds.top&&y+box.height<=anchor.top).sort((a,b)=>b-a);
 const below=[anchor.bottom+t.tooltipGap,...blocks.map(r=>r.bottom+t.tooltipGap)].filter(y=>y>=anchor.bottom&&y+box.height<=bounds.bottom).sort((a,b)=>a-b);
 const coversTitle=headings.some(r=>overlap(xs[0],anchor.top-box.height-t.tooltipGap,r));let point:{x:number;y:number}|undefined;
 for(const y of coversTitle?[...below,...above]:[...above,...below]){for(const x of xs)if(!obstacles.some(r=>overlap(x,y,r))){point={x,y};break;}if(point)break;}
 if(!point){element.style.visibility='hidden';element.dataset.unplaced='true';return;}
 delete element.dataset.unplaced;element.style.left=point.x+'px';element.style.top=point.y+'px';element.style.visibility='visible';element.dataset.open='true';element.setAttribute('aria-hidden','false');
}
export function ModuleTooltipProvider({children}:{children:ReactNode}){
 const [active,setActive]=useState<Active>(),latest=useRef<Active|undefined>(undefined),popup=useRef<HTMLDivElement>(null);
 const hide=useCallback(()=>{if(popup.current){popup.current.dataset.open='false';popup.current.setAttribute('aria-hidden','true');}},[]);
 const show=useCallback((module:HierarchyModule,anchor:HTMLElement)=>{if(anchor.closest<HTMLElement>('.graph-canvas')?.dataset.overlayMoving==='true')return;if(latest.current?.module===module&&latest.current.anchor===anchor){if(popup.current)placeTooltip(latest.current,popup.current);return;}latest.current={module,anchor};setActive(latest.current);},[]),context=useMemo(()=>({show,hide}),[show,hide]);
 useLayoutEffect(()=>{
  if(active&&popup.current)placeTooltip(active,popup.current);
 },[active]);
 useLayoutEffect(()=>{
  const moving=()=>{hide();if(popup.current)popup.current.style.visibility='hidden';};
  const settled=(event:Event)=>{const root=event.target as HTMLElement,p=(event as CustomEvent<{x:number;y:number}|undefined>).detail;if(!p)return;const element=document.elementFromPoint(p.x,p.y)?.closest<HTMLElement>('[data-module-block]'),module=element&&moduleElements.get(element);if(element&&module&&root.contains(element)){show(module,element);element.dispatchEvent(new CustomEvent('hierarchy-hover',{bubbles:true,detail:module}));}else{moving();root.dispatchEvent(new CustomEvent('hierarchy-hover',{bubbles:true}));}};
  document.addEventListener('canvas-moving',moving);document.addEventListener('canvas-settled',settled);window.addEventListener('resize',moving);
  return()=>{document.removeEventListener('canvas-moving',moving);document.removeEventListener('canvas-settled',settled);window.removeEventListener('resize',moving);};
 },[show,hide]);
 return <TooltipContext.Provider value={context}>{children}{active&&createPortal(<div ref={popup} className="module-tooltip" role="tooltip" data-open="false" aria-hidden="true" data-module-tooltip={active.module.id} style={{visibility:'hidden'}}><strong>{moduleTitle(active.module).replace(/^\//,'')}</strong><p>{active.module.count} 个接口 · {active.module.frontendCount?`前端调用 ${active.module.frontendCount} 次`:'前端没有调用'}</p><MethodBar methods={active.module.methods}/><div className="module-method-legend">{active.module.methods.map(m=><span key={m.name}><i style={{backgroundColor:(colors as Record<string,string>)[m.name]||colors.other}}/>{m.name} {m.count}</span>)}</div></div>,document.body)}</TooltipContext.Provider>;
}
