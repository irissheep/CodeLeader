import {cardSize,type Point} from './graph-geometry';
import type {GraphCard,GraphLink} from './graph-model';
/** A single column keeps the same services/resources readable beside an open drawer. */
export function runtimeColumnPositions(cards:GraphCard[],links:GraphLink[]):Record<string,Point>{
 const positions:Record<string,Point>={},placed=new Set<string>();let top=0;
 for(const browser of cards.filter(c=>c.kind==='browser')){positions[browser.id]={x:155,y:top};placed.add(browser.id);top+=cardSize(browser).height+56;}
 const score=(id:string)=>links.filter(l=>l.type==='HTTP'&&l.source===id).length-links.filter(l=>l.type==='HTTP'&&l.target===id).length;
 const services=cards.filter(c=>c.kind==='service').sort((a,b)=>score(b.id)-score(a.id)||a.id.localeCompare(b.id));
 const resources=(members:GraphCard[])=>{for(let i=0;i<members.length;i+=2){const row=members.slice(i,i+2);row.forEach((card,column)=>{positions[card.id]={x:row.length===1?260-cardSize(card).width/2:35+column*240,y:top};placed.add(card.id);});top+=Math.max(...row.map(c=>cardSize(c).height))+24;}};
 for(const service of services){positions[service.id]={x:30,y:top};placed.add(service.id);top+=cardSize(service).height+56;
  resources(cards.filter(c=>c.kind==='resource'&&!placed.has(c.id)&&links.some(l=>l.source===service.id&&l.target===c.id)));top+=24;
 }
 resources(cards.filter(c=>!placed.has(c.id)));return positions;
}
