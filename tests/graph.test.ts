import test from 'node:test';
import assert from 'node:assert/strict';
import { graphFor, type GraphCard, type GraphLink } from '../src/renderer/graph-model';
import { routeSnapshot, segmentHits, type LayoutSnapshot } from '../src/renderer/graph-geometry';
import type { ProjectIndex, Relation, SymbolInfo, ViewState } from '../src/shared/model';
const range={start:{line:0,character:0},end:{line:0,character:1}};
const symbols:SymbolInfo[]=Array.from({length:5},(_,i)=>({id:`s${i}`,name:`f${i}`,qualifiedName:`m${i}.f${i}`,signature:`f${i}()`,kind:'function',language:'python',module:`m${i}`,file:`m${i}.py`,range,selection:range,routes:[]}));
const relation=(id:string,from:number,to:number,type:Relation['type']='CALLS',status:Relation['status']='resolved'):Relation=>({id,from:`s${from}`,to:`s${to}`,target:`f${to}`,type,status,source:'Pyright',locations:[{file:`m${from}.py`,range}]});
const relations=[relation('a',0,1),relation('b',0,1,'IMPORTS','candidate'),relation('c',1,0),relation('d',1,2),relation('e',2,0),relation('recursive',0,0),relation('caller',3,0)];
const index:ProjectIndex={schema:1,id:'graph',root:'D:\\fixture',name:'graph',createdAt:'test',status:'partial',languages:['python'],files:symbols.map(s=>({path:s.file,module:s.module,language:s.language,hash:'test',size:1})),symbols,relations,diagnostics:[],versions:{},sourceRoots:[],jars:[]};
const view:ViewState={level:'overview',expanded:[],positions:{},viewport:{x:0,y:0,zoom:1},filter:'all',query:'',relationFilter:'all',fullDependencies:true};
export function checkGeometry(snapshot:LayoutSnapshot,links:GraphLink[]){
  for(const edge of snapshot.edges){
    const link=links.find(e=>e.id===edge.id)!;
    const source=snapshot.nodes.find(n=>n.id===link.source)!,target=snapshot.nodes.find(n=>n.id===link.target)!;
    const a=source.ports.find(p=>p.id===edge.sourcePort)!,b=target.ports.find(p=>p.id===edge.targetPort)!;
    assert.deepEqual(edge.points[0],{x:source.x+a.x,y:source.y+a.y});assert.deepEqual(edge.points.at(-1),{x:target.x+b.x,y:target.y+b.y});
    for(let i=1;i<edge.points.length;i++){
      const p=edge.points[i-1],q=edge.points[i];assert.ok(p.x===q.x||p.y===q.y,`非正交边 ${edge.id}`);
      for(const node of snapshot.nodes.filter(n=>n.id!==link.source&&n.id!==link.target))assert.equal(segmentHits(p,q,node),false,`路径穿过 ${node.id}`);
    }
  }
}
test('结构图按关系类型聚合，SCC 循环收敛并可恢复方向和全部源码证据',()=>{
  const collapsed=graphFor(index,view),cycle=collapsed.cards.find(c=>c.cycle)!;assert.deepEqual(cycle.members,['dependency:file:m0.py','dependency:file:m1.py','dependency:file:m2.py']);assert.ok(cycle.innerRelations?.includes('recursive'));
  const graph=graphFor(index,{...view,expanded:cycle.members!}),edges=graph.links.filter(e=>e.source==='dependency:file:m0.py'&&e.target==='dependency:file:m1.py');
  assert.equal(edges.length,1);assert.deepEqual(new Set(edges[0].kinds),new Set(['CALLS','IMPORTS']));assert.equal(edges[0].status,'mixed');assert.equal(edges[0].relations.find(r=>r.id==='a')?.status,'resolved');assert.equal(edges[0].relations.find(r=>r.id==='b')?.status,'candidate');
  assert.ok(graph.links.some(e=>e.source==='dependency:file:m1.py'&&e.target==='dependency:file:m0.py'));
  assert.ok(collapsed.cards.find(c=>c.kind==='group')?.cycle);
  assert.ok(graph.cards.every(c=>c.section===undefined),'不再使用分析器状态作为用户分区');
  assert.deepEqual(new Set(graph.links.flatMap(e=>e.relations.map(r=>r.id))),new Set(relations.filter(r=>r.from!==r.to).map(r=>r.id)));
});
test('模块内文件容器表达归属，不生成包含调用；函数方向各自筛选并保留递归身份',()=>{
  const module=graphFor(index,{...view,level:'module',focus:'m0'});assert.ok(module.cards.every(c=>c.kind==='file'));assert.ok(module.links.every(e=>e.type!=='CONTAINS'));
  const callers=graphFor(index,{...view,level:'function',focus:'s0',direction:'callers'});
  const callees=graphFor(index,{...view,level:'function',focus:'s0',direction:'callees'});
  assert.ok(callers.cards.some(c=>c.id==='s3'));assert.ok(!callees.cards.some(c=>c.id==='s3'));
  assert.ok(callers.links.every(e=>e.target==='s0'));assert.ok(callees.links.every(e=>e.source==='s0'));
  assert.equal(callers.cards.filter(c=>c.id==='s0').length,1);
});
const cards:GraphCard[]=symbols.slice(0,4).map(s=>({id:s.id,name:s.name,kind:'symbol',subtitle:s.file,tag:'函数',callers:0,callees:0}));
const links:GraphLink[]=relations.filter(r=>r.type==='CALLS').map(r=>({id:r.id,source:r.from,target:r.to!,label:'调用',status:r.status,type:r.type,relations:[r]}));
test('恢复旧位置后按实际矩形重新路由：端口重合、双向通道、回边和递归保持正交避障',()=>{
  const positions={s0:{x:0,y:0},s1:{x:470,y:0},s2:{x:470,y:290},s3:{x:-430,y:260}};
  const first=routeSnapshot(1,cards,links,positions);checkGeometry(first,links);
  assert.notDeepEqual(first.edges.find(e=>e.id==='a')!.points,[...first.edges.find(e=>e.id==='c')!.points].reverse());
  const restored=routeSnapshot(2,cards,links,{...positions,s1:{x:450,y:320},s2:{x:0,y:310}});checkGeometry(restored,links);
  assert.deepEqual(restored.nodes.find(n=>n.id==='s1')?.x,450);
  assert.deepEqual(routeSnapshot(3,cards,links,positions).edges,first.edges);
});
test('拖动后整个快照按最终位置重新路由，不拉伸旧折点，也避开移动的非端点卡片',()=>{
  const before=routeSnapshot(1,cards,links,{s0:{x:0,y:0},s1:{x:700,y:0},s2:{x:350,y:260},s3:{x:-450,y:220}});
  const after=routeSnapshot(2,cards,links,{s0:{x:0,y:0},s1:{x:700,y:90},s2:{x:350,y:0},s3:{x:-450,y:220}});
  checkGeometry(after,links);assert.notDeepEqual(before.edges,after.edges);
});
test('共享逻辑口的出口在窄通道内收紧，不能落进相邻非端点卡片',()=>{
 const small=cards.slice(0,3),parallel:GraphLink[]=Array.from({length:5},(_,i)=>({id:'narrow'+i,source:'s0',target:'s1',label:'调用',status:'resolved',type:'CALLS',relations:[]}));
 const snapshot=routeSnapshot(1,small,parallel,{s0:{x:0,y:0},s1:{x:304,y:180},s2:{x:304,y:0}});checkGeometry(snapshot,parallel);
});
