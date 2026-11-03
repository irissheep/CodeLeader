import type {GraphCard,GraphLink} from './graph-model';
import {cardSize,type Point} from './graph-geometry';
import {boundsOf,look} from './adaptive-look';

/** Canonical world coordinates depend on content only, never on window or drawer width. */
export function adaptiveMainPositions(cards:GraphCard[],links:GraphLink[]){
 const positions:Record<string,Point>={},loose=cards.length<=look.looseCards,gap=loose?look.looseGap:look.standardGap;
 const front=cards.filter(c=>c.frontend),apps=cards.filter(c=>c.kind==='service'&&!c.frontend);
 const external=cards.filter(c=>c.external),resources=cards.filter(c=>c.kind==='resource');
 const outgoing=(id:string)=>links.filter(l=>l.type==='HTTP'&&l.source===id).length-links.filter(l=>l.type==='HTTP'&&l.target===id).length;
 apps.sort((a,b)=>outgoing(b.id)-outgoing(a.id)||a.id.localeCompare(b.id));
 let x=look.padding;
 for(const column of [front,apps,external]){
  if(!column.length)continue;
  const width=Math.max(...column.map(c=>cardSize(c).width)),height=column.reduce((n,c)=>n+cardSize(c).height,0)+(column.length-1)*gap;
  const columns=height/width>look.slenderRatio?2:1,perColumn=Math.ceil(column.length/columns),bottoms=Array(columns).fill(look.padding) as number[];
  for(const [i,card]of column.entries()){const slot=Math.floor(i/perColumn);positions[card.id]={x:x+slot*(width+gap)+(width-cardSize(card).width)/2,y:bottoms[slot]};bottoms[slot]+=cardSize(card).height+gap;}
  x+=columns*(width+gap);
 }
 const assigned=new Set<string>();
 for(const app of apps){
  const group=resources.filter(c=>!assigned.has(c.id)&&links.some(l=>l.source===app.id&&l.target===c.id));
  if(!group.length)continue;
  const columns=Math.min(3,group.length),width=Math.max(...group.map(c=>cardSize(c).width)),height=Math.max(...group.map(c=>cardSize(c).height));
  const start=positions[app.id].x+(cardSize(app).width-(columns*width+(columns-1)*gap))/2;
  const top=Math.max(...apps.map(c=>positions[c.id].y+cardSize(c).height))+look.resourceGap;
  group.forEach((card,i)=>{positions[card.id]={x:start+i%columns*(width+gap),y:top+Math.floor(i/columns)*(height+look.resourceGap)};assigned.add(card.id);});
 }
 const others=cards.filter(c=>!positions[c.id]);
 let top=Math.max(look.padding,...cards.filter(c=>positions[c.id]).map(c=>positions[c.id].y+cardSize(c).height+gap));
 for(let i=0;i<others.length;i+=2){const row=others.slice(i,i+2);let left=look.padding;for(const card of row){positions[card.id]={x:left,y:top};left+=cardSize(card).width+gap;}top+=Math.max(...row.map(c=>cardSize(c).height))+gap;}
 // Unrelated resources can share a row; never turn a tall small diagram into an endless column.
 const all=cards.map(c=>({...positions[c.id],...cardSize(c)})),bounds=all.length?boundsOf(all):undefined;
 if(bounds&&bounds.height/bounds.width>look.slenderRatio&&!links.length){
  let top=look.padding;for(let i=0;i<cards.length;i+=2){const row=cards.slice(i,i+2);let left=look.padding;for(const card of row){positions[card.id]={x:left,y:top};left+=cardSize(card).width+gap;}top+=Math.max(...row.map(c=>cardSize(c).height))+gap;}
 }
 // Multiple applications may share resources. Keep independently placed rows disjoint.
 const placed:{x:number;y:number;width:number;height:number}[]=[];
 for(const card of cards){const size=cardSize(card);let point=positions[card.id];while(placed.some(r=>point.x<r.x+r.width+look.minGap&&point.x+size.width+look.minGap>r.x&&point.y<r.y+r.height+look.minGap&&point.y+size.height+look.minGap>r.y))point={...point,y:Math.max(...placed.filter(r=>point.x<r.x+r.width+look.minGap&&point.x+size.width+look.minGap>r.x).map(r=>r.y+r.height))+gap};positions[card.id]=point;placed.push({...point,...size});}
 return positions;
}
