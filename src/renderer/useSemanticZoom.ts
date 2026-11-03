import {useLayoutEffect,type RefObject} from 'react';
import {look,semanticTier} from './adaptive-look';
import {roundedPath,type LayoutSnapshot,type Point} from './graph-geometry';
import uiTokens from '../shared/ui-tokens';

/** Zoom changes the presentation layer and port endpoints, never node identities or world positions. */
export function useSemanticZoom(host:RefObject<HTMLDivElement|null>,snapshot?:LayoutSnapshot,enabled=true){
 useLayoutEffect(()=>{
  const area=host.current;if(!area)return;
  let idle=0,lastZoom=0,metadataBuilt=false;
  const ports=new Map((snapshot?.nodes||[]).flatMap(node=>node.ports.map(port=>[port.id,{node,port}] as const))),paths=new Map<string,SVGPathElement>();
  const canvas=document.createElement('canvas'),context=canvas.getContext('2d');if(context)context.font='600 14px Inter, sans-serif';
  let labels:{node:NonNullable<typeof snapshot>['nodes'][number];element:HTMLElement;width:number;priority:number}[]=[];
  let leaves:{element:HTMLElement;available:number;required:number;scale:number}[]=[];
  const collectLeaves=(zoom:number)=>{leaves=[...area.querySelectorAll<HTMLElement>('.module-name')].flatMap(element=>{const card=element.closest<HTMLElement>('.card-accessible'),scale=Number(card&&getComputedStyle(card).getPropertyValue('--card-scale'))||1,style=getComputedStyle(element),available=element.clientWidth;if(!available||!context)return[];context.font=style.font;const required=context.measureText(element.textContent||'').width*zoom*scale;return[{element,available,required,scale}];});if(context)context.font='600 14px Inter, sans-serif';};
  const placeLeaves=(zoom:number,tier:string)=>{if(tier!=='card')return;for(const leaf of leaves){const value=leaf.available*zoom*leaf.scale+1<leaf.required?'true':'false';if(leaf.element.dataset.zoomHide!==value)leaf.element.dataset.zoomHide=value;}};
  const collectLabels=()=>{labels=(snapshot?.nodes||[]).flatMap(node=>{const element=area.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(node.id)}"] .card-accessible`),name=element?.querySelector<HTMLElement>('.semantic-token>span')?.textContent;if(!element||!name)return[];return[{node,element,width:context?.measureText(name).width||name.length*14,priority:Number(element.dataset.zoomPriority)||0}];}).sort((a,b)=>b.priority-a.priority||a.node.id.localeCompare(b.node.id));};
  const placeLabels=(zoom:number,tier:string)=>{
   if(tier==='application'){for(const {node,element,width} of labels){const value=node.width*zoom-look.applicationLabelReserve<width?'hidden':'visible';if(element.dataset.zoomLabel!==value)element.dataset.zoomLabel=value;}return;}
   if(tier!=='overview')return;
   const gap=look.overviewLabelGap,dot=Math.max(look.dotSize*zoom,look.dotMinScreenSize),icons=labels.map(({node})=>({id:node.id,x:(node.x+node.width/2)*zoom-dot/2,y:(node.y+node.height/2)*zoom-dot/2,width:dot,height:dot})),occupied:{x:number;y:number;width:number;height:number}[]=[];
   const intersects=(a:{x:number;y:number;width:number;height:number},b:{x:number;y:number;width:number;height:number})=>a.x<b.x+b.width+gap&&a.x+a.width+gap>b.x&&a.y<b.y+b.height+gap&&a.y+a.height+gap>b.y;
   for(const {node,element,width} of labels){const x=(node.x+node.width/2)*zoom-width/2,center=(node.y+node.height/2)*zoom,choices=[{place:'below',box:{x,y:center+dot/2+gap,width,height:look.overviewLabelHeight}},{place:'above',box:{x,y:center-dot/2-gap-look.overviewLabelHeight,width,height:look.overviewLabelHeight}}],fits=width<=Math.min(look.overviewLabelWidth,node.width*zoom)&&node.height*zoom>=dot+2*(gap+look.overviewLabelHeight),chosen=fits?choices.find(({box})=>!occupied.some(item=>intersects(box,item))&&!icons.some(item=>item.id!==node.id&&intersects(box,item))):undefined,value=chosen?'visible':'hidden';if(element.dataset.zoomLabel!==value)element.dataset.zoomLabel=value;if(chosen){if(element.dataset.zoomPlace!==chosen.place)element.dataset.zoomPlace=chosen.place;occupied.push(chosen.box);}}
  };
  const flag=(name:string,value:string)=>{if(area.dataset[name]!==value)area.dataset[name]=value;};
  const threshold=(zoom:number,value:number,old:string|undefined)=>old==='small'?zoom>=value*(1+look.zoomHysteresis):old==='full'?zoom>=value*(1-look.zoomHysteresis):zoom>=value;
  const update=(fonts=false)=>{
   const viewport=area.querySelector<HTMLElement>('.react-flow__viewport');if(!viewport)return;
   const zoom=new DOMMatrix(viewport.style.transform).a;
   if(zoom!==lastZoom){lastZoom=zoom;area.style.setProperty('--z',String(zoom));}
   flag('layoutDetail',threshold(zoom,look.pillZoom,area.dataset.layoutDetail)?'full':'small');
   flag('blockCompact',String(!threshold(zoom,uiTokens.hierarchy.compactBlockZoom,area.dataset.blockCompact==='true'?'small':'full')));
   flag('laneDetail',threshold(zoom,uiTokens.lanes.subtitleZoom,area.dataset.laneDetail)?'full':'small');
   flag('leafMetrics',threshold(zoom,look.leafMetricsZoom,area.dataset.leafMetrics)?'full':'small');
   const tier=enabled?semanticTier(zoom,area.dataset.tier):'card';
   const band=tier==='overview'?'dot':tier==='application'?'pill':'full';
   const bandChanged=area.dataset.semantic!==band,versionChanged=area.dataset.semanticVersion!==String(snapshot?.version);
   const changed=bandChanged||area.dataset.tier!==tier||versionChanged;
   if(!metadataBuilt){collectLabels();collectLeaves(zoom);metadataBuilt=labels.length>0||!(snapshot?.nodes.length);}
   placeLabels(zoom,tier);
   placeLeaves(zoom,tier);
   if(!fonts&&!changed)return;
   area.dataset.tier=tier;area.dataset.semantic=band;area.dataset.semanticVersion=String(snapshot?.version);
   area.dataset.semanticZoom=String(zoom);
   if(!bandChanged&&!versionChanged)return;
   for(const body of area.querySelectorAll<HTMLElement>('.card-body-layer'))if(body.inert!==(band!=='full'))body.inert=band!=='full';
   for(const button of area.querySelectorAll<HTMLButtonElement>('.semantic-token'))if(button.tabIndex!==(band==='full'?-1:0))button.tabIndex=band==='full'?-1:0;
   for(const edge of snapshot?.edges||[]){
    let path=paths.get(edge.id);if(!path?.isConnected){path=area.querySelector<SVGPathElement>(`.react-flow__edge[data-id="${CSS.escape(edge.id)}"] .react-flow__edge-path`)||undefined;if(path)paths.set(edge.id,path);}if(!path)continue;
    const points=edge.points.map(p=>({...p}));
    if(band!=='full')for(const [source,at,next]of [[true,0,1],[false,points.length-1,points.length-2]] as const){
     const found=ports.get(source?edge.sourcePort:edge.targetPort);if(!found)continue;const {node,port}=found;
     const width=band==='dot'?Math.max(look.dotSize,look.dotMinScreenSize/zoom):node.width,height=band==='dot'?Math.max(look.dotSize,look.dotMinScreenSize/zoom):Math.max(look.pillHeight,look.pillMinScreenHeight/zoom);
     const x=node.x+(node.width-width)/2,y=node.y+(node.height-height)/2;
     const endpoint:Point={x:port.side==='left'?x:port.side==='right'?x+width:x+width/2,y:port.side==='top'?y:port.side==='bottom'?y+height:y+height/2};
     points[at]=endpoint;
     if(points[next]){if(port.side==='left'||port.side==='right')points[next].y=endpoint.y;else points[next].x=endpoint.x;}
    }
    path.setAttribute('d',roundedPath(points,look.cornerRadius));
   }
  };
  const observer=new MutationObserver(()=>{update();clearTimeout(idle);if(!area.classList.contains('zooming'))idle=window.setTimeout(()=>update(true),uiTokens.zoom.settleDelay);});
  // The viewport can mount after the canvas's first effect while the library initializes.
  const connect=()=>{const viewport=area.querySelector('.react-flow__viewport');if(!viewport)return;mount.disconnect();observer.observe(viewport,{attributes:true,attributeFilter:['style']});update(true);};
  const mount=new MutationObserver(connect);mount.observe(area,{childList:true,subtree:true});connect();
  const visibleNodes=new MutationObserver(records=>{if(records.some(record=>record.target instanceof Element&&record.target.classList.contains('react-flow__nodes'))){metadataBuilt=false;update();}});
  visibleNodes.observe(area,{childList:true,subtree:true});
  const stopFonts=()=>clearTimeout(idle);area.addEventListener('wheel',stopFonts,{capture:true,passive:true});
  return()=>{mount.disconnect();observer.disconnect();visibleNodes.disconnect();clearTimeout(idle);area.removeEventListener('wheel',stopFonts,true);};
 },[host,snapshot,enabled]);
}
