import test from 'node:test';
import assert from 'node:assert/strict';
import { collapse, openDomain, openEntry, relatedToExploration, continuationIds } from '../src/renderer/exploration-state';
import { explainRelations } from '../src/renderer/relation-explanation';
import { graphFor } from '../src/renderer/graph-model';
import { placeExploration } from '../src/renderer/exploration-graph';
import { routeSnapshot } from '../src/renderer/graph-geometry';
import type { ProjectIndex, ViewState } from '../src/shared/model';
const range={start:{line:0,character:0},end:{line:0,character:8}},location={file:'cache.py',range};
const symbol=(id:string,serviceId='one',parent?:string)=>({id,name:id,qualifiedName:id,signature:id,kind:'function' as const,language:'python' as const,file:'app.py',module:'app',range,selection:range,routes:[],serviceId,parent});
const entry=(id:string,name:string,symbolId:string)=>({id,name,symbolId,kind:'http' as const,group:'app',owner:'app',area:'app',location,basis:'route',status:'resolved' as const});
const relation=(id:string,from:string,to:string,type:'CALLS'|'HTTP'|'READS')=>({id,from,to,type,target:to,status:'resolved' as const,source:'tree-sitter' as const,locations:[location]});
const index:ProjectIndex={schema:2,id:'continuous',name:'fixture',root:'D:/fixture',createdAt:'fixture',status:'complete',languages:['python'],files:[],sourceRoots:[],jars:[],diagnostics:[],versions:{},symbols:[symbol('entry'),symbol('gateway'),symbol('manifest'),symbol('query','two'),symbol('retrieve','two'),symbol('health','two'),symbol('CacheOwner'),symbol('get','one','CacheOwner'),symbol('put','one','CacheOwner'),symbol('evict','one','CacheOwner')],entries:[entry('ask','POST /api/ai/ask · entry','entry'),entry('status','GET /status · gateway','gateway'),entry('health','GET /health · health','health')],entities:[
 {id:'one',kind:'service',name:'one',summary:'',basis:[]},{id:'two',kind:'service',name:'two',summary:'',basis:[]},
 {id:'domain',kind:'domain',name:'work',summary:'',serviceId:'one',entryIds:['ask','status'],basis:[]},{id:'health-domain',kind:'domain',name:'support',summary:'',serviceId:'two',entryIds:['health'],basis:[]},
 {id:'database',kind:'resource',name:'database',summary:'',resourceKind:'database',basis:[]},{id:'table',kind:'resource',name:'knowledge_note',summary:'',resourceKind:'table',parentId:'database',basis:[]},
 {id:'vector',kind:'resource',name:'vector',summary:'',resourceKind:'vector',basis:[]},{id:'cache',kind:'resource',name:'cache',summary:'',resourceKind:'cache',basis:[]}
 ],relations:[relation('call','entry','gateway','CALLS'),relation('manifest','entry','manifest','CALLS'),relation('http','gateway','query','HTTP'),relation('retrieve','query','retrieve','CALLS'),relation('vector-read','retrieve','vector','READS'),relation('table-read','manifest','table','READS'),
 ...['get','put','evict'].map((from,i)=>({id:from,from,to:'cache',target:'cache',type:i===0?'READS' as const:'WRITES' as const,status:'resolved' as const,source:'framework-rules' as const,locations:[{file:'cache.py',range:{start:{line:i,character:0},end:{line:i,character:8}}}],rule:{id:'redis.template-access',version:'1',outcome:'unique' as const,conditions:['cache-enabled=true'],configuration:'fixture',basis:[{kind:'call' as const,location:{file:'cache.py',range:{start:{line:i,character:0},end:{line:i,character:8}}},note:['redis.get','redis.set','redis.delete'][i]},...['config','config','declaration'].map((kind,n)=>({kind:kind as 'config'|'declaration',location:{file:'config.yml',range:{start:{line:n,character:0},end:{line:n,character:8}}},note:'shared '+n}))]}}))
 ]};
