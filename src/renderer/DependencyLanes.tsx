import {useLayoutEffect,useRef,type RefObject,type CSSProperties} from 'react';
import {BaseEdge,EdgeLabelRenderer,type EdgeProps} from '@xyflow/react';
import type {GraphCard,GraphLink} from './graph-model';
import type {Point,LayoutSnapshot} from './graph-geometry';
import {roundedPath} from './graph-geometry';
import {Row,CardSurface} from './Layout';
import {primaryKind,type LaneId} from './dependency-lanes';
import tokens from '../shared/ui-tokens';
const t=tokens.lanes;
export function DependencyLaneCard({card,skeleton,enterOrder}:{card:GraphCard;skeleton?:boolean;enterOrder?:number}){
 const lane=card.dependencyLane!,description=lane.common?`被 ${lane.users.length} 个使用`:card.kind==='group'?card.tag:card.tag||card.summary;
 const enterDelay=useRef((enterOrder??lane.order)*t.entryStep).current;
 const hadSkeleton=useRef(!!skeleton).current;
 return <>{hadSkeleton&&<span aria-hidden="true" data-active={!!skeleton} className={`lane-skeleton-underlay ${lane.common?'lane-common-underlay':''}`}/>}<CardSurface className={`graph-card dependency-lane-card ${lane.common?'lane-common-chip':''} ${lane.compact?'lane-compact':''} ${skeleton?'lane-skeleton':''}`} data-lane-id={lane.id} data-lane-fold={card.kind==='group'} data-common-users={lane.users.length} style={{'--lane-color':t[lane.id as LaneId],'--lane-enter-delay':enterDelay+'ms'} as CSSProperties}>
  <Row className="lane-card-row" detail={<span className="lane-card-subtitle" title={description}>{description}</span>}><strong className="lane-card-name" title={card.name}>{card.name}</strong></Row>
  {!!lane.uses.length&&<span className="lane-common-dots" title={`用到 ${lane.uses.length} 处公共内容`} aria-label={`用到 ${lane.uses.length} 处公共内容`}>{Array.from({length:Math.min(t.commonDots,lane.uses.length)},(_,i)=><i key={i}/>)}</span>}
 </CardSurface></>;
}
export function DependencyLaneEdge(props:EdgeProps,{points,main,common,kind,color,path:override}:{points:Point[];main:boolean;common:boolean;kind?:string;color:string;path?:string}){
 const d=override||roundedPath(points,t.cornerRadius),id='lane-arrow-'+props.id.replace(/[^\w-]/g,''),mask='lane-draw-'+id,implementation=kind==='IMPLEMENTS',middle=points[Math.floor((points.length-1)/2)],next=points[Math.min(points.length-1,Math.floor((points.length-1)/2)+1)],label=override?{x:(props.sourceX+props.targetX)/2,y:(props.sourceY+props.targetY)/2}:{x:(middle.x+next.x)/2,y:(middle.y+next.y)/2};
 return <g className={`lane-edge-visual ${main?'lane-main':'lane-auxiliary'} ${common?'lane-common-edge':''}`} data-route-points={JSON.stringify(points)}>
  <defs>{main&&<marker id={id} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M1 1 L9 5 L1 9 Z" fill={implementation?'none':color} stroke={color}/></marker>}{main&&<mask id={mask} maskUnits="userSpaceOnUse" style={{maskType:'alpha'}} x={Math.min(...points.map(p=>p.x))-t.outerMargin} y={Math.min(...points.map(p=>p.y))-t.outerMargin} width={Math.max(...points.map(p=>p.x))-Math.min(...points.map(p=>p.x))+2*t.outerMargin} height={Math.max(...points.map(p=>p.y))-Math.min(...points.map(p=>p.y))+2*t.outerMargin}><path d={d} pathLength="1" stroke={tokens.color.text} strokeWidth={t.mainWidth+t.channelEscape} fill="none" className="lane-draw-mask"/></mask>}</defs>
  <g mask={main&&!override?`url(#${mask})`:undefined}><BaseEdge id={props.id} path={d} markerEnd={main?`url(#${id})`:undefined} style={props.style} interactionWidth={18}/></g>
  {main&&implementation&&<EdgeLabelRenderer><span className="lane-implementation-label" style={{transform:`translate(-50%,-50%) translate(${label.x}px,${label.y}px)`}}>实现</span></EdgeLabelRenderer>}
 </g>;
}
/** Focus is a paint-only change: neither the graph list nor DOM identities change. */
export function useDependencyLaneFocus(host:RefObject<HTMLDivElement|null>,enabled:boolean,snapshot:LayoutSnapshot|undefined,cards:GraphCard[],links:GraphLink[],selected?:string){
 useLayoutEffect(()=>{
  const root=host.current;if(!root||!enabled)return;
  const paint=(id?:string)=>{
   const active=id&&cards.find(c=>c.id===id);root.dataset.laneFocused=String(!!active);
   const adjacent=new Set(links.filter(l=>l.source===id||l.target===id).flatMap(l=>[l.source,l.target]));
   for(const node of root.querySelectorAll<HTMLElement>('.react-flow__node')){node.classList.toggle('lane-related',!!active&&(node.dataset.id===id||adjacent.has(node.dataset.id!)));node.classList.toggle('lane-unrelated',!!active&&node.dataset.id!==id&&!adjacent.has(node.dataset.id!));}
   for(const edge of root.querySelectorAll<SVGGElement>('.react-flow__edge')){const link=links.find(l=>l.id===edge.dataset.id),related=!!active&&!!link&&(link.source===id||link.target===id);edge.classList.toggle('lane-related',related);edge.classList.toggle('lane-unrelated',!!active&&!related);}
  };
  const over=(event:Event)=>{const node=(event.target as Element).closest('.react-flow__node');if(node&&root.contains(node))paint(node.getAttribute('data-id')!);};
  const out=(event:Event)=>{const node=(event.target as Element).closest('.react-flow__node'),other=(event as MouseEvent).relatedTarget as Element|null;if(node&&other&&node.contains(other))return;paint(selected);};
  root.addEventListener('pointerover',over);root.addEventListener('pointerout',out);root.addEventListener('focusin',over);root.addEventListener('focusout',out);paint(selected);
  return()=>{root.removeEventListener('pointerover',over);root.removeEventListener('pointerout',out);root.removeEventListener('focusin',over);root.removeEventListener('focusout',out);};
 },[host,enabled,snapshot,cards,links,selected]);
}
export function laneEdgeStyle(link:GraphLink,main:boolean,common:boolean,color:string){
 const kind=primaryKind(link);return{stroke:color,strokeWidth:main?t.mainWidth:t.auxiliaryWidth,strokeDasharray:main?kind==='IMPLEMENTS'?t.implementationDash:undefined:t.auxiliaryDash,opacity:common?0:main?t.mainOpacity:t.auxiliaryOpacity};
}
