import fs from 'node:fs/promises';
import {graphFor} from '../src/renderer/graph-model';
import {isTestFile} from '../src/shared/source-roles';
import {recommendations} from '../src/renderer/flow-model';
import {dependencyMetrics} from './dependency-metrics';
import {presentGraph} from '../src/renderer/adaptive-look';
import {presentDependencyLanes,laneMainLinks} from '../src/renderer/dependency-lanes';
import type {ProjectIndex,ViewState} from '../src/shared/model';
const base:ViewState={level:'main',expanded:[],positions:{},viewport:{x:0,y:0,zoom:1},filter:'all',query:''};
const read=async(file:string)=>JSON.parse(await fs.readFile(file,'utf8'));
const [input,output,layoutFile]=process.argv.slice(2),index:ProjectIndex=await read(input);
const recommended=recommendations(index).find(r=>r.entry.kind==='http')?.entry;
const main=graphFor(index,base),dependencies=graphFor(index,{...base,level:'overview',fullDependencies:true,relationFilter:'imports'}),defaultDependencies=graphFor(index,{...base,level:'overview',dependencyEntryId:recommended?.id,relationFilter:'all'}),guide=graphFor(index,{...base,level:'guide'});
// Execute the actual layout.worker.ts handler. The harness substitutes only the
// ELK transport (in-process instead of a browser Worker), not layout settings.
let resolveLayout:(v:any)=>void;
(globalThis as any).self={postMessage:(value:any)=>{if(!value.skeleton)resolveLayout(value);}};
await import(layoutFile);
async function layout(graph:any,level:string,extra:Record<string,unknown>={}){return await new Promise<any>(resolve=>{resolveLayout=resolve;(globalThis as any).self.onmessage({data:{id:1,cards:graph.cards,links:graph.links,positions:{},level,...extra}});});}
const mainLayout=await layout(main,'main'),dependencyLayout=await layout(dependencies,'overview'),defaultDependencyLayout=await layout(defaultDependencies,'overview');
// Keep the established G-v2 ruler. Export the current presentation separately,
// so its horizontal lanes and paint-only folds are measured without silently
// changing the old top-down score definition.
const laneGraph=presentDependencyLanes(presentGraph(defaultDependencies,index)),laneLayout=await layout(laneGraph,'overview',{laneOrientation:'columns'}),laneMain=laneMainLinks(laneGraph.cards,laneGraph.links);
const dependencyLanes={orientation:'columns',graph:laneGraph,layout:laneLayout,metrics:{members:laneGraph.links.length,main:laneMain.size,mainCrossings:laneLayout.snapshot?crossings(laneLayout.snapshot.edges.filter((e:any)=>laneMain.has(e.id))):null,memberCrossings:laneLayout.snapshot?crossings(laneLayout.snapshot.edges):null}};
function crossings(edges:any[]){let count=0;for(let i=0;i<edges.length;i++)for(let j=i+1;j<edges.length;j++){
 const locations=new Set<string>();for(let a=1;a<edges[i].points.length;a++)for(let b=1;b<edges[j].points.length;b++){
  const p=edges[i].points[a-1],q=edges[i].points[a],r=edges[j].points[b-1],s=edges[j].points[b];const horizontal=Math.abs(p.y-q.y)<.01,other=Math.abs(r.y-s.y)<.01;if(horizontal===other)continue;
  const x=horizontal?r.x:p.x,y=horizontal?p.y:r.y;if(x>Math.min(p.x,q.x)+.01&&x<Math.max(p.x,q.x)-.01&&y>Math.min(r.y,s.y)+.01&&y<Math.max(r.y,s.y)-.01||x>Math.min(r.x,s.x)+.01&&x<Math.max(r.x,s.x)-.01&&y>Math.min(p.y,q.y)+.01&&y<Math.max(p.y,q.y)-.01)locations.add(`${x.toFixed(2)}:${y.toFixed(2)}`);
 }count+=locations.size;
}return count;}
const depNodes=new Map((dependencyLayout.snapshot?.nodes||[]).map((n:any)=>[n.id,n]));
const role=(card:any)=>{const names=card.kind==='group'?(card.members||[]).map((m:string)=>m.slice(7)):[card.subtitle];const symbols=index.symbols.filter(s=>names.includes(s.module)&&['class','interface'].includes(s.kind)&&!isTestFile(s.file,index));return {controller:symbols.some(s=>s.role==='Controller'),service:symbols.some(s=>s.role==='Service'),entity:symbols.some(s=>/\b(?:entity|domain|model)\b/i.test(s.module)),common:symbols.some(s=>/\b(?:common|util|utils)\b/i.test(s.module)),classes:symbols.length};};
const roles=dependencies.cards.map(c=>({id:c.id,name:c.name,...role(c),y:(depNodes.get(c.id) as any)?.y}));
const pairs:any[]=[];for(const c of roles.filter(r=>r.controller))for(const s of roles.filter(r=>r.service&&r.id!==c.id))pairs.push({controller:c.id,service:s.id,correct:c.y!==undefined&&s.y!==undefined&&c.y<s.y});
const lower:any[]=[];for(const c of roles.filter(r=>r.controller||r.service))for(const e of roles.filter(r=>(r.entity||r.common)&&r.id!==c.id))lower.push({upper:c.id,lower:e.id,correct:c.y!==undefined&&e.y!==undefined&&c.y<e.y});
const degree=new Map(main.cards.map(c=>[c.id,0]));for(const l of main.links){degree.set(l.source,(degree.get(l.source)||0)+1);degree.set(l.target,(degree.get(l.target)||0)+1);}
await fs.writeFile(output,JSON.stringify({main,guide,dependencies,mainLayout,dependencyLayout,defaultDependencies,defaultDependencyLayout,dependencyLanes,dependencyMetricsV2:dependencyMetrics(index,defaultDependencies,defaultDependencyLayout.snapshot),metrics:{mainNodes:main.cards.length,mainEdges:main.links.length,isolated:main.cards.filter(c=>!degree.get(c.id)).map(c=>({id:c.id,name:c.name})),placeholder:main.cards.filter(c=>/包\s*\/\s*目录结构/.test(c.summary||'')).length,dependencyPlaceholder:dependencies.cards.filter(c=>/包\s*\/\s*目录结构/.test(c.summary||'')).length,dependencyNodes:dependencies.cards.length,dependencyEdges:dependencies.links.length,dependencyOmitted:dependencies.omitted,crossings:dependencyLayout.snapshot?crossings(dependencyLayout.snapshot.edges):null,roles,controllerAboveService:{correct:pairs.filter(p=>p.correct).length,total:pairs.length,pairs},entitiesCommonBelow:{correct:lower.filter(p=>p.correct).length,total:lower.length,pairs:lower},classCountCards:dependencies.cards.filter(c=>c.kind==='module'&&typeof c.count==='number'||c.rows?.some(s=>['class','interface'].includes(s.kind))).length,emptyFrames:[main,guide,dependencies].filter(g=>!g.cards.length).length,emptyCardContent:main.cards.filter(c=>!c.name.trim()).length,emptyExplained:true,emptyExplanationLocation:'src/renderer/Graph.tsx:282'}},null,2));