const base:ViewState={level:'main',expanded:[],positions:{},viewport:{x:123,y:45,zoom:.97},filter:'all',query:'',reading:{types:['HTTP','DATA']},selected:'retained'};
const ask=index.entries!.find(e=>e.name.startsWith('POST /api/ai/ask '))!,domain=index.entities!.find(e=>e.kind==='domain'&&e.entryIds?.includes(ask.id))!;
test('展开、换入口、逐层收起恢复独立快照，服务与资源身份保留',()=>{
 const graph=graphFor(index,base),positions=Object.fromEntries(graph.cards.map((c,i)=>[c.id,{x:i*700,y:110}])),view={...base,positions};
 const interfaces=openDomain(index,view,domain.id),chain=openEntry(index,interfaces,ask),model=graphFor(index,chain),layout=placeExploration(model.cards,positions);
 assert.equal(chain.level,'main');assert.ok(model.cards.some(c=>c.id===domain.serviceId));assert.ok(model.cards.some(c=>c.id===ask.symbolId&&c.kind==='anchor'));assert.equal(new Set(model.cards.map(c=>c.id)).size,model.cards.length);
 assert.deepEqual(layout[domain.serviceId!],positions[domain.serviceId!]);routeSnapshot(1,model.cards,model.links,layout);
 assert.equal(collapse(chain).exploration?.stage,'interfaces');assert.deepEqual(collapse(collapse(chain)).viewport,view.viewport);assert.deepEqual(collapse(collapse(chain)).positions,view.positions);assert.deepEqual(collapse(collapse(chain)).reading,view.reading);
 assert.equal(collapse(chain).exploration?.entryId,ask.id);assert.equal(collapse(chain).selected,ask.symbolId);assert.deepEqual(continuationIds(index,chain,'retrieve'),['retrieve','query','gateway','entry']);
 const table=index.entities!.find(e=>e.resourceKind==='table'&&e.name==='knowledge_note')!,filtered=graphFor(index,openEntry(index,interfaces,ask,table.id));assert.ok(filtered.links.some(l=>l.target===table.parentId));assert.ok(filtered.cards.some(c=>c.id===ask.symbolId));assert.ok(!filtered.cards.some(c=>c.id===table.id));
 const health=index.entries!.find(e=>e.name.startsWith('GET /health '))!,leaf=openEntry(index,chain,health);assert.equal(leaf.exploration?.stage,'chain');assert.ok(graphFor(index,leaf).cards.some(c=>c.kind==='service'));assert.ok(relatedToExploration(index,chain,ask.symbolId!));assert.ok(!relatedToExploration(index,chain,health.symbolId!));
});
test('同一资源读写清除合并，候选写入不被确定读取升级；调用及共享配置去重',()=>{
 const relations=index.relations.filter(r=>r.rule?.id==='redis.template-access'),model=explainRelations(index,relations);
 assert.equal(model.groups.length,1);assert.deepEqual(model.groups[0].operations.map(o=>o.name),['读取','写入','清除']);assert.equal(model.primary.length,3);assert.equal(model.shared.length,3);assert.ok(model.shared.every(s=>s.relationIds.length===3));
 const mixed=structuredClone(relations);mixed[1].rule!.outcome='candidate';mixed[1].status='candidate';const group=explainRelations(index,mixed).groups[0];assert.ok(group.operations.find(o=>o.name==='读取')!.certain);assert.ok(!group.operations.find(o=>o.name==='写入')!.certain);
});
test('不兼容条件、不同资源实例及配置不误合；同位置不同解释保留',()=>{
 const original=index.relations.find(r=>r.rule?.id==='redis.template-access')!,copy=structuredClone(original);copy.id+='other';copy.rule!.conditions=['enabled=false'];assert.equal(explainRelations(index,[original,copy]).groups.length,2);
 copy.rule!.conditions=original.rule!.conditions;copy.to+='other';assert.equal(explainRelations(index,[original,copy]).groups.length,2);copy.to=original.to;copy.rule!.configuration='other';assert.equal(explainRelations(index,[original,copy]).groups.length,2);
 copy.rule!.basis[0].note='另一种解释';assert.equal(explainRelations(index,[original,copy]).primary.length,2);
});
