import {test} from 'node:test';
import assert from 'node:assert/strict';
import {presentGraph,adaptiveViewport,look} from '../src/renderer/adaptive-look';
import {cardSize,routeSnapshot,segmentHits} from '../src/renderer/graph-geometry';
import type {GraphCard,GraphLink} from '../src/renderer/graph-model';
import type {ProjectIndex} from '../src/shared/model';
import {adaptiveMainPositions} from '../src/renderer/adaptive-layout';
import {placeExploration} from '../src/renderer/exploration-graph';

const card=(id:string,layer:number):GraphCard=>({id,name:id,subtitle:'',tag:'',kind:'type',callers:0,callees:0,dependency:{role:'service',layer,color:'business',classes:1,unitIds:[id],basis:'fixture'}});
const link=(source:string,target:string):GraphLink=>({id:source+'-'+target,source,target,type:'CALLS',status:'resolved',label:'调用',relations:[]});
test('presentation preserves original identities and evidence without mutating analysis facts',()=>{
 const graph={cards:[card('entry',0),card('worker',1)],links:[link('entry','worker')],omitted:0},original=JSON.stringify(graph);
 const shown=presentGraph(graph,{} as ProjectIndex);
 assert.equal(JSON.stringify(graph),original);assert.deepEqual(shown.cards.map(c=>c.id),graph.cards.map(c=>c.id));assert.equal(shown.links,graph.links);assert.equal(shown.cards[0].appearance?.scale,look.looseScale);
});
test('a skipped layer uses safe short ports instead of circling an intervening class',()=>{
 const source=[card('entry',0),card('contract',1),card('worker',2)];
 const shown=presentGraph({cards:source,links:[link('entry','contract'),link('entry','worker')],omitted:0},{} as ProjectIndex);
 const positions={entry:{x:100,y:100},contract:{x:100,y:350},worker:{x:100,y:600}};
 const snapshot=routeSnapshot(1,shown.cards,shown.links,positions);
 assert.equal(snapshot.edges.length,2);
 for(const edge of snapshot.edges){const from=edge.points[0],to=edge.points.at(-1)!,length=edge.points.slice(1).reduce((n,p,i)=>n+Math.hypot(p.x-edge.points[i].x,p.y-edge.points[i].y),0);assert.ok(length/Math.hypot(to.x-from.x,to.y-from.y)<=look.maxRouteRatio);const relation=shown.links.find(l=>l.id===edge.id)!;for(const node of snapshot.nodes.filter(n=>n.id!==relation.source&&n.id!==relation.target))for(let i=1;i<edge.points.length;i++)assert.equal(segmentHits(edge.points[i-1],edge.points[i],node),false);}
});
test('small-graph fit includes every card with padding at both requested window widths',()=>{
 const nodes=[{id:'front',x:0,y:0,width:450,height:230,ports:[]},{id:'app',x:550,y:0,width:575,height:250,ports:[]},{id:'store',x:700,y:320,width:263,height:118,ports:[]}];
 for(const [width,height]of [[1548,903],[1100,658]]){const v=adaptiveViewport({version:1,nodes,edges:[],regions:[]},width,height);for(const n of nodes){assert.ok(n.x*v.zoom+v.x>=look.padding-.01);assert.ok(n.y*v.zoom+v.y>=look.padding-.01);assert.ok((n.x+n.width)*v.zoom+v.x<=width-look.padding+.01);assert.ok((n.y+n.height)*v.zoom+v.y<=height-look.padding+.01);}assert.ok(1125*438*v.zoom*v.zoom/(width*height)>=look.minOccupation-.01);}
});
test('a tall set of connected applications uses two content-based columns',()=>{
 const cards=Array.from({length:5},(_,i)=>({id:'app-'+i,name:'Application '+i,subtitle:'',tag:'',kind:'service' as const,callers:0,callees:0,canvasSize:{width:240,height:280}})),links=cards.slice(1).map((c,i)=>link(cards[i].id,c.id));
 const positions=adaptiveMainPositions(cards,links);assert.equal(new Set(Object.values(positions).map(p=>p.x)).size,2);assert.equal(Object.keys(positions).length,5);
});
test('expanded entry anchors follow the displayed owner scale',()=>{
 const owner:GraphCard={id:'app',name:'App',subtitle:'',tag:'',kind:'service',callers:0,callees:0,canvasSize:{width:460,height:500},appearance:{density:'loose',role:'backend',scale:1.25,tiles:false}};
 const anchor:GraphCard={id:'route',name:'GET /items',subtitle:'',tag:'',kind:'anchor',callers:0,callees:0,ownerId:owner.id,local:{x:21,y:150},canvasSize:{width:418,height:80}};
 const positions=placeExploration([owner,anchor],{app:{x:100,y:200}});assert.equal(positions.route.x,126.25);assert.equal(positions.route.y,387.5);
});
