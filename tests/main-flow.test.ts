import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { structure } from '../src/analysis/structure';
import { frameworks } from '../src/analysis/frameworks';
import { javaSemantics } from '../src/analysis/semantics';
import { projectRules } from '../src/analysis/project-rules';
import { graphFor } from '../src/renderer/graph-model';
import { stronglyConnected } from '../src/renderer/dependency-model';
import { managedPath } from '../scripts/managed-path.mjs';
import { redact } from '../src/shared/redact';
import type { ViewState } from '../src/shared/model';
const root=process.env.CODELEADER_ROOT!,fixture=path.join(root,'tests/fixtures/main-flow');
async function analyze(configuration?:string){const result=await structure(fixture,root+'/resources',()=>{});frameworks(result);await javaSemantics(result,root+'/resources',root+'/.appdata',()=>{});projectRules(result,configuration);return result;}
const result=await analyze(),{index}=result;
const symbol=(name:string)=>index.symbols.find(s=>s.qualifiedName.endsWith(name))!;
const view:ViewState={level:'overview',expanded:[],positions:{},viewport:{x:0,y:0,zoom:1},filter:'all',query:'',relationFilter:'all',fullDependencies:true};
test('RestClient 仅终结操作建立 HTTP，部署来源与 host 范围匹配，条件 URI 两支保留',async()=>{
 const relation=index.relations.find(r=>r.from===symbol('Gateway.call').id&&r.type==='HTTP');assert.ok(relation?.to&&relation.rule?.outcome==='unique');assert.ok(relation.rule.basis.some(b=>b.location.file.endsWith('Dockerfile')));assert.ok(relation.rule.basis.some(b=>b.note.includes('Compose 环境覆盖')));
 assert.equal(index.relations.filter(r=>r.from===symbol('Gateway.noRequest').id&&r.type==='HTTP').length,0);
 const branches=index.relations.filter(r=>r.from===symbol('Gateway.branch').id&&r.type==='HTTP');assert.deepEqual(new Set(branches.map(r=>r.http?.path)),new Set(['/index','/delete']));assert.ok(branches.every(r=>r.rule!.conditions.some(c=>c.includes('deleted'))));assert.deepEqual(new Set(branches.flatMap(r=>r.rule!.information?.filter(n=>n.kind==='branch').map(n=>n.branch))),new Set(['then','else']));assert.equal(new Set(branches.flatMap(r=>r.rule!.information?.filter(n=>n.kind==='branch').map(n=>n.branchGroup))).size,1);
 const defaults=await analyze('defaults'),fallback=defaults.index.relations.find(r=>r.type==='HTTP'&&r.http?.path==='/work');assert.ok(fallback?.to?.startsWith('http:'));assert.ok(!defaults.index.symbols.some(s=>s.id===fallback?.to),'相同路径 / 端口不能跨到不同 host 的本地服务');assert.notEqual(defaults.index.createdAt,index.createdAt);assert.equal(defaults.index.schema,2);
});
test('Spring 两个 Bean 保留候选，Qualifier 可唯一定位且不随意选实现',()=>{
 const ambiguous=index.relations.filter(r=>r.type==='INJECTS'&&r.from===symbol('sample.Ambiguous').id);assert.equal(ambiguous.length,2);assert.ok(ambiguous.every(r=>r.status==='candidate'));
 const chosen=index.relations.filter(r=>r.type==='INJECTS'&&r.from===symbol('sample.Chosen').id);assert.equal(chosen.length,1);assert.equal(chosen[0].to,symbol('sample.One').id);
 assert.ok(!index.relations.some(r=>r.from===symbol('Ambiguous.invoke').id&&r.rule?.id==='spring.injected-dispatch'));
 assert.ok(index.relations.some(r=>r.from===symbol('Chosen.invoke').id&&r.to===symbol('One.send').id&&r.rule));
 assert.ok(index.relations.some(r=>r.from===symbol('PrimaryConsumer.invoke').id&&r.to===symbol('First.send').id&&r.rule?.outcome==='unique'));
 assert.ok(index.relations.some(r=>r.type==='INJECTS'&&r.from===symbol('FieldConsumer').id&&r.to===symbol('FactoryConfig.factoryPort').id));
 assert.ok(index.relations.some(r=>r.from===symbol('FieldConsumer.value').id&&r.to===symbol('FactoryImpl.value').id&&r.rule?.outcome==='unique'));
});
test('FastAPI app 身份与 lifespan 绑定不串线，多状态赋值保留候选，成员类型追到存储',()=>{
 const routes=index.entries!.filter(e=>e.kind==='http'),work=routes.find(e=>e.name.startsWith('POST /work '))!,other=routes.find(e=>e.name.startsWith('POST /other '))!;
 const main=index.relations.filter(r=>r.from===work.symbolId&&r.rule?.id==='fastapi.lifespan-state');assert.equal(main.length,1);assert.equal(main[0].to,symbol('AgentOne.answer').id);assert.equal(main[0].status,'resolved');
 const branches=index.relations.filter(r=>r.from===other.symbolId&&r.rule?.id==='fastapi.lifespan-state');assert.equal(branches.length,2);assert.ok(branches.every(r=>r.status==='candidate'));assert.ok(branches.some(r=>r.rule!.conditions.some(c=>c.includes('!('))));
 const insert=routes.find(e=>e.name.startsWith('POST /index '))!;assert.ok(index.relations.some(r=>r.from===insert.symbolId&&r.to===symbol('Store.index').id));assert.ok(index.relations.some(r=>r.from===symbol('Store.retrieve').id&&r.type==='READS'&&index.entities!.some(e=>e.id===r.to&&e.name==='Chroma')));
 const same=routes.find(e=>e.name.startsWith('POST /same '))!,merged=index.relations.filter(r=>r.from===same.symbolId&&r.rule?.id==='fastapi.lifespan-state');assert.equal(merged.length,1);assert.equal(merged[0].rule?.alternatives?.length,2);assert.equal(merged[0].status,'candidate');
});
test('模型调用依据源码 provider 默认值保留条件，local 不成为必经外部节点',()=>{
 const local=index.relations.find(r=>r.from===symbol('LocalModel.answer').id&&r.rule?.id==='langchain.conditional-invoke'),remote=index.relations.find(r=>r.from===symbol('RemoteModel.answer').id&&r.rule?.id==='langchain.conditional-invoke');assert.equal(local?.rule?.applicability,'excluded');assert.equal(remote?.rule?.applicability,'conditional');assert.ok(remote?.rule?.conditions.some(c=>c.includes('openai')));
});
test('类型关系遵循语言语义，SCC 收敛后可恢复底层类型与方向',()=>{
 assert.ok(index.relations.some(r=>r.from===symbol('Specialized').id&&r.to===symbol('types.Store').id&&r.type==='EXTENDS'));assert.ok(!index.relations.some(r=>r.from===symbol('Specialized').id&&r.type==='IMPLEMENTS'));
 assert.deepEqual(stronglyConnected(['a','b','c'],[{source:'a',target:'b'},{source:'b',target:'a'},{source:'b',target:'c'}]).map(g=>g.join('')).sort(),['ab','c']);
 const graph=graphFor(index,view);assert.ok(graph.links.every(l=>l.relations.every(r=>r.type===l.type)));
});
test('受控路径在写入前解析不存在目录的真实祖先，拒绝经 junction 越盘；秘密值遮蔽',()=>{
 const directory=path.join(root,'.tmp/verification-main-flow/path-fixture');fs.mkdirSync(directory,{recursive:true});const junction=path.join(directory,'outside');
 if(!fs.existsSync(junction))fs.symlinkSync('C:\\Windows',junction,'junction');assert.ok(fs.lstatSync(junction).isSymbolicLink());try{assert.throws(()=>managedPath(path.join(junction,'not-created','result.json')),/真实祖先/);}finally{fs.unlinkSync(junction);}assert.equal(managedPath(path.join(directory,'future','result.json')),path.join(directory,'future','result.json'));
 assert.ok(!redact('API_KEY: fixture-secret\nurl: https://a:fixture-secret@example.test').includes('fixture-secret'));
 assert.ok(!JSON.stringify(index.entities).includes('fixture-only-not-a-secret'));
 const stats=index.analysis!;assert.equal(stats.callPositions,stats.semanticInternal+stats.ruleUnique+stats.external+stats.implicit+stats.candidate+stats.unknown);
});
