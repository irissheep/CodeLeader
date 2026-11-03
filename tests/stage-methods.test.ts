import test from'node:test';import assert from'node:assert/strict';
import{buildReplay,type ReplayCall}from'../src/runtime/replay';import type{RecordedSpan}from'../src/shared/execution';import{actualSnapshot}from'../src/runtime/snapshot';
import{phaseRuns,stepPhase}from'../src/renderer/walkthrough-model';import{methodRows,methodRowTitle,sqlConditions}from'../src/renderer/method-list';
function fixture(){
 const request={id:'request',spanId:'browser',traceId:'trace',url:'http://test/api/renamed',method:'POST',page:'http://test',start:1,end:20,status:200};
 const span=(id:string,parent:string,name:string,start:number,end:number,attributes:RecordedSpan['attributes'],kind=1):RecordedSpan=>({traceId:'trace',spanId:id,parentSpanId:parent,name,start:String(start),end:String(end),kind,attributes,service:'renamed',status:'ok',versionMatch:true,links:[],durationMs:1});
 const sqlA='SELECT id FROM renamed_account WHERE username = ?',sqlB='SELECT id FROM renamed_account WHERE id = ?';
 const a=span('sql-a','handler','db read',30,45,{'db.statement':sqlA},3),b=span('jdbc-a','sql-a','SQL execute',32,40,{'db.query.text':sqlA,'codeleader.boundary':'jdbc'}),c=span('sql-b','service','db read',60,80,{'db.statement':sqlB},3),d=span('jdbc-b','sql-b','SQL execute',62,75,{'db.query.text':sqlB,'codeleader.boundary':'jdbc'});
 b.input=actualSnapshot({parameters:{1:'some-user'}});b.output=actualSnapshot({observedRows:1,savedRows:[{id:42}]});d.input=actualSnapshot({parameters:{1:42}});d.output=actualSnapshot({observedRows:1,savedRows:[{id:42}]});
 const spans=[span('server','browser','POST /api/renamed',5,110,{},2),{...span('handler','server','ProjectHandler.handle',10,100,{'codeleader.point':'handler','codeleader.phase':'exit'}),symbolId:'entry-symbol'},a,b,span('service','handler','AccountService.find',50,90,{'codeleader.point':'service','codeleader.phase':'exit'}),c,d];
 const model=buildReplay(request,spans,{clocks:Object.fromEntries(spans.map(s=>[s.spanId,'jvm']))}),ids=model.calls.filter(c=>c.kind!=='browser').sort((a,b)=>model.positions[a.enterId]-model.positions[b.enterId]).map(c=>c.id);return{model,ids};
}
test('stage classification keeps internal returns in their method stage and only the browser response amber',()=>{
 const{model}=fixture(),receivers=new Set(['entry-symbol']);
 for(const step of model.steps){const call=model.byCall[step.callId];assert.equal(stepPhase(model,step,receivers),call.kind==='browser'?(step.phase==='return'?'返回':'接收'):call.kind==='sql'?'数据':call.name==='ProjectHandler.handle'?'接收':'业务');}
 const runs=phaseRuns(model,receivers);assert.equal(runs.reduce((sum,r)=>sum+r.count,0),model.steps.length);assert.ok(runs.every((r,i)=>i===0||r.phase!==runs[i-1].phase));
 const last=model.steps.at(-1)!;last.afterResponse={offsetMs:12};assert.equal(stepPhase(model,last,receivers),'之后');
});
test('nested identical SQL rows merge within their real caller and retain every original step and identity',()=>{
 const{model,ids}=fixture(),copy=JSON.stringify(model),rows=methodRows(model,ids);assert.deepEqual(rows.map(r=>r.depth),[0,1,1,2]);assert.deepEqual(rows.map(r=>r.callIds.length),[1,2,1,2]);
 assert.equal(rows[1].name,'读取 renamed_account');assert.equal(rows[1].detail,'按 username · 1 行');assert.equal(rows[3].detail,'按 id · 1 行');assert.equal(rows[1].stepId,model.byCall[rows[1].callIds[0]].enterId);assert.equal(model.steps.length,12);assert.equal(JSON.stringify(model),copy);assert.match(methodRowTitle(model,rows[1],'raw'),/耗时 1.0 ms/);assert.match(methodRowTitle(model,rows[1],'raw'),/some-user/);
});
test('same SQL with different parameters or a different caller does not merge',()=>{
 const{model,ids}=fixture(),first=model.byCall[ids[2]],second:ReplayCall={...first,id:'different',parentId:model.byCall[ids[0]].id,enterId:'different:enter',input:actualSnapshot({parameters:{1:'another-user'}})};model.byCall[second.id]=second;model.positions[second.enterId]=6;
 assert.equal(methodRows(model,[first.id,second.id]).length,2);second.input=first.input;second.parentId=model.byCall[ids[3]].id;assert.equal(methodRows(model,[first.id,second.id]).length,2);
});
test('SQL facts use real counts and condition columns, and unrecognized expressions retain original text',()=>{
 assert.deepEqual(sqlConditions("SELECT 'where fake = 2' FROM x WHERE u.`username` = ? AND status IS NOT NULL ORDER BY id"),['username','status']);assert.deepEqual(sqlConditions('SELECT * FROM x WHERE lower(username) = ?'),[]);
 const{model,ids}=fixture(),call=model.byCall[ids[2]];call.output=undefined;assert.match(methodRows(model,[call.id])[0].detail!,/行数没录到/);call.span!.attributes['db.query.text']='UPDATE renamed_account SET state = ? WHERE id = ?';call.output=actualSnapshot({affectedRows:0});let row=methodRows(model,[call.id])[0];assert.equal(row.name,'修改 renamed_account');assert.equal(row.detail,'按 id · 0 行');
 call.span!.attributes['db.query.text']='WITH prepared AS (SELECT id FROM renamed_account) SELECT * FROM prepared';row=methodRows(model,[call.id])[0];assert.equal(row.name,String(call.span!.attributes['db.query.text']).slice(0,60)+'…');
});
test('hidden display is honored without modifying the underlying values',()=>{
 const{model,ids}=fixture(),before=JSON.stringify(model),row=methodRows(model,ids,'hidden')[1];assert.ok(!methodRowTitle(model,row,'hidden').includes('some-user'));assert.equal(JSON.stringify(model),before);
});
