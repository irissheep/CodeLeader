import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReplay, callVisibility, initialReplay, replayAction, sessionOrderEvidence, type OrderEvidence } from '../src/runtime/replay';
import { cleanDisplay, compareSnapshots, displayValue, structuralOnly, summaryKind } from '../src/runtime/replay-data';
import type { BrowserRequest, ExecutionSession, RecordedSpan, SafeValue } from '../src/shared/execution';

const request:BrowserRequest={id:'request-a',traceId:'a'.repeat(32),spanId:'browser',method:'POST',url:'http://127.0.0.1:9999/orders',page:'http://127.0.0.1:9999',start:10,end:20,status:200,input:{question:'same'},output:{answer:'done'}};
const span=(id:string,parent:string,start:string,end:string,extra:Partial<RecordedSpan>={}):RecordedSpan=>({traceId:request.traceId,spanId:id,parentSpanId:parent,name:'Renamed.'+id,kind:1,service:'one-label',start,end,status:end?'ok':'pending',attributes:{},links:[],symbolId:'symbol:'+id,versionMatch:true,input:{id},output:{count:1},...extra});
function fixture(){
  const spans=[
    span('controller','server','1000000','1700000'),
    span('sql','controller','1100000','1120000',{symbolId:undefined,attributes:{'db.statement':'SELECT id FROM orders','db.system':'mysql'}}),
    span('gateway','controller','1200000','1600000',{input:{userId:7,question:'same',notes:{type:'array',count:1,items:[{note_id:5,revision:1}]}}}),
    span('client','gateway','1250000','1590000',{kind:3,symbolId:undefined}),
    // Different clock and the very same service label: do not compare wall clocks.
    span('python-server','client','100','900',{kind:2,symbolId:undefined,name:'POST /resolve'}),
    span('answer','python-server','200','850'),span('retrieve','answer','300','800'),
    span('vector','retrieve','400','700',{symbolId:undefined,attributes:{'codeleader.boundary':'chroma.query'}}),
    span('server','browser','900000','1800000',{kind:2,symbolId:undefined})
  ];
  const evidence:OrderEvidence={clocks:Object.fromEntries(spans.map(s=>[s.spanId,['python-server','answer','retrieve','vector'].includes(s.spanId)?'python-process':'java-process']))};
  return {spans,evidence,model:buildReplay(request,spans,evidence)};
}
const call=(model:ReturnType<typeof buildReplay>,name:string)=>model.calls.find(c=>c.span?.spanId===name)!;
test('steps interleave entry/return, pair HTTP, honor SQL before gateway and preserve skewed clocks',()=>{
  const {model,spans,evidence}=fixture(),sql=call(model,'sql'),gateway=call(model,'gateway'),answer=call(model,'answer');
  assert.ok(model.positions[sql.enterId]<model.positions[gateway.enterId]);
  assert.ok(model.positions[call(model,'controller').enterId]<model.positions[sql.enterId]);
  assert.ok(model.positions[gateway.enterId]<model.positions[answer.enterId]);
  assert.ok(model.positions[answer.returnId!]<model.positions[gateway.returnId!]);
  assert.equal(model.calls.filter(c=>c.kind==='http').length,1);assert.equal(call(model,'client').records.length,2);
  assert.equal(model.steps[0].callId,model.calls.find(c=>c.kind==='browser')!.id);
  assert.equal(model.steps.at(-1)?.phase,'return');
  const shuffled=buildReplay(request,[...spans].reverse(),evidence);assert.deepEqual(shuffled.steps.map(s=>s.id),model.steps.map(s=>s.id));
  assert.equal(model.notes.some(n=>n.includes('冲突')),false);
});
test('nanosecond ordering is precise and service labels alone prove neither process nor parallelism',()=>{
  const base=span('parent','browser','1790000000000000000','1790000000000000100');
  const a=span('z-first','parent','1790000000000000001','1790000000000000002'),b=span('a-second','parent','1790000000000000003','1790000000000000004');
  const known=buildReplay(request,[base,b,a],{clocks:{parent:'p','z-first':'p','a-second':'p'}});
  assert.ok(known.positions[call(known,'z-first').enterId]<known.positions[call(known,'a-second').enterId]);
  const unknown=buildReplay(request,[base,a,b]);assert.equal(call(unknown,'z-first').uncertain,true);assert.equal(call(unknown,'a-second').parallel,false);
  const parallel=buildReplay(request,[base,a,b],{parallel:[['z-first','a-second']]});assert.equal(call(parallel,'a-second').parallel,true);
  const session={processes:[],spans:[base,a,b],plan:{points:[]}} as unknown as ExecutionSession;assert.deepEqual(sessionOrderEvidence(session).clocks,{});
});
test('async context is not forced into synchronous nesting; missing parents are not invented',()=>{
  const parent=span('p','browser','100','200'),late=span('late','p','300','400'),orphan=span('orphan','unobserved','110','120');
  const model=buildReplay(request,[parent,late,orphan],{clocks:{p:'same','late':'same','orphan':'same'}});
  assert.ok(model.positions[call(model,'p').returnId!]<model.positions[call(model,'late').enterId]);assert.equal(call(model,'orphan').parentId,undefined);
  assert.equal(model.calls.some(c=>c.span?.spanId==='unobserved'),false);
});
test('repeated and recursive invocations keep independent snapshots and navigation identities',()=>{
  const records=[span('root','browser','100','1000'),...Array.from({length:5},(_,i)=>span('child'+i,'root',String(200+i*100),String(250+i*100),{name:'Renamed.repeat',input:{id:i}})),span('recursive','child0','210','220',{name:'Renamed.repeat',input:{id:42}})];
  const model=buildReplay(request,records,{clocks:Object.fromEntries(records.map(s=>[s.spanId,'one']))});
  assert.equal(new Set(model.steps.map(s=>s.id)).size,model.steps.length);assert.equal(model.repeats[0].calls.length,5);
  assert.equal(call(model,'child0').input&&(call(model,'child0').input as any).id,0);assert.equal((call(model,'recursive').input as any).id,42);
  assert.ok(call(model,'child0').returnId!==call(model,'recursive').returnId);
  const other=buildReplay({...request,id:'request-b'},records);assert.notEqual(other.steps[0].id,model.steps[0].id);
});
test('exception, incomplete, completed-without-output and status-only response remain distinct',()=>{
  const records=[span('open','browser','100',''),span('failed','open','110','120',{status:'error',error:{type:'ExpectedError'},output:undefined}),span('no-output','open','130','140',{output:undefined})];
  const model=buildReplay({...request,end:undefined,status:200},records,{clocks:{open:'p',failed:'p','no-output':'p'}}),open=call(model,'open');
  assert.equal(open.complete,false);assert.equal(open.returnId,undefined);assert.equal(model.calls[0].returnId,undefined);
  assert.equal(model.steps.find(s=>s.callId===call(model,'failed').id)?.exception,true);
  let state=replayAction(initialReplay(model,'synthetic'),{type:'goto',id:open.enterId});state=replayAction(state,{type:'over'});
  assert.equal(state.cursor,open.lastId);assert.match(state.notice!,/没有录到返回/);
  assert.equal(call(model,'no-output').complete,true);assert.equal(call(model,'no-output').output,undefined);
});
test('navigation supports into/over/out/back and gates future returns including manual inspection',()=>{
  const {model}=fixture(),gateway=call(model,'gateway'),http=call(model,'client');let state=initialReplay(model,'synthetic');
  state=replayAction(state,{type:'goto',id:gateway.enterId});assert.equal(callVisibility(state,gateway.id).returned,false);
  state=replayAction(state,{type:'into'});assert.equal(state.cursor,http.enterId);
  state=replayAction(state,{type:'out'});assert.equal(state.cursor,http.returnId);
  state=replayAction(state,{type:'out'});assert.equal(state.cursor,gateway.returnId);assert.equal(callVisibility(state,gateway.id).returned,true);
  state=replayAction(state,{type:'previous'});assert.equal(callVisibility(state,gateway.id).returned,false);
  state=replayAction(state,{type:'goto',id:model.steps[0].id});const at=state.cursor;
  state=replayAction({...state,playing:true},{type:'inspect',id:gateway.id});assert.equal(state.cursor,at);assert.equal(state.playing,false);assert.equal(callVisibility(state,gateway.id).returned,false);
  state={...state,showAll:true};assert.equal(callVisibility(state,gateway.id).returned,false);
});
test('breakpoints stop before entry; resume skips that one hit; manual navigation ignores breakpoints',()=>{
  const {model}=fixture(),gateway=call(model,'gateway'),position=model.positions[gateway.enterId];let state=initialReplay(model,'synthetic');
  state=replayAction(state,{type:'breakpoint',id:gateway.id});state=replayAction(state,{type:'goto',id:model.steps[position-1].id});
  state=replayAction(state,{type:'play'});const before=state.cursor;state=replayAction(state,{type:'tick'});
  assert.equal(state.cursor,before);assert.equal(state.playing,false);assert.equal(state.hit,gateway.enterId);
  state=replayAction(state,{type:'play'});state=replayAction(state,{type:'tick'});assert.equal(state.cursor,gateway.enterId);
  state=replayAction(state,{type:'previous'});state=replayAction(state,{type:'next'});assert.equal(state.cursor,gateway.enterId);assert.equal(state.hit,undefined);
});
test('late batches do not mutate frozen playback; explicit update preserves identity and pause',()=>{
  const {model,spans,evidence}=fixture();let state=initialReplay(model,'synthetic');state=replayAction(state,{type:'goto',id:call(model,'gateway').enterId});
  const cursor=state.cursor,count=state.model.steps.length;const late=buildReplay(request,[...spans,span('late-evidence','gateway','1210000','1220000')],{...evidence,clocks:{...evidence.clocks,'late-evidence':'java-process'}});
  assert.equal(state.model.steps.length,count);state=replayAction({...state,playing:false},{type:'tick'});assert.equal(state.cursor,cursor);
  state=replayAction({...state,playing:true},{type:'update',model:late});assert.equal(state.cursor,cursor);assert.equal(state.playing,false);assert.ok(state.model.steps.length>count);
});
test('safe differences distinguish values, same-length changes, structure, hidden, truncation and renaming',()=>{
  const kinds=(a:SafeValue,b:SafeValue)=>compareSnapshots(a,b).map(d=>d.kind);
  assert.deepEqual(kinds({question:'abc'},{question:'xyz'}),['value']);assert.deepEqual(kinds({question:'same'},{question:'same'}),['same']);
  assert.deepEqual(kinds({question:{type:'string',length:3}},{question:{type:'string',length:3}}),['unknown']);
  assert.deepEqual(kinds({question:'[隐藏]'},{question:'[隐藏]'}),['unknown']);assert.deepEqual(kinds({question:'x'.repeat(640)},{question:'x'.repeat(640)}),['unknown']);
  assert.ok(kinds({userId:7},{user_id:7}).includes('rename'));assert.ok(!kinds({userId:{type:'number'}},{user_id:{type:'number'}}).includes('rename'));
  assert.deepEqual(kinds({count:7},{count:'seven'}),['type']);
  const changed=compareSnapshots({question:'same'},{userId:7,question:'same',notes:{type:'array',count:1,items:[{note_id:5}]}});assert.deepEqual(changed.filter(d=>d.kind==='added').map(d=>d.path),['notes','userId']);
});
test('business type fields survive, sensitive rows disappear and display cannot restore structural history',()=>{
  const business={type:'invoice',id:7,nested:{passwordHash:'NEVER_DISPLAY',question:'hello'}};
  assert.equal(summaryKind(business),undefined);assert.equal(summaryKind({type:'invoice'}),undefined);assert.equal(summaryKind({type:'string',id:7}),undefined);
  const safe=cleanDisplay(business);assert.ok(!JSON.stringify(safe).includes('NEVER_DISPLAY'));assert.ok(!JSON.stringify(safe).includes('passwordHash'));
  const structure=displayValue(safe,'structure');assert.equal((structure as any).type.type,'string');assert.equal((displayValue(safe,'synthetic') as any).id,7);
  const saved={question:{type:'string',length:5},notes:{type:'array',count:8,items:[{note_id:{type:'number'}}]}};
  assert.deepEqual(displayValue(saved,'synthetic'),saved);assert.equal(structuralOnly(saved),true);assert.equal(structuralOnly({question:'hello'}),false);
  assert.equal(summaryKind({type:'org.springframework.http.ResponseEntity'}),'structure');
});
test('same trace uses request roots, and shared service labels do not combine process clocks',()=>{
  const a=span('java','browser','100','200',{attributes:{'codeleader.point':'j'}}),b=span('python','other-browser','10','20',{attributes:{'codeleader.point':'p'}});
  const session={requests:[request,{...request,id:'other',spanId:'other-browser'}],processes:[{role:'java',pid:1,startedAt:'a'},{role:'python',pid:2,startedAt:'b'}],spans:[a,b],plan:{points:[{id:'j',language:'java'},{id:'p',language:'python'}]}} as unknown as ExecutionSession;
  const evidence=sessionOrderEvidence(session);assert.notEqual(evidence.clocks![a.traceId+':java'],evidence.clocks![b.traceId+':python']);
  const model=buildReplay(request,[a,b],evidence);assert.equal(model.calls.some(c=>c.span?.spanId==='python'),false);
  const orphan=buildReplay(request,[span('0000','missing','1','2')]);assert.equal(orphan.steps[0].callId,orphan.calls[0].id);assert.equal(call(orphan,'0000').uncertain,true);
});
test('atomic exception breakpoints, return-stage skip and truncated observations stay honest',()=>{
  const records=[span('root','browser','10','100'),span('leaf','root','20','30',{status:'error',error:{type:'Expected'},attributes:{'codeleader.dropped':5}})];
  const model=buildReplay(request,records,{clocks:{root:'p',leaf:'p'}}),leaf=call(model,'leaf'),root=call(model,'root');let state=initialReplay(model,'synthetic');
  state=replayAction(state,{type:'goto',id:root.enterId});state=replayAction(state,{type:'breakpoint',id:leaf.id});state=replayAction(state,{type:'play'});state=replayAction(state,{type:'tick'});assert.equal(state.hit,leaf.enterId);assert.equal(callVisibility(state,leaf.id).returned,false);
  state=replayAction(state,{type:'next'});assert.equal(state.cursor,leaf.enterId);assert.equal(callVisibility(state,leaf.id).returned,true);
  state=replayAction(state,{type:'over'});assert.equal(state.cursor,root.returnId);state=replayAction(state,{type:'over'});assert.notEqual(state.cursor,root.returnId);
  assert.ok(model.notes.some(n=>n.includes('至少 5 次')));assert.equal(model.calls.length,3);
});
test('coarse clock ties prefer the recorded leaf before enclosing returns without inventing synchronous proof',()=>{
  const records=[span('outer','browser','10','100'),span('inner','outer','20','100'),span('z-leaf','inner','30','100')];
  const model=buildReplay(request,records,{clocks:{outer:'p',inner:'p','z-leaf':'p'}});
  assert.ok(model.positions[call(model,'z-leaf').enterId]<model.positions[call(model,'inner').returnId!]);
  assert.ok(model.positions[call(model,'inner').returnId!]<model.positions[call(model,'outer').returnId!]);
  assert.equal(call(model,'outer').synchronousParent,false);assert.equal(call(model,'inner').synchronousParent,false);assert.equal(call(model,'inner').uncertain,true);
});
