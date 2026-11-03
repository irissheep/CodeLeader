import test from 'node:test';
import assert from 'node:assert/strict';
import { explainRelations } from '../src/renderer/relation-explanation';
import { openDomain,openEntry } from '../src/renderer/exploration-state';
import type { ProjectIndex,Relation,ViewState } from '../src/shared/model';
const range={start:{line:1,character:0},end:{line:1,character:9}},location={file:'gateway.java',range};
const symbol=(id:string,serviceId:string,parent?:string)=>({id,name:id,qualifiedName:id,signature:id,kind:id==='Gateway'?'class' as const:'method' as const,language:'java' as const,file:'gateway.java',module:'app',range,selection:range,routes:[],serviceId,parent});
const rule=(id:string,from:string,to:string,path:string,line:number):Relation=>({id,from,to,target:to,type:'HTTP',source:'framework-rules',status:'resolved',locations:[{file:location.file,range:{start:{line,character:0},end:{line,character:9}}}],http:{method:'POST',path,serviceId:'worker'},rule:{id:'http',version:'1',outcome:'unique',conditions:['raw guard','配置路径；未运行；敏感值未采集'],information:[{kind:'configuration',text:'静态配置关联'},{kind:'analysis',text:'未采集敏感值'}],basis:[{kind:'call',location:{file:location.file,range:{start:{line,character:0},end:{line,character:9}}},note:path},{kind:'config',location,note:'目标配置'}]}});
const relations=[rule('health','healthCall','health','/health',2),rule('index','syncIndex','index','/index',3),rule('delete','syncIndex','delete','/delete',3),rule('query','ask','query','/query',4)];
for(const [id,branch] of [['index','then'],['delete','else']] as const)relations.find(r=>r.id===id)!.rule!.information!.push({kind:'branch',text:'URI 分支',code:branch==='then'?'deleted == null':'!(deleted == null)',branchGroup:'uri-choice',branch});
const index:ProjectIndex={schema:2,id:'reading',name:'reading',root:'D:/fixture',createdAt:'fixture',status:'complete',languages:['java'],files:[],diagnostics:[],sourceRoots:[],jars:[],versions:{},symbols:[symbol('Gateway','client'),...['entry','ask','syncIndex','healthCall'].map(id=>symbol(id,'client','Gateway')),...['health','index','delete','query'].map(id=>symbol(id,'worker'))],entities:[{id:'client',name:'client',kind:'service',summary:'',basis:[]},{id:'worker',name:'worker',kind:'service',summary:'',basis:[]},{id:'domain',name:'work',kind:'domain',serviceId:'client',summary:'',entryIds:['entry'],basis:[]}],entries:[{id:'entry',name:'POST /start',symbolId:'entry',kind:'http',location,group:'work',owner:'app',area:'app',basis:'route',status:'resolved'}],relations:[...relations,{id:'calls',from:'entry',to:'ask',target:'ask',type:'CALLS',source:'tree-sitter',status:'resolved',locations:[location]}]};
test('系统标题双方使用服务身份；场景只解释所选调用，当前入口优先调用证据',()=>{
 const model=explainRelations(index,relations,{system:true,entryId:'entry'});assert.equal(model.title,'client → worker');assert.ok(model.primary[0].relationIds.includes('query'));assert.equal(model.tasks[0].relations[0].id,'query');assert.ok(model.primary.every(s=>s.kind==='call'));
 assert.ok(!model.conclusion.includes('raw guard')&&!model.conclusion.includes('敏感'));
 const scene=explainRelations(index,[relations[3]],{entryId:'entry'});assert.equal(scene.title,'Gateway.ask → query');assert.equal(scene.tasks.length,1);assert.ok(!scene.tasks.some(t=>t.relations.some(r=>r.id==='health')));
});
test('互斥分支与候选身份保留，不能将多个候选冒充一个已确认服务',()=>{
 const model=explainRelations(index,relations,true),branches=model.tasks.find(t=>t.relations.some(r=>r.id==='index'))!;assert.deepEqual(new Set(branches.relations.map(r=>r.http!.path)),new Set(['/index','/delete']));assert.ok(branches.exclusive);
 const copy=structuredClone(index);copy.entities!.push({id:'other',name:'worker',kind:'service',summary:'',basis:[]});copy.symbols.push(symbol('otherQuery','other'));const candidate=structuredClone(relations[3]);candidate.id='otherQuery';candidate.to='otherQuery';candidate.status='candidate';candidate.rule!.outcome='candidate';
 const result=explainRelations(copy,[relations[3],candidate],true);assert.equal(result.title,'client → 目标服务待确定');assert.equal(result.targets.length,2);assert.ok(result.tasks.some(t=>t.uncertain));assert.equal(result.groups.length,2);
 const legacy=structuredClone(relations[3]);legacy.rule!.information=undefined;assert.ok(explainRelations(index,[legacy]).notice);assert.deepEqual(explainRelations(index,[legacy]).groups[0].conditions,legacy.rule!.conditions.slice().sort());
});
test('重复选中接口或落点保持当前任务与快照，不制造重复导航步骤',()=>{
 const base:ViewState={level:'main',filter:'all',expanded:[],positions:{},viewport:{x:20,y:30,zoom:1},query:''},entry=index.entries![0],interfaces=openDomain(index,base,'domain'),chain=openEntry(index,interfaces,entry);
 const changed={...chain,expanded:['retained'],inspector:'source' as const,viewport:{x:100,y:200,zoom:.95}};assert.equal(openEntry(index,changed,entry),changed);
 const path=openEntry(index,interfaces,entry,'storage');assert.equal(openEntry(index,path,entry,'storage'),path);assert.equal(openEntry(index,path,entry),path);assert.equal(path.reading?.target,'storage');assert.equal(path.exploration?.base,interfaces.exploration?.base);
});
