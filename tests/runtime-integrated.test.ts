import test from 'node:test';
import assert from 'node:assert/strict';
import {actualSnapshot,isActual} from '../src/runtime/snapshot';
import {compareSnapshots,displayValue} from '../src/runtime/replay-data';
import {primaryRequest,pollingRequest} from '../src/runtime/operation-flow';
import {buildReplay,initialReplay,replayAction,replayInterval} from '../src/runtime/replay';
import {mergeRecorded} from '../src/runtime/otlp';
import {projectExecution,runtimeGraph,browserNodeId} from '../src/renderer/execution-projection';
import type {BrowserRequest,ExecutionSession,RecordedSpan} from '../src/shared/execution';
import type {ProjectIndex} from '../src/shared/model';
const request=(id:string,method='POST',time=1,operationId='op'):BrowserRequest=>({id,method,start:time,operationId,traceId:id.padEnd(32,'a'),spanId:id.padEnd(16,'b'),url:'http://127.0.0.1:9999/renamed',page:'http://127.0.0.1:9999',end:time+1});
const span=(id:string,extra:Partial<RecordedSpan>={}):RecordedSpan=>({traceId:request('x').traceId,spanId:id,name:'Renamed.'+id,service:'same-label',kind:1,start:'100',end:'200',status:'ok',attributes:{},links:[],versionMatch:true,...extra});
test('raw snapshots keep credentials, freeze input, avoid accessors and state real truncation length',()=>{
  let getters=0;const input={password:'fixture-private',type:'string',length:3,items:[1],get lazy(){getters++;throw Error();},text:'中'.repeat(9000)};
  const captured=actualSnapshot(input);input.items.push(2);assert.ok(isActual(captured));assert.equal((captured.value as any).password,'fixture-private');assert.deepEqual((captured.value as any).items,[1]);assert.equal(getters,0);assert.ok((captured.limits as any[]).some(l=>l.path==='text'&&l.originalLength===9000&&l.saved===8192));
  assert.ok(!JSON.stringify(displayValue(captured,'hidden')).includes('fixture-private'));assert.ok(JSON.stringify(displayValue(captured,'raw')).includes('fixture-private'));
  const array=[1];Object.defineProperty(array,'0',{get(){getters++;throw Error();}});actualSnapshot(array);assert.equal(getters,0);
  assert.ok(Buffer.byteLength(JSON.stringify(actualSnapshot(Object.fromEntries(Array.from({length:64},(_,i)=>['key'+i,'\u0000'.repeat(8192)])))))<=65536);
});
test('recorded pacing uses only adjacent instants in the same clock and caps idle gaps',()=>{
  const state=initialReplay(buildReplay(request('x'),[]),'raw');state.timing='recorded';state.model.steps[0].instant={clock:'one',ns:'1000000000'};state.model.steps[1].instant={clock:'one',ns:'3500000000'};assert.equal(replayInterval(state).ms,2500);state.model.steps[1].instant.ns='11000000000';assert.equal(replayInterval(state).ms,5000);state.model.steps[1].instant.clock='other';assert.equal(replayInterval(state).ms,1000);assert.ok(replayInterval(state).reason);
});
test('raw comparison does not confuse business type, equal length, truncation or same values',()=>{
  const differences=compareSnapshots(actualSnapshot({type:'string',length:3,text:'abc',id:1}),actualSnapshot({type:'string',length:3,text:'xyz',id:1}));assert.ok(differences.some(d=>d.path==='text'&&d.kind==='value'));assert.ok(differences.some(d=>d.path==='type'&&d.kind==='same'));
  assert.ok(compareSnapshots(actualSnapshot({text:'a'.repeat(9000)}),actualSnapshot({text:'a'.repeat(9000)})).some(d=>d.kind==='unknown'));
});
test('primary selection keeps last write over refresh, separates operations, and depth wins GET',()=>{
  const write=request('w','POST',100),refresh=request('r','GET',150),later=request('w2','PATCH',200),other=request('other','POST',220,'op-2');
  const session={requests:[write,refresh,later,other],spans:[]} as unknown as ExecutionSession;
  assert.equal(primaryRequest(session,'op').request?.id,'w2');assert.equal(primaryRequest(session,'op-2').request?.id,'other');assert.equal(primaryRequest(session,'none').request,undefined);
  session.requests=[request('deep','GET',100),request('shallow','GET',150)];session.spans=[span('s',{traceId:session.requests[0].traceId,symbolId:'observed'})];assert.equal(primaryRequest(session,'op').request?.id,'deep');
  const poll=[request('p1','GET',1000),request('p2','GET',2000),request('p3','GET',3000)];assert.equal(pollingRequest(poll[2],poll),true);
});
test('enter and exit upsert retain one invocation and stable steps under disorder',()=>{
  const input=actualSnapshot({counter:1}),enter=span('call',{symbolId:'observed-method',status:'pending',end:'0',input,attributes:{'codeleader.phase':'enter'}}),exit=span('call',{symbolId:'observed-method',input,output:actualSnapshot({counter:2}),attributes:{'codeleader.phase':'exit'}}),a:RecordedSpan[]=[],b:RecordedSpan[]=[];
  mergeRecorded(a,[enter]);const first=buildReplay(request('x'),a),cursor=first.calls.find(c=>c.span?.spanId==='call')!.enterId;mergeRecorded(a,[exit]);mergeRecorded(b,[exit,enter]);assert.equal(a.length,1);assert.equal(b[0].status,'ok');assert.deepEqual(buildReplay(request('x'),a).steps.map(s=>s.id),buildReplay(request('x'),b).steps.map(s=>s.id));
  const updated=replayAction({...initialReplay(first,'raw'),cursor},{type:'update',model:buildReplay(request('x'),a)});assert.equal(updated.cursor,cursor);
});
test('renamed graph projection uses exact source/version identities and preserves static edges',()=>{
  const location={file:'code/Other.java',range:{start:{line:0,character:0},end:{line:1,character:0}}};
  const index={symbols:[{id:'entry',serviceId:'deploy-one'}],entries:[{id:'route',symbolId:'entry'}],entities:[{id:'deploy-one',kind:'service'},{id:'other-domain',kind:'domain',serviceId:'deploy-one',entryIds:['route']}]} as unknown as ProjectIndex;
  const base={cards:[{id:'deploy-one',kind:'service',name:'Anything',capabilities:[{id:'other-domain',name:'Anything else',count:1,auxiliary:false}],callers:0,callees:0,subtitle:'',tag:''}],links:[],omitted:0} as any;
  const record=span('entry-call',{symbolId:'entry',parentSpanId:request('x').spanId,location}),model=buildReplay(request('x'),[record]),state={...initialReplay(model,'raw'),cursor:model.calls.find(c=>c.span?.spanId==='entry-call')!.enterId},graph=runtimeGraph(index,base,model,undefined),projection=projectExecution(index,graph.cards,graph.links,state);
  assert.equal(projection.current,'deploy-one');assert.equal(projection.currentDomain,'other-domain');assert.ok(graph.cards.some(c=>c.id===browserNodeId));assert.equal(base.cards.length,1);
  index.symbols.push({id:'child',serviceId:'deploy-one'} as any);const child=span('000-child',{symbolId:'child',parentSpanId:record.spanId}),nested=buildReplay(request('x'),[child,record]);assert.deepEqual(runtimeGraph(index,base,nested,'other-domain').cards.find(c=>c.id==='deploy-one')?.runtimeExpansion?.calls.map(id=>nested.byCall[id].span?.symbolId),['entry','child']);
  record.versionMatch=false;const mismatch=buildReplay(request('x'),[record]),bad=projectExecution(index,graph.cards,graph.links,{...state,model:mismatch});assert.ok(!bad.active.has('deploy-one'));
});
