import type {ProjectIndex} from '../src/shared/model';
import type {GraphResult} from '../src/renderer/graph-model';
import type {LayoutSnapshot} from '../src/renderer/graph-geometry';
// Same orthogonal intersection definition as R0. Endpoints and collinear overlap
// are not counted; a crossing location is deduplicated per pair of edges.
export function crossings(edges:LayoutSnapshot['edges']){
 let count=0;for(let i=0;i<edges.length;i++)for(let j=i+1;j<edges.length;j++){
  const hits=new Set<string>();for(let a=1;a<edges[i].points.length;a++)for(let b=1;b<edges[j].points.length;b++){
   const p=edges[i].points[a-1],q=edges[i].points[a],r=edges[j].points[b-1],s=edges[j].points[b];
   const h=Math.abs(p.y-q.y)<.01,k=Math.abs(r.y-s.y)<.01;if(h===k)continue;const x=h?r.x:p.x,y=h?p.y:r.y;
   if(x>Math.min(p.x,q.x)+.01&&x<Math.max(p.x,q.x)-.01&&y>Math.min(r.y,s.y)+.01&&y<Math.max(r.y,s.y)-.01||x>Math.min(r.x,s.x)+.01&&x<Math.max(r.x,s.x)-.01&&y>Math.min(p.y,q.y)+.01&&y<Math.max(p.y,q.y)-.01)hits.add(`${x.toFixed(2)}:${y.toFixed(2)}`);
  }count+=hits.size;
 }return count;
}
export function dependencyMetrics(index:ProjectIndex,graph:GraphResult,snapshot?:LayoutSnapshot){
 const nodes=new Map(snapshot?.nodes.map(n=>[n.id,n])||[]),cards=graph.cards;
 const pairs:{from:string;to:string;correct:boolean}[]=[];
 for(const from of cards)for(const to of cards){const a=from.dependency,b=to.dependency;if(!a||!b||a.side||b.side)continue;
  if(a.layer<b.layer)pairs.push({from:from.id,to:to.id,correct:!!nodes.get(from.id)&&!!nodes.get(to.id)&&nodes.get(from.id)!.y<nodes.get(to.id)!.y});
 }
 const represented=new Set(cards.flatMap(c=>c.dependency?.unitIds||[])),selected=graph.dependencyUnitIds||[],missingUnits=selected.filter(id=>!represented.has(id));
 const shownEvidence=new Set([...graph.links.flatMap(l=>l.relations.map(r=>r.id)),...cards.flatMap(c=>c.innerRelations||[])]),missingRelations=[...new Set((graph.dependencyRelations||[]).map(r=>r.id))].filter(id=>!shownEvidence.has(id));
 const labeled=cards.filter(c=>!!c.summary?.trim()&&(!!c.dependency||typeof c.count==='number'&&/个类/.test(c.tag))).length;
 return{version:'G-v2',nodes:cards.length,edges:graph.links.length,representedUnits:represented.size,selectedUnits:graph.dependencyUnitIds?selected.length:null,explicitlyFolded:graph.dependencyUnitIds?graph.omitted:null,silentOmissions:graph.dependencyUnitIds?missingUnits.length:null,legacyReportedOmissions:graph.omitted,missingUnits,missingRelations,roleOrClassCards:labeled,placeholder:cards.filter(c=>/包\s*\/\s*目录结构/.test(c.summary||'')).length,layerAssessed:cards.some(c=>c.dependency),layerCorrect:pairs.filter(p=>p.correct).length,layerTotal:pairs.length,layerPairs:pairs,crossings:snapshot?crossings(snapshot.edges):null,scope:'默认当前接口链路',languages:index.languages};
}
