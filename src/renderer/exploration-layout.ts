import type {GraphCard,GraphLink} from './graph-model';
import type {Point} from './graph-geometry';
import tokens from '../shared/ui-tokens';

/** Places each real method once. Strongly connected calls share a column; their edges remain back edges. */
export function explorationFlow(members:GraphCard[],links:GraphLink[],origin:Point,saved:Record<string,Point>={},savedOwner?:Point){
 const ids=new Set(members.map(card=>card.id)),out=new Map<string,string[]>();
 for(const id of ids)out.set(id,[]);
 for(const link of links)if(!link.context&&ids.has(link.source)&&ids.has(link.target))out.get(link.source)!.push(link.target);
 for(const targets of out.values())targets.sort();
 const indices=new Map<string,number>(),low=new Map<string,number>(),stack:string[]=[],onStack=new Set<string>(),components:string[][]=[];let next=0;
 const visit=(id:string)=>{indices.set(id,next);low.set(id,next++);stack.push(id);onStack.add(id);for(const target of out.get(id)!){if(!indices.has(target)){visit(target);low.set(id,Math.min(low.get(id)!,low.get(target)!));}else if(onStack.has(target))low.set(id,Math.min(low.get(id)!,indices.get(target)!));}if(low.get(id)===indices.get(id)){const component:string[]=[];let item:string;do{item=stack.pop()!;onStack.delete(item);component.push(item);}while(item!==id);components.push(component.sort());}};
 for(const id of [...ids].sort())if(!indices.has(id))visit(id);
 const componentOf=new Map(components.flatMap((component,i)=>component.map(id=>[id,i] as const))),incoming=components.map(()=>new Set<number>()),outgoing=components.map(()=>new Set<number>());
 for(const [source,targets]of out)for(const target of targets){const a=componentOf.get(source)!,b=componentOf.get(target)!;if(a!==b){outgoing[a].add(b);incoming[b].add(a);}}
 const degree=incoming.map(items=>items.size),levels=components.map(()=>0),ready=degree.flatMap((value,i)=>value===0?[i]:[]),key=(i:number)=>components[i][0];
 while(ready.length){ready.sort((a,b)=>key(a).localeCompare(key(b)));const i=ready.shift()!;for(const target of outgoing[i]){levels[target]=Math.max(levels[target],levels[i]+1);if(!--degree[target])ready.push(target);}}
 const columnWidth=tokens.continuity.flowWidth+tokens.hierarchy.groupHeading+tokens.hierarchy.blockGap,rowHeight=tokens.continuity.flowStep,positions:Record<string,Point>={},rows=new Map<string,number>();
 const columns=new Map<number,string[]>();for(const id of ids){const level=levels[componentOf.get(id)!];columns.set(level,[...(columns.get(level)||[]),id]);}
 for(const [level,items] of [...columns].sort((a,b)=>a[0]-b[0])){
  const used=new Set<number>(),x=origin.x+level*columnWidth;
  // Preserve already visible positions when they still belong to this column.
  for(const id of items.slice().sort((a,b)=>(saved[a]?.y??Infinity)-(saved[b]?.y??Infinity)||a.localeCompare(b))){const old=saved[id];if(!old||!savedOwner||Math.abs(old.x-savedOwner.x-x)>columnWidth/3)continue;const row=Math.round((old.y-savedOwner.y-origin.y)/rowHeight);if(row>=0&&row<=members.length*2&&!used.has(row)){used.add(row);rows.set(id,row);}}
  for(const id of items.slice().sort())if(!rows.has(id)){
   const parents=links.filter(link=>!link.context&&link.target===id&&rows.has(link.source)).map(link=>rows.get(link.source)!);
   const desired=parents.length?Math.round(parents.reduce((a,b)=>a+b,0)/parents.length):0;let row=desired;
   for(let distance=0;used.has(row);distance++){const above=desired-distance-1,below=desired+distance+1;row=above>=0&&!used.has(above)?above:below;}
   used.add(row);rows.set(id,row);
  }
  for(const id of items)positions[id]={x,y:origin.y+rows.get(id)!*rowHeight};
 }
 const width=members.length?Math.max(...Object.values(positions).map(p=>p.x+tokens.continuity.flowWidth))+tokens.hierarchy.cardPadding:0;
 const height=members.length?Math.max(...Object.values(positions).map(p=>p.y+tokens.continuity.flowHeight))+tokens.continuity.flowFooter:0;
 return{positions,width,height};
}
