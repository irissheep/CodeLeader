import test from 'node:test';
import assert from 'node:assert/strict';
import type {ProjectIndex,Location,ProjectUnit} from '../src/shared/model';
import type {StructureResult} from '../src/analysis/structure';
import {analyzeFrontend} from '../src/analysis/frontend';
import {frontendLinks} from '../src/analysis/frontend-links';
import {springSettings} from '../src/analysis/frontend-link-config';
import {structure} from '../src/analysis/structure';
import {projectRules} from '../src/analysis/project-rules';
import {frameworks} from '../src/analysis/frameworks';
import {withFrontendTargets} from '../src/shared/frontend-targets';
import path from 'node:path';
const loc=(file:string,line=0):Location=>({file,range:{start:{line,character:0},end:{line,character:1}}});
const unit=(root:string,kind:ProjectUnit['kind']='application'):ProjectUnit=>({id:root,root,kind,language:kind==='frontend'?'javascript':'java',framework:kind==='frontend'?'Vue':'Spring Boot',buildIds:[],usedBy:[],basis:[{source:'entry',location:loc(root+'/Main.java'),note:'fixture'}]});
function fixture(sources:Record<string,string>,config:Record<string,string>,routes:{unit:string;method:string;path:string}[],apps=['server']){
 const index:ProjectIndex={schema:2,id:'fixture',root:'D:/fixture',name:'fixture',createdAt:'',status:'structure',languages:['java'],symbols:[],files:[],relations:[],diagnostics:[],versions:{},sourceRoots:[],jars:[],units:[unit('web','frontend'),...apps.map(root=>unit(root))],entries:routes.map((r,i)=>({id:'entry:'+i,kind:'http',name:r.method+' '+r.path+' · read',location:loc(r.unit+'/Controller.java'),group:r.unit,owner:'Controller',area:'HTTP',basis:'fixture route',status:'resolved'}))};
 const texts=new Map(Object.entries(sources)),configs=new Map(Object.entries(config));analyzeFrontend(index,texts,configs);return{index,calls:[],facts:new Map(),syntax:new Map(),texts:new Map(),configs,frontendTexts:texts} as StructureResult;
}
test('baseURL + proxy rewrite + server context path preserve placeholders and both source locations',()=>{
 const source=`import axios from 'axios';const api=axios.create({baseURL:'/gateway'});api.get('/items/\${id}');`.replace("'/items/\${id}'","'/items/{id}'");
 const config=String.raw`export default {server:{proxy:{'/gateway':{target:'http://localhost:8080',rewrite:p=>p.replace(/^\/gateway/,'/app')}}}}`;
 const result=fixture({'web/api.ts':source,'web/vite.config.ts':config},{'web/vite.config.ts':config,'server/src/main/resources/application.properties':'server.port=8080\nserver.servlet.context-path=/app'},[{unit:'server',method:'GET',path:'/items/:id'}]);
 const before=JSON.stringify([result.index.frontend,result.index.entries,result.index.units]);const links=frontendLinks(result);assert.equal(links.calls[0].outcome,'matched');assert.equal(links.calls[0].targets[0].location.file,'server/Controller.java');assert.equal(links.calls[0].source.file,'web/api.ts');assert.equal(links.units[0].lineStyle,'solid');assert.equal(JSON.stringify([result.index.frontend,result.index.entries,result.index.units]),before);
});
test('same path/port on a different authority is not matched to the project',()=>{
 const r=fixture({'web/api.ts':`import axios from 'axios';axios.get('https://other.invalid:8080/items')`},{'server/application.properties':'server.port=8080'},[{unit:'server',method:'GET',path:'/items'}]);const call=frontendLinks(r).calls[0];assert.equal(call.reason,'external-backend');assert.equal(call.targets.length,0);
});
test('two compatible applications remain candidates rather than choosing the first',()=>{
 const r=fixture({'web/api.ts':`import axios from 'axios';axios.get('http://localhost:8080/items')`},{'a/application.properties':'server.port=8080','b/application.properties':'server.port=8080'},[{unit:'a',method:'GET',path:'/items'},{unit:'b',method:'GET',path:'/items'}],['a','b']);const call=frontendLinks(r).calls[0];assert.equal(call.outcome,'ambiguous');assert.equal(call.targets.length,2);
});
test('known authority without a matching route is honestly unmatched, retaining configuration context',()=>{
 const r=fixture({'web/api.ts':`import axios from 'axios';axios.post('http://localhost:8080/missing')`},{'server/application.properties':'server.port=8080'},[{unit:'server',method:'GET',path:'/other'}]);const links=frontendLinks(r);assert.equal(links.calls[0].outcome,'unmatched');assert.equal(links.calls[0].reason,'missing-endpoint');assert.equal(links.units[0].lineStyle,'dashed');assert.equal(links.units[0].matched.length,0);
});
test('unresolved origin only gets a dashed path match; explicit user choice can be undone without mutating facts',()=>{
 const r=fixture({'web/api.ts':`import axios from 'axios';axios.get(import.meta.env.VITE_SERVER+'/items')`},{},[{unit:'server',method:'GET',path:'/items'}]);const links=frontendLinks(r);assert.equal(links.calls[0].outcome,'path-only');assert.equal(links.calls[0].addresses[0].known,false);assert.equal(links.calls[0].pathCandidates.length,1);assert.equal(links.units[0].lineStyle,'dashed');
 const frozen=JSON.stringify(r.index),chosen=withFrontendTargets(r.index,{web:{backendUnitId:'server'}});assert.equal(chosen.frontendLinks!.units[0].lineStyle,'solid');assert(chosen.frontendLinks!.calls[0].userTarget);assert.equal(chosen.frontendLinks!.calls[0].addresses[0].known,false);assert.equal(JSON.stringify(r.index),frozen);assert.equal(withFrontendTargets(r.index,{}),r.index);
 assert.equal(links.servers!.length,0,'framework default port is not a frontend address candidate');
 const explicit=fixture({'web/api.ts':`import axios from 'axios';axios.get(import.meta.env.ORIGIN+'/items')`},{'server/application.properties':'server.port=8097'},[{unit:'server',method:'GET',path:'/items'}]);frontendLinks(explicit);assert.equal(explicit.index.frontendLinks!.servers![0].location.file,'server/application.properties');const supplied=withFrontendTargets(explicit.index,{web:{address:'http://localhost:8097'}});assert.equal(supplied.frontendLinks!.calls[0].outcome,'matched');assert.equal(supplied.frontendLinks!.units[0].lineStyle,'solid');assert.equal(explicit.index.frontendLinks!.calls[0].addresses[0].known,false);
 const mixed=fixture({'web/api.ts':`import axios from 'axios';axios.get(import.meta.env.ORIGIN+'/items');axios.get('https://outside.invalid/items')`},{},[{unit:'server',method:'GET',path:'/items'}]);frontendLinks(mixed);const retained=withFrontendTargets(mixed.index,{web:{backendUnitId:'server'}});assert.equal(retained.frontendLinks!.calls[1].external!.host,'outside.invalid');assert.equal(retained.frontendLinks!.calls[1].userTarget,undefined);
 const ambiguous=fixture({'web/api.ts':`import axios from 'axios';axios.get(import.meta.env.ORIGIN+'/items')`},{},[{unit:'a',method:'GET',path:'/items'},{unit:'b',method:'GET',path:'/items'}],['a','b']);const more=frontendLinks(ambiguous);assert.equal(more.calls[0].reason,'multiple-paths');assert.equal(more.units.length,0);
});
test('frontend-only repository reports external backend and preserves host and port',()=>{
 const r=fixture({'web/api.ts':`import axios from 'axios';const api=axios.create({baseURL:'http://localhost:8123/api'});api.get('/items');`},{},[],[]);const call=frontendLinks(r).calls[0];assert.equal(call.reason,'external-backend');assert.equal(call.external!.host,'localhost');assert.equal(call.external!.port,8123);assert.equal(call.addresses[0].path,'/api/items');
});
test('profiles and YAML document offsets remain distinct, no secret keys are exported',()=>{
 const text='server:\n  port: 8080\n---\nspring:\n  config:\n    activate:\n      on-profile: prod\nserver:\n  port: 8181\n  servlet:\n    context-path: /live\npassword: do-not-export';const settings=springSettings('server/application.yml',text);assert.equal(settings.find(s=>s.profile==='prod'&&s.key==='server.port')!.location.range.start.line,8);assert(!settings.some(s=>s.value.includes('do-not-export')));
});
test('proxy pathRewrite object uses each environment profile without dropping the prefix expression',()=>{
 const config=`export default {devServer:{proxy:{[process.env.API_ROOT]:{target:'http://localhost:8080',pathRewrite:{['^'+process.env.API_ROOT]:''}}}}};`;
 const r=fixture({'web/api.ts':`import axios from 'axios';const api=axios.create({baseURL:process.env.API_ROOT});api.get('/items');`,'web/vue.config.js':config},{'web/package.json':'{}','web/.env.development':'API_ROOT=/dev','web/.env.production':'API_ROOT=/prod','web/vue.config.js':config},[{unit:'server',method:'GET',path:'/items'}]);const call=frontendLinks(r).calls[0];assert.equal(call.outcome,'matched');assert.equal(call.addresses.length,2);assert(call.addresses.every(a=>a.path==='/items'));
});
test('a complex rewrite is unknown rather than borrowing a replace call that is not returned',()=>{
 const config=String.raw`export default {server:{proxy:{'/api':{target:'http://localhost:8080',rewrite:p=>{console.log(p.replace(/^\/api/,''));return p}}}}}`;
 const r=fixture({'web/api.ts':`import axios from 'axios';axios.get('/api/items')`,'web/vite.config.ts':config},{'web/vite.config.ts':config},[{unit:'server',method:'GET',path:'/items'}]);const call=frontendLinks(r).calls[0];assert.equal(call.targets.length,0);assert.equal(call.reason,'unknown-address');
});
test('a wholly runtime URL does not become a matching root parameter after baseURL expansion',()=>{
 const r=fixture({'web/api.ts':`import axios from 'axios';const api=axios.create({baseURL:'http://localhost:8080'});function load(url:string){return api.get(url)}`},{},[{unit:'server',method:'GET',path:'/{id}'}]);const links=frontendLinks(r);assert.equal(links.calls.length,0);assert.equal(r.index.frontend!.transports.length,1);
});
test('real source scan recognizes a configured Bean across Java trivia, and rejects an unused helper',async()=>{
 const result=await structure(path.resolve('tests/fixtures/frontend-links'),path.resolve('resources'),()=>{});frameworks(result);projectRules(result);const links=result.index.frontendLinks!;assert.equal(links.calls.length,2);assert.equal(links.calls[0].outcome,'matched');assert.equal(links.calls[0].targets[0].path,'/sign-out');assert.equal(links.calls[1].outcome,'unmatched');assert(!links.endpoints.some(e=>e.path==='/not-entry'));assert.equal(result.index.entries!.filter(e=>e.kind==='http').length,0);
});
test('unresolved Python route prefixes are not treated as ordinary path parameters',()=>{
 const r=fixture({'web/api.ts':`import axios from 'axios';axios.get('http://localhost:8080/anything/items')`},{},[{unit:'server',method:'GET',path:'/{CONFIG_PREFIX}/items'}]);r.index.entries![0].pathEvidence={method:'GET',path:'/{CONFIG_PREFIX}/items',basis:[],defaults:false,conditions:[],issues:[{location:loc('server/Controller.java'),expression:'CONFIG_PREFIX',reason:'值未确定'}]};const link=frontendLinks(r).calls[0];assert.equal(link.targets.length,0);assert.equal(link.outcome,'configured');
});
test('an environment value embedded through a lexical constant keeps its configuration location',()=>{
 const r=fixture({'web/api.ts':`import axios from 'axios';const origin=import.meta.env.VITE_SERVER;axios.get(origin+'/items')`},{'web/package.json':'{}','web/.env.development':'VITE_SERVER=http://localhost:8080'},[{unit:'server',method:'GET',path:'/items'}]);const link=frontendLinks(r).calls[0];assert.equal(link.outcome,'matched');assert(link.addresses[0].basis.some(b=>b.location.file==='web/.env.development'&&b.location.range.start.line===0));
});
