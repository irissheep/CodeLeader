import test from 'node:test';
import assert from 'node:assert/strict';
import { structure } from '../src/analysis/structure';
import { frameworks } from '../src/analysis/frameworks';
import { projectRules } from '../src/analysis/project-rules';
import { graphFor } from '../src/renderer/graph-model';
import { entryOutcome, pathLinks } from '../src/renderer/reading-model';
import { routeSnapshot, nearestEdges } from '../src/renderer/graph-geometry';
import type { ProjectIndex, Relation, ViewState } from '../src/shared/model';

const range={start:{line:0,character:0},end:{line:0,character:1}},location={file:'app.py',range};
const view:ViewState={level:'main',filter:'all',expanded:[],positions:{},viewport:{x:0,y:0,zoom:1},query:''};
const symbols=['create','read','worker','plain'].map(id=>({id,name:id,qualifiedName:id,signature:id,kind:'function' as const,language:'python' as const,file:'app.py',module:'app',range,selection:range,routes:[],serviceId:'one'}));
const relation=(id:string,from:string,to:string,type:Relation['type'],conditional=false):Relation=>({id,from,to,type,target:to,source:'framework-rules',status:'resolved',locations:[location],rule:{id:'fixture',version:'1',outcome:'unique',configuration:'default',basis:[],conditions:conditional?['enabled == true']:[],applicability:conditional?'conditional':'included'}});
const index:ProjectIndex={schema:2,id:'reader',name:'reader',root:'D:/fixture',createdAt:'test',status:'complete',languages:['python'],files:[],sourceRoots:[],jars:[],diagnostics:[],versions:{},symbols,entities:[
 {id:'one',kind:'service',name:'only-service',summary:'应用',basis:[]},
 {id:'domain',kind:'domain',name:'work',summary:'',serviceId:'one',entryIds:['create-entry','read-entry'],basis:[]},
 {id:'db',kind:'resource',name:'Shared storage',resourceKind:'database',summary:'',basis:[]},
 {id:'table',kind:'resource',name:'items',resourceKind:'table',parentId:'db',summary:'',basis:[]},
 {id:'file',kind:'resource',name:'Local state',resourceKind:'file',summary:'',basis:[]}
],entries:[{id:'create-entry',kind:'http',name:'POST /work · create',symbolId:'create',group:'work',owner:'app',area:'app',location,basis:'declaration',status:'resolved'},{id:'read-entry',kind:'http',name:'GET /work · read',symbolId:'read',group:'work',owner:'app',area:'app',location,basis:'declaration',status:'resolved'},{id:'plain-entry',kind:'http',name:'GET /ping · plain',symbolId:'plain',group:'work',owner:'app',area:'app',location,basis:'declaration',status:'resolved'}],relations:[relation('write','create','table','WRITES'),relation('read','worker','table','READS'),relation('conditional','create','table','READS',true),relation('file-read','read','file','READS')]};

