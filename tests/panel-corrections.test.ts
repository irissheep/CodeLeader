import test from 'node:test';import assert from 'node:assert/strict';
import {buildReplay,initialReplay,replayAction} from '../src/runtime/replay';
import type {RecordedSpan} from '../src/shared/execution';import {actualSnapshot} from '../src/runtime/snapshot';
import {methodRows} from '../src/renderer/method-list';import {walkthroughRows,phaseRuns} from '../src/renderer/walkthrough-model';import {rowProgress,orderNotice} from '../src/renderer/call-reading';import {methodComparison} from '../src/renderer/execution-data';
function fixture(){
 const request={id:'r',spanId:'browser',traceId:'trace',method:'POST',url:'http://test/ask',page:'http://test',start:1,end:10,status:200};
 const span=(spanId:string,parentSpanId:string,name:string,start:string,end:string,attributes:RecordedSpan['attributes']={},kind=1):RecordedSpan=>({spanId,parentSpanId,name,start,end,traceId:'trace',kind,status:'ok',service:'service',versionMatch:true,links:[],attributes:{'codeleader.point':spanId,'codeleader.phase':'exit',...attributes}});
 const spans=[span('controller','server','OtherController.ask','100','900'),span('gateway','controller','Bridge.ask','200','800'),span('payload','gateway','HTTP payload','290','790',{'codeleader.boundary':'http.payload'}),span('client','payload','POST','300','750',{'codeleader.payload':'payload'},3),span('remote','client','POST /renamed','1000','1900',{},2),span('answer','remote','Agent.answer','1100','1800'),span('retrieve','answer','Store.retrieve','1100','1700'),span('chroma','retrieve','vector','1200','1600',{'codeleader.boundary':'chroma.query'}),span('server','browser','POST /ask','90','990',{},2)];
 const clocks=Object.fromEntries(spans.map(s=>[s.spanId,['remote','answer','retrieve','chroma'].includes(s.spanId)?'python':'java']));return {request,spans,clocks,model:buildReplay(request,spans,{clocks})};
}
test('merged HTTP payload bounds cannot create cycles, and same-time child entries stay after their parents',()=>{
 const {model}=fixture(),calls=['client','answer','retrieve','chroma'].map(id=>model.calls.find(c=>c.span?.spanId===id)!);assert.ok(!model.notes.some(n=>n.includes('冲突')));assert.ok(calls.every((c,i)=>i===0||model.positions[c.enterId]>model.positions[calls[i-1].enterId]));
 const rows=methodRows(model,[...calls].reverse().map(c=>c.id));assert.deepEqual(rows.map(r=>r.id),calls.map(c=>c.id));let state=replayAction(initialReplay(model,'raw'),{type:'goto',id:calls[2].enterId});assert.equal(rowProgress(state,[calls[0].id]).reached,true);assert.equal(rowProgress(state,[calls[0].id]).returned,false);state=replayAction(state,{type:'goto',id:calls[0].returnId!});assert.equal(rowProgress(state,[calls[0].id]).returned,true);
 assert.ok(calls.every(c=>orderNotice(model,c.id)===undefined));const runs=phaseRuns(model);assert.equal(runs.at(-1)!.count,2);assert.equal(runs.at(-1)!.phase,'返回');assert.equal(runs.reduce((n,r)=>n+r.count,0),model.steps.length);
});
test('SQL call rows combine nested observations, use real counts and condition names, and never hand off to a SQL name',()=>{
 const {request,spans,clocks}=fixture(),controller=spans.find(s=>s.spanId==='controller')!;controller.input=actualSnapshot({title:'x'});controller.output=actualSnapshot({title:'x'});
 const a={...controller,spanId:'sql',parentSpanId:'controller',name:'SELECT database.renamed_note',start:'140',end:'160',kind:3,input:undefined,output:undefined,attributes:{'db.statement':'SELECT id FROM database.renamed_note WHERE user_id = ? AND deleted_at IS NULL'}},b={...a,spanId:'jdbc',parentSpanId:'sql',kind:1,start:'145',end:'155',attributes:{...a.attributes,'codeleader.boundary':'jdbc'},output:actualSnapshot({observedRows:6})};
 const model=buildReplay(request,[...spans,a,b],{clocks:{...clocks,sql:'java',jdbc:'java'}}),copy=JSON.stringify(model),rows=walkthroughRows(model,'raw'),sql=rows.filter(r=>model.byCall[r.callId].kind==='sql');assert.equal(sql.length,1);assert.equal(sql[0].fact,'读取 renamed_note · 按 user_id、deleted_at · 6 行');assert.ok(!rows.some(r=>/交给 SELECT/.test(r.fact)));assert.equal(JSON.stringify(model),copy);
});
test('unrelated input and output objects are not field changes, while overlapping request fields keep their comparison',()=>{
 assert.deepEqual(methodComparison(actualSnapshot({embedding:[1],query:'q'}),actualSnapshot({documents:['a'],ids:[1],distances:[0.1]}),'raw'),[]);const same=methodComparison(actualSnapshot({request:{title:'kept',category:''}}),actualSnapshot({id:9,title:'kept',category:'default'}),'raw');assert.equal(same.find(r=>r.field==='category')!.kind,'changed');
});
test('parallel hints exclude nested time ranges and identify actual overlapping sibling ranges',()=>{
 const {request,spans,clocks}=fixture(),a={...spans[0],spanId:'a',parentSpanId:'controller',start:'150',end:'250'},b={...a,spanId:'b',start:'200',end:'280'};const model=buildReplay(request,[...spans,a,b],{clocks:{...clocks,a:'java',b:'java'}}),call=(id:string)=>model.calls.find(c=>c.span?.spanId===id)!;assert.equal(orderNotice(model,call('a').id),'这两步的时间重叠');assert.equal(orderNotice(model,call('controller').id),undefined);
 const atomic=buildReplay(request,[...spans,{...a,attributes:{'db.query.text':'SELECT id FROM a'}},{...b,attributes:{'db.query.text':'SELECT id FROM b'}}],{clocks:{...clocks,a:'java',b:'java'}});assert.equal(orderNotice(atomic,atomic.calls.find(c=>c.span?.spanId==='a')!.id),'这两步的时间重叠');
});
