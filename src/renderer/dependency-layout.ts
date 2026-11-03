import type {GraphCard,GraphLink} from './graph-model';
import type {Point,Rect} from './graph-geometry';
import {cardSize,routeSnapshot} from './graph-geometry';
import {pathCrossings,pathOverlap,sharedDependencyNodes} from './dependency-routing';
import policy from '../shared/dependency-policy.json';
export function dependencyPositions(cards:GraphCard[],links:GraphLink[],saved:Record<string,Point>={},initialX:Record<string,number>={}){
 const t=policy.thresholds,stepX=Math.max(t.cardWidth.value,...cards.map(c=>cardSize(c).width))+t.columnGap.value,stepY=Math.max(t.cardHeight.value,...cards.map(c=>cardSize(c).height))+t.rowGap.value,margin=t.margin.value;
 const groups=new Map<number,GraphCard[]>();for(const c of cards.filter(c=>!c.dependency?.side)){const layer=c.dependency?.layer||0;groups.set(layer,[...(groups.get(layer)||[]),c]);}
 for(const list of groups.values())list.sort((a,b)=>(initialX[a.id]||0)-(initialX[b.id]||0)||a.name.localeCompare(b.name));
 const initial=new Map([...groups].map(([layer,list])=>[layer,[...list]])),byId=new Map(cards.map(c=>[c.id,c]));
 const neighbors=(card:GraphCard,down:boolean)=>links.filter(l=>l.source===card.id||l.target===card.id).map(l=>l.source===card.id?l.target:l.source).filter(id=>down?(byId.get(id)?.dependency?.layer||0)<(card.dependency?.layer||0):(byId.get(id)?.dependency?.layer||0)>(card.dependency?.layer||0));
 for(let pass=0;pass<t.orderPasses.value;pass++){
  const ranks=new Map([...groups.values()].flatMap(list=>list.map((c,i)=>[c.id,i] as const)));
  for(const list of [...groups.entries()].sort((a,b)=>pass%2?a[0]-b[0]:b[0]-a[0]).map(([,list])=>list))list.sort((a,b)=>{
   const score=(card:GraphCard)=>{const values=neighbors(card,pass%2===1).map(id=>ranks.get(id)).filter((n):n is number=>n!==undefined);return values.length?values.reduce((a,b)=>a+b,0)/values.length:ranks.get(card.id)||0;};return score(a)-score(b)||(ranks.get(a.id)||0)-(ranks.get(b.id)||0)||a.id.localeCompare(b.id);
  });
 }
 const width=Math.max(1,...[...groups.values()].map(g=>g.length)),shared=sharedDependencyNodes(cards,links);
 const arrange=(rows:Map<number,GraphCard[]>)=>{
  const positions:Record<string,Point>={};
  for(const [layer,list]of rows)list.forEach((card,i)=>positions[card.id]={x:margin+(i+(width-list.length)/2)*stepX,y:margin+layer*stepY});
  cards.filter(c=>c.dependency?.side).forEach((c,i)=>positions[c.id]={x:margin+width*stepX,y:margin+i*stepY});
  const placed:Rect[]=[];
  for(const c of cards.filter(c=>shared.has(c.id))){let point={x:margin+width*stepX,y:positions[c.id].y};const size=cardSize(c);while(placed.some(r=>Math.abs(r.y-point.y)<size.height+t.rowGap.value/2&&Math.abs(r.x-point.x)<size.width+t.columnGap.value))point={...point,x:point.x+stepX};positions[c.id]=point;placed.push({...point,...size});}
  return positions;
 };
 let positions=arrange(groups);
 // Whole-project package cards use the bounded layer sweep. The exact local
 // route search is for a first class/file chain; retained nodes stay pinned.
 if(!cards.some(c=>saved[c.id])&&cards.some(c=>c.kind!=='group')){
  const score=(points:Record<string,Point>):[number,number]=>{try{const edges=routeSnapshot(0,cards,links,points).edges;return[edges.reduce((sum,edge,i)=>sum+edges.slice(i+1).reduce((n,other)=>n+pathCrossings(edge.points,other.points)+(edge.bundle?.id&&edge.bundle.id===other.bundle?.id?0:pathOverlap(edge.points,other.points)/t.channelGap.value),0),0),edges.reduce((sum,e)=>sum+e.points.slice(1).reduce((n,p,i)=>n+Math.hypot(p.x-e.points[i].x,p.y-e.points[i].y),0),0)];}catch{return[Infinity,Infinity];}};
  const better=(a:[number,number],b:[number,number])=>a[0]<b[0]||a[0]===b[0]&&a[1]<b[1];
  let best=score(positions);const original=arrange(initial),originalScore=score(original);if(better(originalScore,best)){positions=original;best=originalScore;}
  const regular=cards.filter(c=>!shared.has(c.id)).sort((a,b)=>a.id.localeCompare(b.id));
  for(let pass=0;pass<t.orderPasses.value;pass++){
   let improved=false;
   const accept=(candidate:Record<string,Point>)=>{const value=score(candidate);if(better(value,best)){positions=candidate;best=value;improved=true;}};
   for(const list of groups.values()){const members=list.filter(c=>!shared.has(c.id));for(let i=0;i<members.length;i++)for(let j=i+1;j<members.length;j++)accept({...positions,[members[i].id]:positions[members[j].id],[members[j].id]:positions[members[i].id]});}
   const columns=[...new Set(regular.map(c=>positions[c.id].x))].sort((a,b)=>a-b);
   const scan=pass%2?[...regular].reverse():regular;
   for(const card of scan){const adjacent=links.filter(l=>l.source===card.id||l.target===card.id).map(l=>positions[l.source===card.id?l.target:l.source].x),mean=adjacent.length?adjacent.reduce((a,b)=>a+b,0)/adjacent.length:positions[card.id].x;
    for(const x of [...columns,mean]){const point={...positions[card.id],x},size=cardSize(card);if(cards.some(c=>c.id!==card.id&&Math.abs(positions[c.id].y-point.y)<size.height+t.rowGap.value/2&&Math.abs(positions[c.id].x-x)<size.width+t.columnGap.value/2))continue;accept({...positions,[card.id]:point});}
   }
   for(const card of cards.filter(c=>shared.has(c.id)))for(const x of [margin-stepX,margin+width*stepX]){const point={...positions[card.id],x},size=cardSize(card);if(cards.some(c=>c.id!==card.id&&Math.abs(positions[c.id].y-point.y)<size.height+t.rowGap.value/2&&Math.abs(positions[c.id].x-x)<size.width+t.columnGap.value/2))continue;accept({...positions,[card.id]:point});}
   if(!improved)break;
  }
 }
 const occupied:Rect[]=[];for(const card of [...cards].sort((a,b)=>Number(!!saved[b.id])-Number(!!saved[a.id]))){
  let point=saved[card.id]||positions[card.id],size=cardSize(card);if(!saved[card.id]&&card.dependency?.parent&&saved[card.dependency.parent])point={x:saved[card.dependency.parent].x+stepX,y:positions[card.id].y};
  if(!saved[card.id])while(occupied.some(r=>point.x<r.x+r.width+t.columnGap.value/2&&point.x+size.width+t.columnGap.value/2>r.x&&point.y<r.y+r.height+t.rowGap.value/2&&point.y+size.height+t.rowGap.value/2>r.y))point={...point,x:point.x+stepX};
  positions[card.id]=point;occupied.push({...point,...size});
 }
 return positions;
}
