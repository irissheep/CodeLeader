import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {structure} from '../src/analysis/structure';
import {frameworks} from '../src/analysis/frameworks';
import {projectRules} from '../src/analysis/project-rules';
import {buildPlan} from '../src/runtime/plan';
import {djangoPath} from '../src/analysis/django-path';
import {drfVersion} from '../src/analysis/drf-version';
const root=process.env.CODELEADER_ROOT!,scan=async(name:string)=>{const r=await structure(path.join(root,'tests/fixtures/python-http',name),path.join(root,'resources'),()=>{});frameworks(r);projectRules(r);return r.index;};
test('Flask route methods, shortcuts, MethodView, factory and nested override prefixes',async()=>{
 const index=await scan('flask'),names=index.entries!.filter(e=>e.kind==='http').map(e=>e.name);
 for(const prefix of ['/mounted','/root/nested'])for(const route of ['GET '+prefix+'/items · items','POST '+prefix+'/items · items','PATCH '+prefix+'/items/{id} · edit','GET '+prefix+'/view · get','POST '+prefix+'/view · post'])assert(names.includes(route),route);
 assert(names.includes('GET /direct · direct'));assert(names.includes('POST /direct · direct'));assert(names.includes('GET /home · home'));assert(names.every(s=>!s.includes('/construct')&&!s.includes('false-positive')));assert.equal(names.length,13);
});
test('FastAPI constants, instance field defaults, f strings and nested imported routers compose',async()=>{
 const index=await scan('fastapi'),entry=index.entries!.find(e=>e.name==='GET /svc/gate/mid/nested/leaf/{id} · read')!;assert(entry);assert(entry.pathEvidence?.defaults);assert(entry.pathEvidence!.basis.some(b=>b.location.file==='settings.py'));assert.equal(new Set(entry.pathEvidence!.basis.filter(b=>b.kind==='call').map(b=>b.location.file)).size,2);assert.equal(index.entries!.filter(e=>e.kind==='http').length,3);
});
test('unknown environment prefix stays symbolic and carries exact source/reason, not an omitted prefix',async()=>{
 const index=await scan('fastapi'),entry=index.entries!.find(e=>e.name.endsWith(' · probe'))!;assert.equal(entry.status,'unresolved');assert(entry.pathEvidence!.path.startsWith('/maybe/${'));assert(entry.pathEvidence!.path.endsWith('/probe'));assert.equal(entry.pathEvidence!.issues[0].location.file,'application.py');assert.equal(entry.pathEvidence!.issues[0].location.range.start.line,6);assert(entry.pathEvidence!.issues[0].reason.includes('环境变量'));
 const factory=index.entries!.find(e=>e.name.endsWith(' · configured_probe'))!;assert.equal(factory.status,'unresolved');assert(factory.pathEvidence!.path.includes('${settings.ENV_PREFIX}'));assert(!factory.pathEvidence!.path.includes('not-evaluated'));
});
test('minimal Django path/re_path/include, DRF router actions and api_view methods (synthetic only)',async()=>{
 const index=await scan('django'),names=index.entries!.filter(e=>e.kind==='http').map(e=>e.name.split(' · ')[0]);
 for(const route of ['GET /api/status/','POST /api/status/','GET /api/numbers/{id}/','GET /legacy/{id}/','POST /legacy/{id}/','GET /api/v2/records/','POST /api/v2/records/','GET /api/v2/records/{pk}/','PUT /api/v2/records/{pk}/','PATCH /api/v2/records/{pk}/','DELETE /api/v2/records/{pk}/'])assert(names.includes(route),route);assert.equal(names.length,11);
});
test('existing HTTP route identities still feed observation plans directly',async()=>{
 const index=await scan('fastapi'),plan=buildPlan(index,new Map());for(const entry of index.entries!.filter(e=>e.kind==='http')){const route=plan.routes.find(r=>r.symbolId===entry.symbolId)!;assert(route);assert.equal(route.path,entry.pathEvidence!.path);assert.equal(route.method,entry.pathEvidence!.method);}
});

const enhanced=await scan('django-drf');
const djangoRoutes=(prefix:string)=>enhanced.entries!.filter(e=>e.kind==='http'&&e.pathEvidence!.path.startsWith(prefix));
test('legacy url identities, balanced named regex and nested include namespaces are preserved',()=>{
 assert.equal(djangoPath('^detail/(?P<slug>(?:[-\\w]+))/?$').value,'detail/{slug}');
 assert(djangoPath('^(one|two)/$').reason);
 for(const[prefix,module]of [['/old/','edge'],['/tuple/','inline'],['/named/','from_code']]){const entries=djangoRoutes(prefix);assert(entries.length>0);assert(entries.every(e=>e.moduleName===module));assert(entries.some(e=>e.pathEvidence!.path===prefix+'detail/{slug}'));}
 assert(enhanced.entries!.every(e=>!e.name.includes('not-mounted')),'ROOT_URLCONF controls the mounted scope');
});
test('DRF generic views and APIView methods come from the selected version and actual class members',()=>{
 const verbs=(path:string)=>djangoRoutes('/old/').filter(e=>e.pathEvidence!.path===path).map(e=>e.pathEvidence!.method).sort();
 for(const[path,methods]of Object.entries({'view/':['GET','POST'],'limited/':['GET'],'collection':['GET','POST'],'detail/{slug}':['DELETE','GET','PATCH','PUT'],'list/':['GET'],'create/':['POST'],'read/':['GET'],'change/':['PATCH','PUT'],'drop/':['DELETE'],'fn/':['GET','POST']}))assert.deepEqual(verbs('/old/'+path),methods.sort(),path);
 assert(djangoRoutes('/old/').every(e=>e.basis.includes('DRF 3.16.1')));
});
test('routers expose inherited or declared actions only, including action routes and explicit as_view maps',()=>{
 const has=(method:string,path:string)=>djangoRoutes('/old/').some(e=>e.pathEvidence!.method===method&&e.pathEvidence!.path===path);
 for(const[method,path]of [['GET','rows'],['GET','rows/{slug}'],['DELETE','rows/{slug}'],['POST','rows/{slug}/mark'],['GET','rows/lookup/{code}'],['GET','readonly/'],['GET','readonly/{pk}/'],['GET','manual/{slug}'],['DELETE','manual/{slug}']])assert(has(method,'/old/'+path),method+' '+path);
 for(const method of ['POST','PUT','PATCH'])assert(!has(method,method==='POST'?'/old/rows':'/old/rows/{slug}'));
 assert(!has('POST','/old/readonly/'));assert(!has('GET','/old/'),'no generated API-root endpoint is counted as project business');
});
test('DRF dependency selection distinguishes exact versions, nearby fixed mappings and missing declarations',()=>{
 const result={index:{units:[]},configs:new Map([['requirements.txt','djangorestframework==3.4.4']])} as unknown as Parameters<typeof drfVersion>[0];
 assert.equal(drfVersion(result,'views.py').table.version,'3.4.4');assert.equal(drfVersion(result,'views.py').approximate,false);
 result.configs.set('requirements.txt','djangorestframework==3.15.0');assert.equal(drfVersion(result,'views.py').table.version,'3.16.1');assert.equal(drfVersion(result,'views.py').label,'按 DRF 3.16.1 映射');
 result.configs.set('requirements.txt','djangorestframework>=3.16.1');assert.equal(drfVersion(result,'views.py').approximate,true);
 result.configs.clear();assert.equal(drfVersion(result,'views.py').approximate,true);
});
