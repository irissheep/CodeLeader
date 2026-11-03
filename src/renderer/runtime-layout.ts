import type {ExecutionSession} from '../shared/execution';
import type {ProjectIndex} from '../shared/model';
import type {GraphCard,GraphLink} from './graph-model';
import {cardSize,routeSnapshot,type Point} from './graph-geometry';
import {runtimeColumnPositions} from './runtime-column-layout';

export function mainPositions(cards:GraphCard[],links:GraphLink[]):Record<string,Point>{
 const positions:Record<string,Point>={},score=(id:string)=>links.filter(l=>l.type==='HTTP'&&l.source===id).length-links.filter(l=>l.type==='HTTP'&&l.target===id).length;
 const services=cards.filter(c=>c.kind==='service').sort((a,b)=>score(b.id)-score(a.id)||a.id.localeCompare(b.id)),columns=Math.min(3,Math.max(1,services.length));let top=110;
 for(let row=0;row<Math.ceil(services.length/columns);row++){const members=services.slice(row*columns,(row+1)*columns);members.forEach((card,i)=>positions[card.id]={x:40+i*516,y:top});top+=Math.max(...members.map(c=>cardSize(c).height))+190;}
 const owners=new Map(cards.filter(c=>c.kind==='resource').map(resource=>[resource.id,[...new Set(links.filter(l=>l.target===resource.id).map(l=>l.source))]])),allocated=new Map<string,number>();
 for(const resource of cards.filter(c=>c.kind==='resource')){const related=owners.get(resource.id)||[],key=related.slice().sort().join('|'),slot=allocated.get(key)||0;allocated.set(key,slot+1);
  const parents=related.flatMap(id=>services.filter(c=>c.id===id)),center=parents.length?parents.reduce((sum,c)=>sum+positions[c.id].x+cardSize(c).width/2,0)/parents.length:300;
  const bottom=parents.length?Math.max(...parents.map(c=>positions[c.id].y+cardSize(c).height)):top,total=[...owners.values()].filter(ids=>ids.slice().sort().join('|')===key).length;
  positions[resource.id]={x:total===1?center-cardSize(resource).width/2:center-225+(slot%2)*240,y:bottom+72+Math.floor(slot/2)*118};
 }
 for(const browser of cards.filter(c=>c.kind==='browser'))positions[browser.id]={x:(positions[services[0]?.id]?.x||70)+125,y:(positions[services[0]?.id]?.y||110)-160};
 const remaining=cards.filter(card=>!positions[card.id]);let bottom=Math.max(0,...cards.filter(card=>positions[card.id]).map(card=>positions[card.id].y+cardSize(card).height))+72;
 for(let i=0;i<remaining.length;i+=2){const row=remaining.slice(i,i+2);let left=40;for(const card of row){positions[card.id]={x:left,y:bottom};left+=cardSize(card).width+32;}bottom+=Math.max(...row.map(card=>cardSize(card).height))+32;}
 return positions;
}

/** Reserve observed method space once per session so shared backbone cards keep their positions. */
export function runtimeEnvelopes(index:ProjectIndex,record:ExecutionSession|undefined,cards:GraphCard[]){
 const sizes:Record<string,{width:number;height:number}>={},counts=new Map<string,Set<string>>(),symbols=new Map(index.symbols.map(s=>[s.id,s]));
 for(const span of record?.spans||[]){const service=span.attributes['codeleader.service_id']||symbols.get(span.symbolId||'')?.serviceId;if(typeof service!=='string'||!span.versionMatch)continue;const key=service+'|'+span.traceId;if(!counts.has(key))counts.set(key,new Set());counts.get(key)!.add(String(span.attributes['codeleader.invocation']||span.spanId));}
 for(const card of cards.filter(c=>c.kind==='service')){const rows=Math.max(0,...[...counts].filter(([key])=>key.startsWith(card.id+'|')).map(([,calls])=>calls.size)),base=cardSize({...card,canvasSize:undefined,runtimeExpansion:undefined});sizes[card.id]={width:base.width,height:Math.max(base.height,82+Math.ceil((card.capabilities?.length||0)/2)*52+rows*54+32)};}
 return sizes;
}

export function runtimeLayout(version:number,cards:GraphCard[],links:GraphLink[],sizes:ReturnType<typeof runtimeEnvelopes>,column:boolean,overrides?:Record<string,Point>){
 const reserved=cards.map(card=>sizes[card.id]?{...card,canvasSize:{width:Math.max(cardSize(card).width,sizes[card.id].width),height:Math.max(cardSize(card).height,sizes[card.id].height)}}:card);
 return routeSnapshot(version,cards,links,{...(column?runtimeColumnPositions(reserved,links):mainPositions(reserved,links)),...overrides});
}
