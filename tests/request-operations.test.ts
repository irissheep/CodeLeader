import test from'node:test';import assert from'node:assert/strict';
import {RequestOperations}from'../src/runtime/request-operations';
import {numberedOperations,backgroundRequests,primaryRequest}from'../src/runtime/operation-flow';
import {operationNumber}from'../src/runtime/operation-evidence';
import type{BrowserOperation,BrowserRequest,ExecutionSession}from'../src/shared/execution';
const operation=(id:string,time=100,kind:BrowserOperation['kind']='click'):BrowserOperation=>({id,kind,time,documentId:'document',url:'http://localhost/page',label:'test'});
const request=(id:string,start=200,method='GET'):BrowserRequest=>({id,start,method,url:'http://localhost/items',page:'http://localhost/page',traceId:id.padEnd(32,'a'),spanId:id.padEnd(16,'b')});
const frames=(id:string)=>[{functionName:'__cl_operation_'+id,asyncDepth:0}];
function setup(){const record={operations:[],requests:[],spans:[]}as unknown as ExecutionSession,confirmed:string[]=[],expired:string[]=[],group=new RequestOperations(record,operation=>confirmed.push(operation.id),operation=>expired.push(operation.id));const add=(r:BrowserRequest,id?:string)=>{record.requests.push(r);group.associate(r,id?frames(id):[]);return r;};return{record,confirmed,expired,group,add};}
test('empty clicks and nearby unmarked requests never gain numbers or an automatic request selection',()=>{
 const{record,group,expired,confirmed,add}=setup();try{group.observe(operation('empty'));assert.equal(record.operations!.length,0);group.expire('empty');assert.deepEqual(expired,['empty']);add(request('poll'));assert.equal(numberedOperations(record).length,0);assert.equal(backgroundRequests(record).length,1);assert.deepEqual(confirmed,[]);}finally{group.stop();}
});
test('numbers start on the first marked request, remain consecutive, and multi-request writes stay primary',()=>{
 const{record,group,confirmed,add}=setup();try{group.observe(operation('unused'));group.observe(operation('save'));const write=add(request('write',200,'POST'),'save');write.end=4000;add(request('refresh',4050),'save');group.observe(operation('next',5000));add(request('next',5100),'next');assert.deepEqual(record.operations!.map(operation=>operation.number),[1,2]);assert.deepEqual(confirmed,['save','next']);assert.equal(primaryRequest(record,'save').request?.id,'write');assert.equal(backgroundRequests(record).length,0);}finally{group.stop();}
});
test('first requests outside 1500ms and interval callbacks remain background even when a marker exists',()=>{
 const{record,group,add}=setup();try{group.observe(operation('old'));add(request('late',1601),'old');group.observe(operation('timer',2000));const r=request('poll',2100);record.requests.push(r);group.associate(r,[...frames('timer'),{functionName:'__cl_background_interval',asyncDepth:0}]);assert.equal(record.operations!.length,0);assert.equal(backgroundRequests(record).length,2);}finally{group.stop();}
});
test('one typing burst shares identity and accepts the request belonging to an earlier key event',()=>{
 const{record,group,add}=setup();try{group.observe(operation('typing',100,'input'));group.observe(operation('typing',140,'input'));add(request('query',130),'typing');group.observe(operation('typing',300,'input'));add(request('final',450),'typing');assert.equal(record.operations!.length,1);assert.equal(record.operations![0].time,300);assert.equal(record.requests[0].operationId,'typing');assert.equal(primaryRequest(record,'typing').request?.id,'final');}finally{group.stop();}
});
test('delayed initiator metadata promotes a request once, while ambiguous action callbacks do not fabricate a choice',()=>{
 const{record,group,confirmed,add}=setup();try{group.observe(operation('one'));const r=add(request('first'));group.associate(r,frames('one'));group.associate(r,frames('one'));group.observe(operation('two',210));const ambiguous=request('ambiguous',220);record.requests.push(ambiguous);group.associate(ambiguous,[...frames('one'),...frames('two')]);assert.deepEqual(confirmed,['one']);assert.equal(ambiguous.operationId,undefined);assert.equal(ambiguous.background,true);}finally{group.stop();}
});
test('legacy empty and open actions are omitted from numbered history without deleting any request',()=>{
 const record={operations:[{...operation('open'),kind:'open'},{...operation('empty'),number:8},{...operation('used'),number:19}],requests:[{...request('startup'),operationId:'open'},{...request('business'),operationId:'used'}],spans:[]}as unknown as ExecutionSession;
 const operations=numberedOperations(record);assert.deepEqual(operations.map(operation=>operation.id),['used']);assert.equal(operationNumber(operations,operations[0]),1);assert.equal(backgroundRequests(record).length,1);assert.equal(record.requests.length,2);
});