test('主干仅在服务层聚合读写，条件、原始 ID、配置与候选边界保真',()=>{
 const graph=graphFor(index,view),data=graph.links.find(l=>l.target==='db')!;
 assert.deepEqual(new Set(data.relations.map(r=>r.id)),new Set(['write','read','conditional']));assert.equal(data.type,'DATA');assert.ok(data.conditional);assert.equal(data.optional,false);
 assert.equal(graph.cards.filter(c=>c.kind==='service').length,1);assert.ok(graph.cards.find(c=>c.kind==='service')?.capabilities?.some(c=>c.id==='domain'));assert.ok(!graph.cards.some(c=>c.kind==='domain'));
 const alternative=structuredClone(index),different=relation('other-config','create','table','READS');different.rule!.configuration='other';alternative.relations.push(different);const candidate=relation('candidate','create','table','READS');candidate.status='candidate';candidate.rule!.outcome='candidate';alternative.relations.push(candidate);
 assert.equal(graphFor(alternative,view).links.filter(l=>l.target==='db').length,3);
 const scoped=graphFor(index,{...view,reading:{scope:'domain'}});assert.ok(!scoped.links.flatMap(l=>l.relations).some(r=>r.id==='read'),'不把服务未触达的 worker 关系混入所选能力');
});
test('同组入口不共享资源并集；循环和未知不冒充直接返回，缓存按索引身份复用',()=>{
 const create=entryOutcome(index,index.entries![0]),read=entryOutcome(index,index.entries![1]);assert.deepEqual(create.destinations.map(d=>d.id),['table']);assert.deepEqual(read.destinations.map(d=>d.id),['file']);assert.ok(!create.direct);assert.equal(entryOutcome(index,index.entries![0]),create);
 assert.ok(entryOutcome(index,index.entries![2]).direct);
 const cycle=structuredClone(index);cycle.relations.push(relation('loop','create','create','CALLS'));assert.ok(entryOutcome(cycle,cycle.entries![0]).pending);
 const unknown=structuredClone(index);unknown.relations.push({...relation('gap','plain','dynamic','CALLS'),to:undefined,status:'unresolved',rule:undefined});assert.ok(!entryOutcome(unknown,unknown.entries![2]).direct);
 const shared=structuredClone(index);shared.entities!.push({id:'two',kind:'service',name:'remote',summary:'',basis:[]});shared.symbols.find(s=>s.id==='worker')!.serviceId='two';shared.relations.push(relation('remote-branch','create','worker','HTTP',true));assert.deepEqual(entryOutcome(shared,shared.entries![0]).destinations.find(d=>d.id==='table')!.via,[],'本地和远端共用资源时，不把远端服务写成必经共同路径');assert.ok(entryOutcome(shared,shared.entries![0]).destinations.find(d=>d.id==='table')!.conditional,'条件标记汇集所有可达分支，不因先遍历无条件分支而丢失');
 const graph=graphFor(index,view),selected=graph.links.find(l=>l.target==='db')!;
 assert.equal(graphFor(index,{...view,relationSelection:selected.id,reading:{isolate:'relation'}}).links.length,1);
 assert.deepEqual(new Set(pathLinks(graph.links,'one','db').map(l=>l.id)),new Set([selected.id]));
 assert.deepEqual(graphFor(index,{...view,reading:{types:['HTTP']}}).links,[]);
 const path=graphFor(index,{...view,level:'function',focus:'worker',entryId:'create-entry',reading:{isolate:'path',origin:'create',target:'table'}});assert.ok(path.cards.some(c=>c.id==='create')&&path.cards.some(c=>c.id==='table'));assert.ok(!path.cards.some(c=>c.id==='file'),'从子方法锁定路径时回到所选入口，保留全部相关分支');
});
test('占用通道不按序号循环复用，近邻选线依据几何距离而非绘制顺序',()=>{
 const cards=graphFor(index,view).cards,links=graphFor(index,view).links;
 const snapshot=routeSnapshot(1,cards,links,{one:{x:0,y:0},db:{x:0,y:450},file:{x:300,y:450}});
 for(const edge of snapshot.edges){const segment=edge.points.slice(1).map((b,i)=>({a:edge.points[i],b})).sort((a,b)=>Math.hypot(b.b.x-b.a.x,b.b.y-b.a.y)-Math.hypot(a.b.x-a.a.x,a.b.y-a.a.y))[0];const point={x:(segment.a.x+segment.b.x)/2,y:(segment.a.y+segment.b.y)/2};assert.ok(nearestEdges(snapshot,point).includes(edge.id));}
 assert.deepEqual(routeSnapshot(2,cards,links.slice().reverse(),{one:{x:0,y:0},db:{x:0,y:450},file:{x:300,y:450}}).edges,snapshot.edges);
});
test('单体无数据库源码 fixture 不强造第二服务或资源',async()=>{
 const root=process.env.CODELEADER_ROOT!,result=await structure(root+'/tests/fixtures/reader-first',root+'/resources',()=>{});frameworks(result);projectRules(result);
 const graph=graphFor(result.index,view);assert.equal(graph.cards.filter(c=>c.kind==='service').length,1);assert.ok(graph.cards.some(c=>c.capabilities?.some(d=>d.count===2)));assert.ok(!graph.cards.some(c=>c.kind==='resource'));assert.equal(graph.links.length,0);
});
