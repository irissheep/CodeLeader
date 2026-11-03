import test from 'node:test';
import assert from 'node:assert/strict';
import {actualSnapshot} from '../src/runtime/snapshot';
import {methodComparison,visibleValue,valueLimits,groupedHeaders} from '../src/renderer/execution-data';
test('method comparison keeps parameter facts, matches one request object and marks incomplete values unknown',()=>{
  const before=actualSnapshot({userId:12,request:{title:'original',password:'private'}}),after=actualSnapshot({id:9,title:'original',password:'private',long:'x'.repeat(9000)}),copy=JSON.stringify([before,after]);
  const rows=methodComparison(before,after,'raw');assert.equal(rows.find(r=>r.field==='title')?.kind,'same');assert.equal(rows.find(r=>r.field==='id')?.kind,'added');assert.equal(rows.find(r=>r.field==='userId')?.kind,'removed');assert.equal(rows.find(r=>r.field==='long')?.kind,'unknown');assert.equal(rows.find(r=>r.field==='password')?.after,'private');assert.equal(methodComparison(before,after,'hidden').find(r=>r.field==='password')?.kind,'unknown');assert.equal(JSON.stringify([before,after]),copy);assert.match(valueLimits(after)[0].message,/原长 9000/);
});
test('original list values remain complete, including timestamps and fields beyond displayed columns',()=>{
  const rows=Array.from({length:5},(_,i)=>({id:i,title:'long '.repeat(100),status:'TODO',createdAt:'2026-10-23T10:54:31.123456',extra:'kept'})),saved=actualSnapshot(rows);assert.deepEqual(visibleValue(saved,'raw'),rows);
});
test('unsupported date placeholders are missing values, not recorded nulls or field changes',()=>{
  const after={__codeleader_snapshot:2,value:{title:'same',createdAt:null},limits:[{path:'createdAt',reason:'未适配对象: java.time.LocalDateTime',saved:0}]} as const;
  const rows=methodComparison(actualSnapshot({title:'same'}),after as any,'raw');assert.equal(rows.find(r=>r.field==='createdAt')!.kind,'unknown');assert.equal(rows.find(r=>r.field==='createdAt')!.afterNotice,'没录到');
});
test('request body comparison uses submitted and returned fields, keeps raw passwords and truncation uncertainty',()=>{
  const before=actualSnapshot({username:'a-user',password:'actual-secret'}),after=actualSnapshot({id:13,username:'a-user',nickname:'A',createdAt:'2026-10-24T03:40:00.123456'}),copy=JSON.stringify([before,after]);
  const rows=methodComparison(before,after,'raw',true);assert.deepEqual(Object.fromEntries(rows.map(r=>[r.field,r.kind])),{username:'same',password:'removed',id:'added',nickname:'added',createdAt:'added'});assert.equal(rows.find(r=>r.field==='password')!.before,'actual-secret');assert.equal(JSON.stringify([before,after]),copy);
  const limited={__codeleader_snapshot:2,value:{status:200,body:{title:'part'}},limits:[{path:'body.title',reason:'limit',originalLength:50,saved:4}]} as any;
  assert.equal(methodComparison(actualSnapshot({headers:{},body:{title:'part'}}),limited,'raw',true)[0].kind,'unknown');
});
test('headers fold case-insensitively without rewriting or masking their values',()=>{
 const value={'Content-Type':'application/json',authorization:'Bearer actual-token',Cookie:'a=secret',Location:'/next','Set-Cookie':'a=secret; HttpOnly','x-Request':'full-value',Host:'localhost',Connection:'keep-alive'},copy=JSON.stringify(value),groups=groupedHeaders(value);
 assert.equal(Object.keys(groups.primary).length,6);assert.deepEqual(groups.other,{Host:'localhost',Connection:'keep-alive'});assert.equal(groups.primary.authorization,'Bearer actual-token');assert.equal(groups.primary['Set-Cookie'],value['Set-Cookie']);assert.equal(JSON.stringify(value),copy);
});
