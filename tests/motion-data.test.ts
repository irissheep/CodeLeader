import test from 'node:test';
import assert from 'node:assert/strict';
import {actualSnapshot} from '../src/runtime/snapshot';
import type {ReplayCall,ReplayState} from '../src/runtime/replay';
import {packetSummary,readingStage} from '../src/renderer/usePacketMotion';

function fixture(input?:unknown,output?:unknown,kind:ReplayCall['kind']='method'){
 const call={id:'call',kind,records:[],children:[],input:input===undefined?undefined:actualSnapshot(input),output:output===undefined?undefined:actualSnapshot(output)} as unknown as ReplayCall;
 const state={cursor:'enter',display:'raw',model:{steps:[{id:'enter',callId:'call',phase:'enter'},{id:'return',callId:'call',phase:'return'}],positions:{enter:0,return:1},byCall:{call},request:{status:201}}} as unknown as ReplayState;
 return {call,state};
}
test('arrival summary uses input at enter and does not reveal a future return',()=>{
 const {call,state}=fixture({name:'same'},[1,2,3]);
 assert.equal(packetSummary(state,call),'1 个字段');state.cursor='return';assert.equal(packetSummary(state,call),'3 条');
});
test('a missing value does not become an invented label',()=>{
 const {call,state}=fixture();assert.equal(packetSummary(state,call),undefined);state.cursor='return';assert.equal(packetSummary(state,call),undefined);
});
test('an absent HTTP body is not described as a submitted null value',()=>{
 const {call,state}=fixture({headers:{},body:null,bodyBytes:0},undefined,'browser');assert.equal(packetSummary(state,call),undefined);
});
test('SQL row count comes from the saved return and zero is a real result',()=>{
 const {call,state}=fixture({sql:'select something'}, {observedRows:0},'sql');state.cursor='return';assert.equal(packetSummary(state,call),'0 行');
});
test('HTTP status and truncation are preserved without changing the recorded object',()=>{
 const {call,state}=fixture(undefined,{headers:{},body:{id:2},status:201},'browser'),before=JSON.stringify(call);state.cursor='return';assert.equal(packetSummary(state,call),'201 · 1 个字段');assert.equal(JSON.stringify(call),before);
 call.output=actualSnapshot('x'.repeat(9000));assert.match(packetSummary(state,call)!,/已截断.*9000/);
});
test('an internal method return keeps its business stage',()=>{
 const {state}=fixture();state.cursor='return';assert.equal(readingStage(state),'business');
});
