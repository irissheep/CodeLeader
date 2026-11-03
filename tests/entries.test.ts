import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { structure } from '../src/analysis/structure';
import { frameworks } from '../src/analysis/frameworks';
import { javaSemantics, children } from '../src/analysis/semantics';
import { entryGroups, symbolView, boundaries, nextDensity } from '../src/renderer/entry-model';
import { graphFor } from '../src/renderer/graph-model';
import { cardSize, routeSnapshot, segmentHits } from '../src/renderer/graph-geometry';
import type { ViewState } from '../src/shared/model';
const root=process.env.CODELEADER_ROOT!;
const result=await structure(path.join(root,'tests/fixtures/entries'),path.join(root,'resources'),()=>{});frameworks(result);
const {index}=result,view:ViewState={level:'guide',expanded:[],positions:{},viewport:{x:0,y:0,zoom:1},filter:'all',query:'',density:'detail'};
test('入口来自 AST 与真实来源：Spring 通配、类方法前缀、main；同包本地注解不冒充 Spring',()=>{
  assert.ok(index.entries?.some(e=>e.name==='POST /api/items · create'));
  assert.ok(index.entries?.some(e=>e.name==='GET /api · base'));
  assert.ok(index.entries?.some(e=>e.name==='GET /api/relative · relative'));
  assert.equal(index.entries?.filter(e=>e.kind==='java-main').length,1);
  assert.ok(index.entries?.every(e=>!e.name.includes('not-spring')));
  assert.equal(index.relations.filter(r=>r.type==='CALLS').length,0,'路由提取不能补造调用');
});
test('Python 工厂 / 嵌套装饰器 / 导入别名保留作用域，参数和覆盖赋值不误认，模块启动不伪造函数',()=>{
  assert.ok(index.entries?.some(e=>e.name==='GET /inside · health'&&e.basis.includes('create_app')));
  assert.ok(index.entries?.some(e=>e.name==='GET /outer · outer'));
  assert.ok(index.entries?.some(e=>e.name==='POST /mount/v1/go · go'));
  assert.ok(index.entries?.every(e=>!(/not-framework|not-fastapi|overwritten/.test(e.name))));
  const main=index.entries?.find(e=>e.kind==='python-main');assert.ok(main&&!main.symbolId&&main.reason);
});
test('导览、文件与类导航保留层级，追踪边界不伪造业务终点或类型调用',()=>{
  const guide=graphFor(index,view);assert.equal(guide.links.length,0);assert.ok(guide.cards.every(c=>c.kind==='entry-group'));
  assert.equal(guide.cards.length,entryGroups(index).filter(g=>g.entries[0].kind==='http').length,'启动辅助默认收起，完整接口仍保留');
  const sample=index.entries!.find(e=>e.kind==='http')!;
  assert.equal(entryGroups({...index,entries:[{...sample,id:'one',name:'GET /api/one/{id} · one'},{...sample,id:'two',name:'GET /api/two/{id} · two'}]})[0].name,'/api','共同部分必须是连续前缀，不能拼接相同尾段');
  const type=index.symbols.find(s=>s.name==='RealController')!,method=index.symbols.find(s=>s.name==='create')!;
  assert.deepEqual(symbolView(type),{level:'class',focus:type.id});assert.deepEqual(symbolView(method),{level:'function',focus:method.id});
  assert.ok(graphFor(index,{...view,level:'file',focus:type.file}).cards.some(c=>c.id===type.id&&c.rows?.some(r=>r.id===method.id)));
  assert.ok(graphFor(index,{...view,level:'class',focus:type.id}).cards.some(c=>c.id===method.id));
  assert.ok(boundaries(index,method).some(b=>b.kind==='no-internal'));assert.ok(boundaries(index,method).every(b=>!b.label.includes('结束')));
});
test('密度使用回差，外框与路由同步压紧，恢复稳定几何仍正交且避障',()=>{
  assert.equal(nextDensity('detail',0.6),'detail');assert.equal(nextDensity('detail',0.55),'compact');assert.equal(nextDensity('compact',0.7),'compact');assert.equal(nextDensity('compact',0.8),'detail');
  const file='sample/RealController.java',detail=graphFor(index,{...view,level:'module',focus:'sample'}),compact=graphFor(index,{...view,level:'module',focus:'sample',density:'compact'});
  const before=detail.cards.find(c=>c.id===`file:${file}`)!,after=compact.cards.find(c=>c.id===before.id)!;
  assert.ok(before.rows!.length>0);assert.ok(cardSize(before).height>cardSize(after).height);assert.equal(cardSize(after).height,96);
  const points=Object.fromEntries(compact.cards.map((c,i)=>[c.id,{x:i*400,y:0}]));const snapshot=routeSnapshot(1,compact.cards,compact.links,points);
  for(const edge of snapshot.edges)for(let i=1;i<edge.points.length;i++){const a=edge.points[i-1],b=edge.points[i];assert.ok(a.x===b.x||a.y===b.y);for(const node of snapshot.nodes.filter(n=>!n.ports.some(p=>p.id===edge.sourcePort||p.id===edge.targetPort)))assert.ok(!segmentHits(a,b,node));}
});
test('跨文件 record 访问使用同一 SymbolResolver，内部服务调用不退化为解析器配置错误',async()=>{
  await javaSemantics(result,path.join(root,'resources'),path.join(root,'.appdata'),()=>{});
  const caller=index.symbols.find(s=>s.qualifiedName==='record.Caller.start')!,target=index.symbols.find(s=>s.qualifiedName==='record.Service.get')!;
  assert.ok(index.relations.some(r=>r.from===caller.id&&r.to===target.id&&r.status==='resolved'));
  assert.ok(index.relations.every(r=>!r.reason?.includes('Symbol resolution not configured')));
  assert.ok(boundaries(index,caller).some(b=>b.kind==='no-definition'),'项目 record 的隐式访问器不能被称作外部依赖');
  assert.equal(children.size,0);
});
