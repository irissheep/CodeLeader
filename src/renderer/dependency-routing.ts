import type {Point} from './graph-geometry';
import type {GraphCard,GraphLink} from './graph-model';
import policy from '../shared/dependency-policy.json';

export function sharedDependencyNodes(cards:GraphCard[],links:GraphLink[]){
 return new Set(cards.filter(c=>!!c.dependency&&(c.dependency.side||['config','tool'].includes(c.dependency.role)||links.filter(l=>l.target===c.id).length>=cards.length*policy.thresholds.sharedIncomingRatio.value)).map(c=>c.id));
}

// Count orthogonal intersections once per pair, including crossings at a bend.
// Collinear shared trunks and contacts at two endpoints are not crossings.
export function pathCrossings(first:Point[],second:Point[]){
 const hits=new Set<string>();
 for(let i=1;i<first.length;i++)for(let j=1;j<second.length;j++){
  const a=first[i-1],b=first[i],c=second[j-1],d=second[j],h=Math.abs(a.y-b.y)<.01,k=Math.abs(c.y-d.y)<.01;
  if(h===k)continue;const x=h?c.x:a.x,y=h?a.y:c.y;
  if(x>Math.min(a.x,b.x)+.01&&x<Math.max(a.x,b.x)-.01&&y>Math.min(c.y,d.y)+.01&&y<Math.max(c.y,d.y)-.01||x>Math.min(c.x,d.x)+.01&&x<Math.max(c.x,d.x)-.01&&y>Math.min(a.y,b.y)+.01&&y<Math.max(a.y,b.y)-.01)hits.add(`${x.toFixed(2)}:${y.toFixed(2)}`);
 }
 return hits.size;
}
export function pathOverlap(first:Point[],second:Point[]){
 let length=0;
 for(let i=1;i<first.length;i++)for(let j=1;j<second.length;j++){
  const a=first[i-1],b=first[i],c=second[j-1],d=second[j],horizontal=a.y===b.y;
  if(horizontal!==(c.y===d.y)||(horizontal?a.y!==c.y:a.x!==c.x))continue;
  length+=Math.max(0,Math.min(Math.max(horizontal?a.x:a.y,horizontal?b.x:b.y),Math.max(horizontal?c.x:c.y,horizontal?d.x:d.y))-Math.max(Math.min(horizontal?a.x:a.y,horizontal?b.x:b.y),Math.min(horizontal?c.x:c.y,horizontal?d.x:d.y)));
 }
 return length;
}
