import test from 'node:test';
import assert from 'node:assert/strict';
import type {ProjectIndex,Relation,ViewState} from '../src/shared/model';
import {readingStarts,selectReadingStarts} from '../src/renderer/reading-starts';
import {viewIssues} from '../src/renderer/view-issues';

const loc=(line:number)=>({file:'src/entry.java',range:{start:{line,character:0},end:{line,character:3}}});
const rel=(id:string,from:string,to:string|undefined,status:Relation['status'],line:number,type:Relation['type']='CALLS'):Relation=>({id,from,to,status,type,target:id,source:'JavaSymbolSolver',locations:[loc(line)]});
const entry=(id:string)=>({id,kind:'http',name:id,symbolId:id,location:loc(0),group:'',owner:'',area:'',basis:'',status:'resolved'} as const);
const view={level:'guide',expanded:[],positions:{},viewport:{x:0,y:0,zoom:1},filter:'all',query:'',density:'detail'} as ViewState;
const model=()=>({id:'example',entries:[entry('database'),entry('other')],symbols:['database','other','service','mapper','work','more'].map(id=>({id})),entities:[{id:'table',kind:'resource',resourceKind:'table',name:'records'}],relations:[rel('d1','database','service','resolved',1),rel('d2','service','mapper','candidate',2),{...rel('sql','mapper','table','resolved',3,'READS'),data:{operation:'read',table:'records'}},rel('o1','other','work','resolved',4),rel('o2','work','more','resolved',5),rel('outside','more',undefined,'candidate',6)]} as unknown as ProjectIndex);

test('reading start ranks an evidenced database path first and marks an uncertain hop',()=>{
 const index=model(),rank=readingStarts(index,index.entries!);assert.equal(rank[0].entry.id,'database');assert.deepEqual(rank[0].tables,['records']);assert.equal(rank[0].uncertain,true);assert.equal(rank[1].entry.id,'other');assert.deepEqual(readingStarts(index,index.entries!).map(r=>r.entry.id),rank.map(r=>r.entry.id));
 assert.deepEqual(selectReadingStarts(index,index.entries!,3).map(r=>r.entry.id),['database']);
});

test('after database access, distinct structural steps precede frontend popularity',()=>{
 const index=model();index.symbols.push({id:'last'} as ProjectIndex['symbols'][number]);index.relations.push(rel('extra','more','last','resolved',8),{...rel('other-sql','last','table','resolved',7,'READS'),data:{operation:'read',table:'records'}},rel('duplicate','other','work','resolved',4));
 index.frontendLinks={calls:[{callId:'a',outcome:'matched',targets:[{entryId:'database'}]}]} as ProjectIndex['frontendLinks'];
 const rank=readingStarts(index,index.entries!);assert.equal(rank[0].entry.id,'other');assert.equal(rank[0].steps,5);assert.equal(rank[1].calls,1);
});

test('a certain resource does not make a different uncertain resource appear certain',()=>{
 const index=model();index.entities!.push({id:'other-table',kind:'resource',resourceKind:'table',name:'verified'} as NonNullable<ProjectIndex['entities']>[number]);index.relations.push({...rel('verified-read','database','other-table','resolved',9,'READS'),data:{operation:'read',table:'verified'}});
 const first=readingStarts(index,index.entries!)[0];assert.deepEqual(first.tables,['verified','records']);assert.equal(first.uncertain,false);
});

test('a conditional database path is described as possible',()=>{
 const index=model(),row=index.relations.find(relation=>relation.id==='sql')!;row.rule={id:'condition',version:'1',outcome:'unique',basis:[],conditions:[],applicability:'conditional'};index.relations.find(relation=>relation.id==='d2')!.status='resolved';
 assert.equal(readingStarts(index,index.entries!)[0].uncertain,true);
});

test('interface count is per affected entry and does not count an unlocated external target',()=>{
 const index=model(),issues=viewIssues(index,view);assert.equal(issues.items.length,1);assert.equal(issues.items[0].id,'database');assert.equal(issues.items[0].location.range.start.line,2);
 index.relations.push(rel('resolved-same-location','service','mapper','resolved',2));assert.equal(viewIssues(index,view).items.length,0);
});

test('backbone issue list excludes known external endpoints and counts each remaining call once',()=>{
 const index=model();index.frontendLinks={calls:[{callId:'a',outcome:'unmatched',reason:'unknown-address',source:loc(1),method:'GET'},{callId:'b',outcome:'unmatched',reason:'external-backend',source:loc(2),method:'GET'},{callId:'c',outcome:'matched',reason:'unique',source:loc(3),method:'GET'}]} as ProjectIndex['frontendLinks'];
 assert.deepEqual(viewIssues(index,{...view,level:'main'}).items.map(row=>row.id),['a']);
});
