import test from 'node:test';
import assert from 'node:assert/strict';
import {actualSnapshot} from '../src/runtime/snapshot';
import {buildReplay,type ReplayModel} from '../src/runtime/replay';
import type {RecordedSpan,SafeValue} from '../src/shared/execution';
import {phaseRuns,stepTrace,trackingFields,walkthroughRows} from '../src/renderer/walkthrough-model';

function fixture(){
 const request={id:'req',traceId:'trace',spanId:'browser',method:'POST',url:'http://test/api/renamed',page:'http://test',start:1,end:20,status:201,input:actualSnapshot({title:'same-title',category:'',zero:0,flag:true}),output:actualSnapshot({id:9,title:'same-title',category:'未分类',zero:0,flag:true})};
 const span=(spanId:string,parentSpanId:string,name:string,start:number,end:number,input:SafeValue|undefined,output:SafeValue|undefined,attributes:RecordedSpan['attributes']={}):RecordedSpan=>({spanId,parentSpanId,traceId:'trace',name,start:String(start),end:String(end),kind:0,service:'renamed-service',status:'ok',versionMatch:true,links:[],input,output,attributes:{'codeleader.point':spanId,'codeleader.phase':'exit',...attributes}});
 const spans=[span('controller','server','RenamedController.add',10,100,actualSnapshot({request:{title:'same-title',category:''}}),request.output),span('service','controller','RenamedService.add',20,90,actualSnapshot({request:{title:'same-title',category:''}}),request.output),span('sql','service','SQL execute',30,40,actualSnapshot({parameters:{'1':'same-title','2':'未分类'}}),undefined,{'codeleader.phase':null,'codeleader.boundary':'jdbc','db.query.text':'INSERT INTO renamed_note (title, category) VALUES (?, ?)'}),{...span('server','browser','POST /api/renamed',5,110,undefined,undefined),kind:2}];
 const model=buildReplay(request,spans,{clocks:Object.fromEntries(spans.map(s=>[s.spanId,'jvm'])),synchronousParents:{service:'controller',sql:'service'}});return model;
}
test('walkthrough combines calls while keeping all original replay steps and phase runs',()=>{
 const model=fixture(),copy=JSON.stringify(model),rows=walkthroughRows(model,'raw'),runs=phaseRuns(model);
 assert.deepEqual(new Set(rows.flatMap(row=>row.callIds)),new Set(model.calls.map(call=>call.id)));assert.ok(rows.length<model.steps.length);assert.equal(runs.reduce((n,run)=>n+run.count,0),model.steps.length);
 assert.ok(rows.find(row=>row.name.includes('RenamedService')&&row.phase==='业务')!.depth<rows.find(row=>model.byCall[row.callId].kind==='sql')!.depth);
 assert.equal(JSON.stringify(model),copy);
});
test('category changes only at the method return and is not attributed twice to outer returns',()=>{
 const model=fixture(),field=trackingFields(model,'raw').find(field=>field.key==='category')!,rows=walkthroughRows(model,'raw',field);
 assert.equal(rows[0].trace?.value,'');const changed=rows.filter(row=>row.trace?.changed);assert.equal(changed.length,1);assert.match(changed[0].name,/RenamedService/);assert.equal(changed[0].trace?.value,'未分类');
 assert.ok(rows.some(row=>row.fact.includes('category (空) → 未分类')));
 assert.equal(rows.find(row=>model.byCall[row.callId].kind==='sql'&&row.phase==='数据')?.trace?.value,'未分类');
});
test('unchanged title and unique equal-value fallback stay factual; short values and booleans never match',()=>{
 const model=fixture(),field=trackingFields(model,'raw').find(field=>field.key==='title')!,rows=walkthroughRows(model,'raw',field);
 assert.ok(rows.every(row=>!row.trace?.changed));assert.ok(rows.filter(row=>row.trace?.value!==undefined).every(row=>row.trace?.value==='same-title'));
 const sql=model.steps.find(step=>model.byCall[step.callId].kind==='sql')!,call=model.byCall[sql.callId];call.span!.attributes['db.query.text']='dynamic';call.input=actualSnapshot({parameters:{1:'same-title',2:0,3:true}});
 assert.equal(stepTrace(model,sql,field,'raw').matched,'value');assert.equal(stepTrace(model,sql,{key:'zero',name:'zero',value:0},'raw').value,undefined);assert.equal(stepTrace(model,sql,{key:'flag',name:'flag',value:true},'raw').value,undefined);
});
test('missing SQL results do not borrow ids from later returns and partial values are marked',()=>{
 const model=fixture(),rows=walkthroughRows(model,'raw');assert.match(rows.find(row=>model.byCall[row.callId].kind==='sql')!.fact,/返回行数没录到/);assert.ok(!rows.find(row=>model.byCall[row.callId].kind==='sql')!.fact.includes('id = 9'));
 const service=model.calls.find(call=>call.name==='RenamedService.add')!;service.output=actualSnapshot({category:'x'.repeat(9000)});const field={key:'category',name:'category',value:''};const trace=stepTrace(model,model.steps[model.positions[service.returnId!]],field,'raw');assert.equal(trace.changed,false);assert.match(trace.notice!,/已截断，原长 9000/);assert.match(walkthroughRows(model,'raw',field).find(row=>row.callId===service.id)!.fact,/原长 9000/);
});
test('ambiguous same-name values stay unknown, and hidden display is honored without changing originals',()=>{
 const model=fixture(),call=model.calls.find(call=>call.name==='RenamedService.add')!,step=model.steps[model.positions[call.enterId]];call.input=actualSnapshot({left:{title:'one'},right:{title:'two'},password:'actual-password'});const before=JSON.stringify(call.input);
 assert.equal(stepTrace(model,step,{key:'title',name:'title',value:'one'},'raw').notice,'有多个不同的值');assert.equal(stepTrace(model,step,{key:'password',name:'password',value:'actual-password'},'raw').value,'actual-password');assert.equal(stepTrace(model,step,{key:'password',name:'password',value:'actual-password'},'hidden').value,'[隐藏]');assert.equal(JSON.stringify(call.input),before);
 assert.equal(trackingFields(model,'structure').length,0);assert.ok(walkthroughRows(model,'structure').every(row=>row.fact.startsWith('这份记录没有保存具体内容')));
 const sql=model.steps.find(step=>model.byCall[step.callId].kind==='sql')!;model.byCall[sql.callId].input=actualSnapshot({parameters:{1:'same-title',2:'x'.repeat(9000)}});assert.match(stepTrace(model,sql,{key:'category',name:'category',value:''},'raw').notice!,/原长 9000/);
});
