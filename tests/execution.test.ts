import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPlan } from '../src/runtime/plan';
import { BatchReader } from '../src/runtime/otlp';
import { snapshot, boundedSnapshot } from '../src/runtime/snapshot';
import { readingSpans } from '../src/runtime/reading';
import type { ProjectIndex } from '../src/shared/model';
const location={file:'server/src/Orders.java',range:{start:{line:0,character:0},end:{line:2,character:0}}};
const index:ProjectIndex={schema:2,id:'fixture',root:'D:\\fixture',name:'Renamed',createdAt:'now',status:'complete',languages:['java'],files:[{path:location.file,hash:'fixture-sha',size:100,language:'java',module:'acme'}],symbols:[{id:'class',name:'Dispatch',qualifiedName:'demo.Dispatch',signature:'Dispatch',kind:'class',language:'java',module:'demo',file:location.file,range:location.range,selection:location.range,routes:[]},{id:'method',name:'submit',qualifiedName:'demo.Dispatch.submit',signature:'demo.Dispatch.submit(long, java.lang.String)',kind:'method',language:'java',module:'demo',file:location.file,parent:'class',range:location.range,selection:location.range,routes:['POST /orders']}],relations:[],sourceRoots:[],jars:[],diagnostics:[],versions:{},entries:[{id:'entry',kind:'http',name:'POST /orders',symbolId:'method',location,group:'Orders',owner:'Dispatch',area:'business',basis:'fixture',status:'resolved'}]};
test('automatic plan uses exact renamed signatures and safe construction evidence',()=>{
  const plan=buildPlan(index,new Map([[location.file,'public Result submit(long tenant, String question) { return client.body(Map.of("user_id", tenant, "question", question)).retrieve(); }']]));
  assert.equal(plan.points.length,1);assert.equal(plan.points[0].owner,'demo.Dispatch');assert.deepEqual(plan.points[0].parameters,['long','java.lang.String']);assert.deepEqual(plan.points[0].parameterNames,['tenant','question']);assert.deepEqual(plan.points[0].construction?.fields,{user_id:'tenant',question:'question'});
});
test('route labels do not become URL paths and reading uses causal parents',()=>{
  const renamed=structuredClone(index);renamed.entries![0].name='POST /orders · submit';const plan=buildPlan(renamed,new Map([[location.file,'public String submit(long tenant, String question) { return question; }']]));assert.equal(plan.routes[0].path,'/orders');
  const span=(id:string,parentSpanId:string,kind:number,symbolId?:string)=>({traceId:'1'.repeat(32),spanId:id,parentSpanId,name:id,kind,service:kind===2?'other':'server',start:'1001',end:'1002',status:'ok' as const,attributes:{},links:[],versionMatch:true,symbolId});
  const spans=[span('child','server-b',1,'target'),span('server-b','client',2),span('client','caller',3),span('caller','server-a',1,'caller'),span('server-a','browser',2)];
  const reading=readingSpans(spans,{spanId:'browser'} as any);assert.deepEqual(reading.spans.map(s=>s.spanId),['caller','child']);assert.equal(reading.parent(spans[0]),'caller');assert.equal(reading.depth(spans[0]),2);
});
test('snapshot freezes mutable input, avoids accessors, bounds and redacts nested credentials',()=>{
  const input={question:'synthetic question',nested:{token:'DO_NOT_EXPORT',password:'HIDDEN'},items:[1,2]};
  const before=snapshot(input,'synthetic');input.items.push(3);input.question='changed';assert.equal((before as any).question,'synthetic question');assert.equal((before as any).items.count,2);assert.ok(!JSON.stringify(before).includes('DO_NOT_EXPORT'));
  let calls=0;const object={get payload(){calls++;throw Error('must not run');}};snapshot(object,'synthetic');assert.equal(calls,0);assert.equal((snapshot({question:'private'},'structure') as any).question.length,7);
  assert.equal((snapshot({unapproved:12345},'synthetic') as any).unapproved.type,'number');assert.equal((boundedSnapshot(Object.fromEntries(Array.from({length:20},(_,i)=>['field'+i,{question:'x'.repeat(640)}])),'synthetic') as any).truncated,true);
});
test('incremental OTLP batches retain nanoseconds, disorder, repeated invocation IDs and partial UTF8',()=>{
  const plan=buildPlan(index,new Map([[location.file,'public String submit(long tenant, String question) { return question; }']]));
  const make=(id:string,parent='')=>({traceId:'1'.repeat(32),spanId:id.repeat(16),parentSpanId:parent,name:'Dispatch.submit',kind:1,startTimeUnixNano:'1790000000000000001',endTimeUnixNano:'1790000000000000011',attributes:[{key:'codeleader.point',value:{stringValue:plan.points[0].id}},{key:'codeleader.version',value:{stringValue:plan.sourceVersion}},{key:'codeleader.input',value:{stringValue:'{"question":"合成输入"}'}}]});
  const batch={resourceSpans:[{resource:{attributes:[{key:'service.name',value:{stringValue:'server'}}]},scopeSpans:[{spans:[make('2','3'.repeat(16)),make('3')]}]}]};
  const bytes=Buffer.from(JSON.stringify(batch)+'\n'),reader=new BatchReader(plan);assert.deepEqual(reader.push(bytes.subarray(0,bytes.length-4)),[]);const spans=reader.push(bytes.subarray(bytes.length-4));assert.equal(spans.length,2);assert.equal(spans[0].start,'1790000000000000001');assert.equal(spans[0].symbolId,'method');assert.notEqual(spans[0].invocationId,spans[1].invocationId);assert.equal(reader.push(bytes).length,0);
  const mismatched=structuredClone(batch);mismatched.resourceSpans[0].scopeSpans[0].spans[0].spanId='4'.repeat(16);mismatched.resourceSpans[0].scopeSpans[0].spans[0].attributes[1].value.stringValue='old-build';const wrong=reader.push(Buffer.from(JSON.stringify(mismatched)+'\n'));assert.equal(wrong[0].versionMatch,false);assert.equal(wrong[0].symbolId,undefined);
});
