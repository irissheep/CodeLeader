import test from 'node:test';import assert from 'node:assert/strict';
import {buildReplay,initialReplay,replayAction,replayFingerprint} from '../src/runtime/replay';
import {actualSnapshot} from '../src/runtime/snapshot';
import {exceptionChain,exceptionText} from '../src/runtime/exception-details';
import {followingSource} from '../src/renderer/source-follow';
import type {RecordedSpan,ExecutionSession} from '../src/shared/execution';
import type {ProjectIndex} from '../src/shared/model';

const symbol={id:'method',name:'save',qualifiedName:'RenamedService.save',kind:'method',file:'backend/RenamedService.java',selection:{start:{line:10,character:8},end:{line:10,character:12}},range:{start:{line:9,character:0},end:{line:20,character:1}}};
const index={createdAt:'v',symbols:[symbol]} as unknown as ProjectIndex;
const record={plan:{points:[{symbolId:'method',owner:'renamed.RenamedService',method:'save'}]}} as unknown as ExecutionSession;
function fixture(failed=false){
 const request={id:'r',traceId:'trace',spanId:'browser',method:'POST',url:'http://test/notes',page:'http://test',start:1,end:8,status:failed?400:201};
 const span:RecordedSpan={traceId:'trace',spanId:'method',parentSpanId:'browser',name:'RenamedService.save',kind:0,service:'renamed',start:'100',end:'300',status:failed?'error':'ok',versionMatch:true,links:[],symbolId:'method',location:{file:symbol.file,range:symbol.range},input:actualSnapshot({title:'actual-title',password:'actual-password'}),output:failed?undefined:actualSnapshot({id:9,title:'actual-title'}),error:failed?actualSnapshot({type:'ActualException',message:'actual-message',stack:[{className:'renamed.RenamedService',file:'RenamedService.java',method:'save',line:15}],cause:{type:'InnerException',message:'inner',cause:null}}):undefined,attributes:{'codeleader.point':'method','codeleader.phase':'exit'}};
 const model=buildReplay(request,[span],{clocks:{method:'jvm'},synchronousParents:{}});return {request,span,model};
}
test('without recorded call lines, source stays at the whole method and only adds head/tail values at the right steps',()=>{
 const {model}=fixture(),call=model.calls.find(call=>call.kind==='method')!;let state=replayAction(initialReplay(model,'raw'),{type:'goto',id:call.enterId}),source=followingSource(index,record,state,call)!;
 assert.equal(source.precise,false);assert.deepEqual(source.active.range,symbol.range);assert.deepEqual(source.notes.map(note=>[note.line,note.label]),[[11,'入参']]);assert.equal((source.notes[0].value as any).password,'actual-password');
 state=replayAction(state,{type:'goto',id:call.returnId!});source=followingSource(index,record,state,call)!;assert.deepEqual(source.notes.map(note=>[note.line,note.label]),[[11,'入参'],[21,'返回']]);assert.equal((source.notes[1].value as any).id,9);
});
test('error frames are not shown before the throw; exact recorded frames locate it without inventing an output',()=>{
 const {model}=fixture(true),call=model.calls.find(call=>call.kind==='method')!;let state=replayAction(initialReplay(model,'raw'),{type:'goto',id:call.enterId});assert.equal(followingSource(index,record,state,call)!.precise,false);
 state=replayAction(state,{type:'goto',id:call.returnId!});const source=followingSource(index,record,state,call)!;assert.equal(source.precise,true);assert.equal(source.active.range.start.line,14);assert.equal(source.failed,true);assert.ok(source.notes.every(note=>note.label!=='返回'));
});
test('only recorded caller lines receive child returns, and changed-source or wrong class frames are rejected',()=>{
 const {span,request}=fixture();span.attributes['codeleader.stack']=[{className:'renamed.RenamedService',file:'RenamedService.java',method:'save',line:18}];const child={...span,spanId:'child',parentSpanId:'method',symbolId:undefined,name:'Store.add',start:'150',end:'200',input:undefined,output:actualSnapshot({id:9}),attributes:{'codeleader.point':'child','codeleader.stack':[{className:'renamed.RenamedService',file:'RenamedService.java',method:'save',line:16}]}} as RecordedSpan;
 const model=buildReplay(request,[span,child],{clocks:{method:'one',child:'one'},synchronousParents:{child:'method'}}),call=model.calls.find(call=>call.span?.spanId==='method')!;const state=replayAction(initialReplay(model,'raw'),{type:'goto',id:call.returnId!});assert.equal(followingSource(index,record,state,call)!.notes.find(note=>note.label==='→ 返回')!.line,16);
 span.versionMatch=false;const staleModel=buildReplay(request,[span],{clocks:{method:'one'}});assert.equal(followingSource(index,record,initialReplay(staleModel,'raw'),staleModel.calls.find(c=>c.kind==='method')!),undefined);
});
test('automatic replay reaches a failed step, holds once, resumes, and can disable failure pauses',()=>{
 const {model}=fixture(true),error=model.steps.find(step=>step.exception)!;let state={...initialReplay(model,'raw'),playing:true};while(state.playing)state=replayAction(state,{type:'tick'});assert.equal(state.cursor,error.id);assert.equal(state.hit,error.id);assert.equal(state.inspected,error.callId);
 state=replayAction(state,{type:'play'});state=replayAction(state,{type:'tick'});assert.notEqual(state.cursor,error.id);
 state={...initialReplay(model,'raw'),playing:true,pauseOnError:false};while(state.playing)state=replayAction(state,{type:'tick'});assert.equal(state.cursor,model.steps.at(-1)!.id);assert.equal(state.hit,undefined);
});
test('HTTP-only 4xx pauses at the response, late exceptions are fingerprinted, and cause display is bounded',()=>{
 const {request,span}=fixture();const model=buildReplay({...request,status:404},[]);let state={...initialReplay(model,'raw'),playing:true};state=replayAction(state,{type:'tick'});assert.equal(state.cursor,model.steps[1].id);assert.equal(state.hit,state.cursor);
 const before=replayFingerprint(request,[span]);span.error=actualSnapshot({type:'LateException',message:'saved'});assert.notEqual(replayFingerprint(request,[span]),before);
 const old=buildReplay(request,[{...span,error:undefined,status:'ok'}],{clocks:{method:'one'}}),updated=buildReplay(request,[{...span,status:'error'}],{clocks:{method:'one'}}),oldEnd={...replayAction(initialReplay(old,'raw'),{type:'goto',id:old.steps.at(-1)!.id}),playing:true},late=replayAction(oldEnd,{type:'update',model:updated});assert.equal(late.hit,updated.calls.find(call=>call.kind==='method')!.returnId);assert.equal(late.playing,false);
 const chain=actualSnapshot({type:'Outer',message:'full',cause:{type:'Middle',message:'middle',cause:{type:'Root',message:'root',cause:{type:'Fourth',message:'not displayed'}}}});assert.equal(exceptionChain(chain).length,3);assert.equal(exceptionText(chain),'抛出 Outer：full');assert.equal(exceptionText({type:'LegacyException'}),'抛出 LegacyException：没有录到异常消息');
});
test('browser source values stay on the recorded request line and response values wait for the response step',()=>{
 const {request}=fixture(),location={file:'frontend/src/client.ts',range:{start:{line:32,character:4},end:{line:32,character:5}}};
 const actual={...request,input:actualSnapshot({username:'test-user',password:'full-secret'}),output:actualSnapshot({id:9,username:'test-user',nickname:'T',createdAt:'full-time'}),initiator:[{url:'http://test/src/client.ts',line:4,column:4,location}]};
 const model=buildReplay(actual,[]),browser=model.calls[0];let state=initialReplay(model,'raw'),source=followingSource(index,record,state,browser)!;
 assert.equal(source.notes.length,1);assert.equal(source.notes[0].line,33);assert.equal((source.notes[0].value as any).password,'full-secret');assert.deepEqual(source.browserSteps,{sent:1,received:2});
 state=replayAction(state,{type:'goto',id:browser.returnId!});source=followingSource(index,record,state,browser)!;assert.equal(source.notes.length,2);assert.ok(source.notes.every(n=>n.line===33));assert.equal(source.notes[1].summary,'← 201 · 4 个字段');assert.equal((source.notes[1].value as any).createdAt,'full-time');
});
