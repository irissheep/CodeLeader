import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {structure} from '../src/analysis/structure';
import {frameworks} from '../src/analysis/frameworks';
import {projectRules} from '../src/analysis/project-rules';

const root=process.env.CODELEADER_ROOT!;
const result=await structure(path.join(root,'tests/fixtures/spring-annotations'),path.join(root,'resources'),()=>{});
frameworks(result);projectRules(result);
const entries=(name:string)=>result.index.entries!.filter(e=>e.kind==='http'&&e.name.endsWith(' · '+name));
const one=(name:string)=>{assert.equal(entries(name).length,1,name);return entries(name)[0];};

test('literal arrays, parentheses and imported/local/nested constants are resolved without running Java',()=>{
 for(const[name,route]of Object.entries({literalArray:'GET /sample/literal',localConstant:'GET /sample/local/more',importedConstant:'GET /sample/leaf/detail',nestedConstant:'GET /sample/inside',multipleFields:'GET /sample/local/tail',literalParentheses:'GET /sample/paren/(x)',equalAliases:'GET /sample/same'})){
  const entry=one(name);assert.equal(entry.name,route+' · '+name);assert.equal(entry.status,'resolved');assert.equal(entry.pathEvidence!.issues.length,0);
 }
 assert(one('importedConstant').pathEvidence!.basis.some(b=>b.location.file.endsWith('Segments.java')));
 assert(one('importedConstant').pathEvidence!.basis.some(b=>b.note.includes('导入')));
});

test('HTTP enum members require actual imports; static, ordinary and fully qualified references agree',()=>{
 assert(one('staticMethod').name.startsWith('POST '));assert(one('qualifiedMethod').name.startsWith('DELETE '));assert(one('importedType').name.startsWith('PATCH '));
 assert.deepEqual(entries('multipleMethods').map(e=>e.pathEvidence!.method),['GET','POST']);
 assert(entries('multipleMethods').every(e=>e.pathEvidence!.aliases?.[0].path==='/sample/other'));
 assert(one('unrestricted').name.startsWith('ANY '));assert(one('emptyMethods').name.startsWith('ANY '));
 assert(result.index.entries!.every(e=>!e.name.startsWith('REQUEST ')));
});

test('all class/method path combinations remain aliases of one handler and feed backend matching',()=>{
 const entry=one('branches');assert.equal(entry.pathEvidence!.path,'/first');
 assert.deepEqual(entry.pathEvidence!.aliases!.map(a=>a.path),['/first/{id}','/second','/second/{id}']);
 const endpoints=result.index.frontendLinks!.endpoints.filter(e=>e.entryId===entry.id);assert.deepEqual(endpoints.map(e=>e.path),['/first','/first/{id}','/second','/second/{id}']);
 assert(endpoints.every(e=>e.addressKnown&&e.basis.some(b=>b.location.file.endsWith('BranchPortal.java'))));
});

test('unresolved expressions, cycles, conflicting aliases and ambiguous imports keep specific reasons',()=>{
 for(const[name,reason]of Object.entries({configuredPath:'配置',cyclicConstant:'循环',ambiguousConstant:'多个',conflictingAliases:'不一致',unknownMethod:'来源'})){
  const entry=one(name);assert.equal(entry.status,'unresolved');assert.match(entry.reason!,new RegExp(reason));assert(entry.pathEvidence!.issues.every(i=>i.location.file&&i.expression));
 }
 assert(one('unknownMethod').name.startsWith('UNKNOWN '),'unknown is never ANY or REQUEST');
 assert.equal(entries('hidden').length,0,'local annotations must not be promoted by a Spring wildcard import');
});
