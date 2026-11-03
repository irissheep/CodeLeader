import test from 'node:test';
import assert from 'node:assert/strict';
import {graphFor} from '../src/renderer/graph-model';
import {openEntry,collapse} from '../src/renderer/exploration-state';
import {initialViewing,sessionViewing,holdReading,viewingReplay,resumeFollowing,liveFollowing,latestOperationRequest,type ExecutionViewing} from '../src/renderer/execution-viewing';
import {buildReplay,initialReplay} from '../src/runtime/replay';
import {runtimeGraph,projectExecution} from '../src/renderer/execution-projection';
import {placeExploration} from '../src/renderer/exploration-graph';
import {routeSnapshot,segmentHits} from '../src/renderer/graph-geometry';
import type {ProjectIndex,ViewState} from '../src/shared/model';
import type {BrowserRequest,ExecutionSession,RecordedSpan} from '../src/shared/execution';
const range={start:{line:0,character:0},end:{line:0,character:5}},location={file:'renamed.py',range};
const symbol=(id:string,serviceId:string)=>({id,name:id,qualifiedName:id,signature:id,kind:'function' as const,language:'python' as const,file:location.file,module:'renamed',range,selection:range,routes:[],serviceId});
const route=(id:string,symbolId:string)=>({id,name:'POST /'+id,symbolId,kind:'http' as const,group:'renamed',owner:'renamed',area:'renamed',location,basis:'route',status:'resolved' as const});
const relation=(id:string,from:string,to:string,type:'CALLS'|'HTTP'|'READS')=>({id,from,to,type,target:to,status:'resolved' as const,source:'tree-sitter' as const,locations:[location]});
const index:ProjectIndex={schema:2,id:'renamed',name:'renamed',root:'D:/fixture',createdAt:'1',status:'complete',languages:['python'],files:[],sourceRoots:[],jars:[],diagnostics:[],versions:{},symbols:[symbol('send','alpha'),symbol('entry','beta'),symbol('retrieve','beta'),symbol('leaf','beta')],entries:[route('receive','entry'),route('leaf','leaf')],entities:[{id:'alpha',kind:'service',name:'Client deployment',summary:'',basis:[]},{id:'beta',kind:'service',name:'Worker deployment',summary:'',basis:[]},{id:'domain',kind:'domain',name:'Renamed ability',summary:'',serviceId:'beta',entryIds:['receive','leaf'],basis:[]},{id:'database',kind:'resource',resourceKind:'database',name:'Records',summary:'',basis:[]},{id:'vector',kind:'resource',resourceKind:'vector',name:'Search index',summary:'',basis:[]}],relations:[relation('communication','send','entry','HTTP'),relation('other-data','send','database','READS'),relation('business','entry','retrieve','CALLS'),relation('lookup','retrieve','vector','READS')]};
const base:ViewState={level:'main',expanded:[],positions:{alpha:{x:0,y:0},beta:{x:700,y:0}},viewport:{x:12,y:34,zoom:1},filter:'all',query:''};
const request=(id:string,method='POST',operationId='one',start=1):BrowserRequest=>({id,method,start,end:start+1,operationId,traceId:id.padEnd(32,'a'),spanId:id.padEnd(16,'b'),url:'http://localhost:9999/renamed',page:'http://localhost:9999'});
const browser=request('b'),span:RecordedSpan={traceId:browser.traceId,spanId:'entry-call',parentSpanId:browser.spanId,name:'entry',service:'beta',kind:1,start:'100',end:'200',status:'ok',attributes:{},links:[],versionMatch:true,symbolId:'entry',location};
test('drilling keeps original incoming/background relationships once; switch/collapse/isolation restore context',()=>{
 const chain=openEntry(index,base,index.entries![0]),graph=graphFor(index,chain),byRelation=(id:string)=>graph.links.filter(l=>l.relations.some(r=>r.id===id));
 assert.equal(byRelation('communication').length,1);assert.equal(byRelation('communication')[0].source,'alpha');assert.equal(byRelation('communication')[0].target,'beta');assert.equal(byRelation('communication')[0].context,true);
 assert.equal(byRelation('other-data').length,1);assert.equal(byRelation('business')[0].context,undefined);assert.equal(byRelation('lookup').length,1);
 assert.deepEqual(byRelation('communication')[0].relations[0].locations,[location]);
 const ids=graph.links.flatMap(l=>l.relations.map(r=>r.id));assert.equal(new Set(ids).size,ids.length);
 const layout=routeSnapshot(1,graph.cards,graph.links,placeExploration(graph.cards,base.positions));
 for(const edge of layout.edges){const link=graph.links.find(l=>l.id===edge.id)!;for(let i=1;i<edge.points.length;i++)for(const node of layout.nodes.filter(n=>n.id!==link.source&&n.id!==link.target&&graph.cards.find(c=>c.id===n.id)?.kind!=='service'))assert.equal(segmentHits(edge.points[i-1],edge.points[i],node),false,`edge crosses ${node.id}`);}
 const leaf=graphFor(index,openEntry(index,chain,index.entries![1]));assert.ok(leaf.links.some(l=>l.source==='alpha'&&l.target==='beta'));
 assert.deepEqual(collapse(collapse(chain)).viewport,base.viewport);assert.equal(graphFor(index,collapse(chain)).links.length,3);
 const isolated=graphFor(index,{...chain,reading:{origin:'entry',target:'vector',isolate:'path'}});assert.ok(isolated.links.every(l=>!l.context));assert.ok(!isolated.cards.some(c=>c.id==='alpha'));
 assert.equal(graphFor(index,{...chain,reading:undefined}).links.length,graph.links.length);
 const filtered=graphFor(index,openEntry(index,{...base,reading:{types:['HTTP']}},index.entries![0]));assert.ok(filtered.links.every(l=>l.type==='HTTP'));
 const data=graphFor(index,openEntry(index,{...base,reading:{types:['DATA']}},index.entries![0]));assert.ok(data.links.some(l=>l.type==='READS'));assert.ok(data.links.every(l=>['DATA','READS','WRITES'].includes(l.type)));
 const selected=graphFor(index,base).links.find(l=>l.relations.some(r=>r.id==='lookup'))!;
 const single=graphFor(index,openEntry(index,{...base,relationSelection:selected.id,reading:{isolate:'relation'}},index.entries![0]));assert.equal(single.links.length,1);assert.equal(single.links[0].id,selected.id);
});
test('retained upstream context is not evidence that a browser request traversed that service',()=>{
 const baseGraph=graphFor(index,openEntry(index,base,index.entries![0])),model=buildReplay(browser,[span]),state=initialReplay(model,'raw');state.cursor=model.steps.at(-1)!.id;
 const runtime=runtimeGraph(index,baseGraph,model,undefined),projection=projectExecution(index,runtime.cards,runtime.links,state);
 assert.ok(runtime.links.some(l=>l.source==='alpha'&&l.target==='beta'));
 assert.ok(!projection.active.has('alpha'));assert.ok(!projection.edges.has(runtime.links.find(l=>l.source==='alpha'&&l.target==='beta')!.id));
 assert.deepEqual(baseGraph.links,graphFor(index,openEntry(index,base,index.entries![0])).links);
});
test('manual reading holds preference, resuming clears hold, natural completion and camera do not opt out',()=>{
 const replay=initialReplay(buildReplay(browser,[span]),'raw');let v:ExecutionViewing={...initialViewing(),states:{key:replay}};
 v=viewingReplay(v,'key',{type:'play'});assert.equal(v.following,true);assert.equal(v.hold,'playback');
 v=resumeFollowing(v,'key');assert.equal(v.hold,undefined);
 for(let i=0;i<20;i++)v=viewingReplay(v,'key',{type:'tick'});
 assert.equal(v.states.key.playing,false);assert.equal(v.hold,undefined);assert.equal(v.following,true);
 const cursor=v.states.key.cursor;v=holdReading(v,'key','inspection');assert.equal(v.states.key.cursor,cursor);assert.equal(v.following,true);
 v={...v,states:{key:{...v.states.key,follow:false,viewport:{x:10,y:20,zoom:1}}}};assert.equal(v.hold,'inspection');
 v=resumeFollowing(v,'key');assert.equal(v.states.key.follow,false);assert.equal(v.hold,undefined);
 assert.equal(resumeFollowing(holdReading(v,'key','expansion'),'key',true).states.key.follow,true);
 assert.deepEqual(initialViewing(),{following:true,states:{}});
});
test('breakpoint tick holds atomically and ordinary play or resume skips the same hit once',()=>{
 const replay=initialReplay(buildReplay(browser,[span]),'raw'),call=replay.model.calls.find(c=>c.span?.spanId===span.spanId)!;
 let v:ExecutionViewing={...initialViewing(),states:{key:{...replay,breakpoints:[call.id],playing:true}}};
 for(let i=0;i<20&&!v.states.key.hit;i++)v=viewingReplay(v,'key',{type:'tick'});
 assert.equal(v.hold,'breakpoint');assert.equal(v.following,true);const hit=v.states.key.hit;assert.ok(hit);
 for(const resume of [resumeFollowing(v,'key'),viewingReplay(v,'key',{type:'play'})]){
  const next=viewingReplay(resume,'key',{type:'tick'});assert.equal(next.states.key.hit,undefined);assert.equal(next.states.key.cursor,hit);
 }
});
test('follow availability tracks capture lifecycle; per-operation pin does not leak into later writes',()=>{
 const first=request('write','POST','one'),refresh=request('refresh','GET','one',2),next=request('next','PATCH','two',3),read=request('read','GET','two',4);
 const session={state:'recording',operations:[{id:'one'},{id:'two'}],requests:[first,refresh,next,read],spans:[]} as unknown as ExecutionSession;
 assert.equal(latestOperationRequest(session,{one:'refresh'})?.request.id,'next');assert.equal(latestOperationRequest(session,{two:'read'})?.request.id,'read');assert.equal(latestOperationRequest(session,{two:'refresh'})?.request.id,'next');
 assert.ok(liveFollowing(session));for(const state of ['stopped','failed','connecting'])assert.ok(!liveFollowing({...session,state} as ExecutionSession));assert.ok(!liveFollowing({...session,historical:true}));assert.ok(!liveFollowing());
 const connecting={...session,state:'connecting'} as ExecutionSession;const fresh=sessionViewing(connecting);assert.equal(fresh.following,true);assert.equal(fresh.hold,undefined);assert.deepEqual(fresh.states,{});assert.ok(!liveFollowing(connecting));assert.ok(liveFollowing({...connecting,state:'recording'}));assert.equal(sessionViewing({...session,historical:true}).following,false);
});
