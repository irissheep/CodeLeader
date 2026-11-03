import policy from '../shared/adaptive-look.json';
import type {ProjectIndex} from '../shared/model';
import type {GraphCard,GraphResult} from './graph-model';
import type {LayoutSnapshot,Rect} from './graph-geometry';

export const look=Object.fromEntries(Object.entries(policy.thresholds).map(([key,item])=>[key,item.value])) as {[K in keyof typeof policy.thresholds]:number};
export type CardRole=keyof typeof policy.roles;
export type GraphDensity='loose'|'standard'|'compact';
export function graphDensity(cards:GraphCard[]):GraphDensity{
 const visible=cards.filter(c=>!c.ownerId&&c.kind!=='anchor');
 if(visible.length>look.standardCards||visible.some(c=>(c.capabilities?.length||0)>look.compactModules))return 'compact';
 return visible.length<=look.looseCards?'loose':'standard';
}
export function cardRole(card:GraphCard,index?:ProjectIndex):CardRole{
 if(card.kind==='browser')return 'browser';
 if(card.frontend||card.unit?.kind==='frontend')return 'frontend';
 if(card.external)return 'external';
 if(card.kind==='resource')return (policy.resourceRoles as Record<string,CardRole>)[card.resource?.kind||card.entity?.resourceKind||'']||'unknown';
 if(card.dependency)return card.dependency.role==='other'&&!card.symbol?'file':(policy.dependencyRoles as Record<string,{appearance:CardRole}>)[card.dependency.role]?.appearance||'unknown';
 if(card.kind==='service')return !card.unit&&!card.stack?'code':index?.units?.find(u=>u.id===card.unit?.id)?.language==='python'||card.language==='python'?'python':'backend';
 if(card.entryPoint||card.entry||['entry-group','domain'].includes(card.kind))return 'entry';
 if(card.kind==='file')return 'file';
 if(['symbol','type','module','group','more'].includes(card.kind))return 'code';
 return 'unknown';
}
export function presentGraph(graph:GraphResult,index:ProjectIndex):GraphResult{
 const density=graphDensity(graph.cards);
 const cards=graph.cards.map(card=>{
  const tiles=density==='compact'&&!!card.capabilities?.length&&!card.runtimeExpansion;
  const shown={...card,...(density==='compact'&&card.kind==='entry-group'?{compact:true}:{}),appearance:{density,role:cardRole(card,index),scale:density==='loose'?look.looseScale:1,tiles}};
  if(tiles&&card.inline){
   const ordered=[...card.capabilities!].sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name)),slot=ordered.findIndex(c=>c.id===card.inline!.domainId),rows=Math.ceil(ordered.length/look.tileColumns),count=graph.cards.filter(c=>c.ownerId===card.id&&c.kind!=='anchor').length;
   shown.inline={...card.inline,top:66+(Math.floor(Math.max(0,slot)/look.tileColumns)+1)*look.tileStep};
   shown.canvasSize={width:card.canvasSize?.width||460,height:Math.max(82+rows*look.tileStep+card.inline.height+40,shown.inline.top+count*190+50)+(card.unit?.notice?48:0)};
  }
  return shown;
 });
 for(const card of cards.filter(c=>c.kind==='anchor'&&c.local)){const owner=cards.find(c=>c.id===card.ownerId),old=graph.cards.find(c=>c.id===card.ownerId);if(owner?.inline&&old?.inline)card.local={...card.local!,y:card.local!.y+owner.inline.top-old.inline.top};}
 return{...graph,cards};
}
export function boundsOf(rects:Rect[]):Rect{
 const x=Math.min(...rects.map(n=>n.x)),y=Math.min(...rects.map(n=>n.y));
 return{x,y,width:Math.max(...rects.map(n=>n.x+n.width))-x,height:Math.max(...rects.map(n=>n.y+n.height))-y};
}
export function adaptiveViewport(snapshot:LayoutSnapshot,width:number,height:number){
 const bounds=boundsOf([...snapshot.nodes,...snapshot.regions]);
 const fit=Math.min((width-2*look.padding)/bounds.width,(height-2*look.padding)/bounds.height);
 const small=snapshot.nodes.length<=look.looseCards;
 const nodes=boundsOf(snapshot.nodes),required=Math.sqrt(look.minOccupation*width*height/(nodes.width*nodes.height));
 // The fit limit always wins: filling a small diagram must never crop a card.
 const zoom=Math.max(look.minimumZoom,Math.min(fit,small?Math.max(look.looseScale,required):1,look.maxZoom));
 return{x:width/2-(bounds.x+bounds.width/2)*zoom,y:height/2-(bounds.y+bounds.height/2)*zoom,zoom};
}
export function semanticBand(zoom:number,previous='full'){
 const h=look.zoomHysteresis;
 if(zoom<look.dotZoom*(previous==='dot'?1+h:1-h))return 'dot';
 if(zoom<look.pillZoom*(previous==='pill'||previous==='dot'?1+h:1-h))return 'pill';
 return 'full';
}
export function semanticTier(zoom:number,previous?:string){
 const names=['card','summary','application','overview'] as const,limits=[look.summaryZoom,look.applicationZoom,look.overviewZoom];
 let index=names.findIndex(name=>name===previous);if(index<0)index=limits.filter(limit=>zoom<limit).length;
 while(index<limits.length&&zoom<limits[index]*(1-look.zoomHysteresis))index++;
 while(index>0&&zoom>limits[index-1]*(1+look.zoomHysteresis))index--;
 return names[index];
}
export {policy as appearancePolicy};
