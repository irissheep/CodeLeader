import test from 'node:test';import assert from 'node:assert/strict';
import {afterResponseCandidates,updateAfterResponse,backgroundAssociationGaps} from '../src/runtime/after-response';
import {buildReplay} from '../src/runtime/replay';
import type {RecordedSpan,BrowserRequest,ExecutionSession} from '../src/shared/execution';
const request=():BrowserRequest=>({id:'request',traceId:'trace',spanId:'browser',method:'POST',url:'http://local/items',page:'http://local',start:1,end:8,status:201,finished:'completed',responseObservedAt:1000});
const span=(id:string,parent:string,start:string,end:string,extra:Partial<RecordedSpan>={}):RecordedSpan=>({traceId:'trace',spanId:id,parentSpanId:parent,name:id,kind:0,service:'service',start,end,status:'ok',versionMatch:true,links:[],attributes:{'codeleader.phase':'exit','codeleader.point':id},...extra});
const records=()=>[span('server','browser','1000000000','2000000000',{kind:2}),span('handler','server','1100000000','1900000000'),span('background','handler','3200000000','3500000000'),span('database','background','3300000000','3400000000',{attributes:{'db.statement':'INSERT INTO renamed VALUES (?)'},input:{actual:'unchanged'},output:{id:42}})];
const clocks=Object.fromEntries(['server','handler','background','database'].map(id=>['trace:'+id,'one-process']));
const session=(r:BrowserRequest,spans=records()):ExecutionSession=>({state:'recording',requests:[r],spans,backgroundIdleSeconds:3,plan:{resources:[]}} as unknown as ExecutionSession);

test('only recorded descendants after the response join the tail; unrelated times and links do not',()=>{
 const r=request(),spans=records();spans.push(span('unrelated','unknown','3300000000','3400000000'),span('orphan','unknown','3300000000','3400000000',{links:[{traceId:'trace',spanId:'handler'}]}));
 const candidates=afterResponseCandidates(r,spans,clocks);assert.deepEqual([...candidates.keys()].sort(),['trace:background','trace:database']);assert.equal(candidates.get('trace:background')!.startOffsetMs,1200);
 const s=session(r,spans);updateAfterResponse(s,1100,clocks);const model=buildReplay(r,spans,{clocks}),response=model.steps.findIndex(step=>step.callId===model.calls[0].id&&step.phase==='return'),tail=model.steps.findIndex(step=>step.afterResponse);
 assert.ok(tail>response);assert.ok(model.steps.slice(tail).every(step=>step.afterResponse));assert.equal(model.calls.find(c=>c.span?.spanId==='background')!.asynchronous,true);assert.deepEqual(model.calls.find(c=>c.span?.spanId==='database')!.input,{actual:'unchanged'});assert.ok(!model.calls.some(c=>c.name==='unrelated'||c.name==='orphan'));
});
test('quiet window, hard cap and stopped recording close; delayed normal exports do not reset it',()=>{
 const r=request(),s=session(r,records().slice(0,2));updateAfterResponse(s,1100,clocks);assert.equal(r.afterResponse!.lastActivityAt,1000);updateAfterResponse(s,3999,clocks);assert.equal(r.afterResponse!.closedAt,undefined);updateAfterResponse(s,4000,clocks);assert.equal(r.afterResponse!.reason,'idle');s.spans.push(...records().slice(2));updateAfterResponse(s,4100,clocks);assert.equal(r.afterResponse!.calls.length,0);
 const capped=request(),long=session(capped);long.backgroundIdleSeconds=30;updateAfterResponse(long,1100,clocks);updateAfterResponse(long,31000,clocks);assert.equal(capped.afterResponse!.reason,'limit');
 const stopped=request(),ss=session(stopped);updateAfterResponse(ss,1100,clocks);ss.state='stopped';updateAfterResponse(ss,1200,clocks);assert.equal(stopped.afterResponse!.reason,'stopped');
});
test('no continuation produces no tail; old histories keep their steps; recorded gaps remain explicit',()=>{
 const r=request(),normal=records().slice(0,2),s=session(r,normal);updateAfterResponse(s,1100,clocks);assert.ok(buildReplay(r,normal,{clocks}).steps.every(step=>!step.afterResponse));
 const legacy={...r,afterResponse:undefined,responseObservedAt:undefined};assert.equal(buildReplay(legacy,normal,{clocks}).steps.length,buildReplay(r,normal,{clocks}).steps.length);
 normal[1].entityId='table';s.plan.resources=[{id:'table',from:'save',operation:'write'}];s.plan.backgroundReaders=[{symbolId:'worker',name:'RenamedWorker.poll',resources:['table'],location:{file:'worker.java',range:{start:{line:0,character:0},end:{line:1,character:0}}}}];assert.match(backgroundAssociationGaps(s,r)[0],/后台处理没关联上/);
});
test('a call crossing the response retains its enter, with only the recorded return in the tail',()=>{
 const r=request(),spans=records().slice(0,2);spans.push(span('background','handler','1500000000','3500000000'));const s=session(r,spans);updateAfterResponse(s,1100,clocks);const model=buildReplay(r,spans,{clocks}),steps=model.steps.filter(step=>model.byCall[step.callId].span?.spanId==='background');assert.equal(steps.length,2);assert.equal(steps[0].afterResponse,undefined);assert.equal(steps[1].afterResponse?.offsetMs,1500);
});
