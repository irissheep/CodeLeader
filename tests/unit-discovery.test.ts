import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {structure} from '../src/analysis/structure';
import {frameworks} from '../src/analysis/frameworks';
import {projectRules} from '../src/analysis/project-rules';
import {discoverUnits} from '../src/analysis/unit-discovery';
import {discoverResources} from '../src/analysis/resource-discovery';
const base=process.env.CODELEADER_ROOT!,fixtures=path.join(base,'tests/fixtures/unit-discovery');
const scan=(name:string)=>structure(path.join(fixtures,name),path.join(base,'resources'),()=>{});
test('Gradle multi-module: two applications, a consumed library, test driver excluded',async()=>{
 const r=await scan('gradle');assert.deepEqual(r.index.units!.filter(u=>u.kind==='application').map(u=>u.root).sort(),['web','worker']);
 const library=r.index.units!.find(u=>u.root==='support')!;assert.equal(library.kind,'library');assert.deepEqual(library.usedBy,['unit:java:web']);
 assert.deepEqual(r.index.resources!.map(r=>r.engine).sort(),['PostgreSQL','Redis']);
 const redis=r.index.resources!.find(r=>r.engine==='Redis')!;assert.equal(redis.basis[0].location.range.start.line,3);assert(redis.unitIds.includes('unit:java:web'));
 assert(!JSON.stringify(r.index.resources).includes('fixture-secret'));assert(r.index.resources!.some(r=>r.basis.some(b=>b.context?.includes('preview'))));
 frameworks(r);projectRules(r);assert.equal(r.index.entities!.filter(e=>e.kind==='resource').length,2);assert.equal(r.index.relations.filter(e=>e.type==='READS'||e.type==='WRITES').length,0);
});
test('plain Java main without a build declaration remains a runnable source unit',async()=>{
 const r=await scan('plain-java');assert.equal(r.index.buildDeclarations!.length,0);assert.equal(r.index.units!.length,1);assert.equal(r.index.units![0].kind,'application');
});
test('Django settings/manage evidence identifies application and database',async()=>{
 const r=await scan('django');assert.equal(r.index.units![0].framework,'Django');assert.equal(r.index.units![0].kind,'application');assert.deepEqual(r.index.resources!.map(r=>[r.engine,r.kind]),[['SQLite','database']]);
});
test('Python factory needs both the actual constructor and the framework declaration',async()=>{
 const global=await scan('python-global');assert.equal(global.index.units![0].kind,'application');
 const r=await scan('python-unknown');assert.equal(r.index.units![0].kind,'application');assert.equal(r.index.resources![0].engine,'未知关系库');
 const original=r.configs.get('pyproject.toml')!;r.configs.set('pyproject.toml','[project]\nname="sample-api"\ndependencies=["sqlalchemy>=2.0"]');discoverUnits(r);assert(!r.index.units!.some(u=>u.kind==='application'));r.configs.set('pyproject.toml',original);
 discoverUnits(r);const p=r.facts.get('app.py')!;p.calls=[];discoverUnits(r);assert(!r.index.units!.some(u=>u.kind==='application'));
});
test('UI dependency alone is insufficient; nested templates and workspace roots are tools',async()=>{
 const r=await scan('plain-java');r.configs=new Map([['package.json','{"workspaces":["*"]}'],['ui/package.json','{"dependencies":{"vue":"3"},"scripts":{"dev":"vite"}}'],['templates/package.json','{"dependencies":{"react":"19"},"scripts":{"dev":"template dev"}}']]);
 r.index.frontendFiles=[{path:'ui/index.html',hash:'',size:0,language:'html'}];discoverUnits(r);
 assert.deepEqual(r.index.units!.filter(u=>u.kind==='frontend').map(u=>u.root),['ui']);assert.equal(r.index.units!.find(u=>u.root==='templates')!.kind,'tool');assert.equal(r.index.units!.find(u=>u.language==='javascript'&&u.root==='')!.kind,'tool');
});
test('evidence and usage survive model JSON round trip, without inventing access edges',async()=>{
 const r=await scan('gradle');discoverResources(r);const model=JSON.parse(JSON.stringify(r.index));
 for(const item of [...model.units,...model.resources]){assert(item.basis.length);for(const b of item.basis){const source=await fs.readFile(path.join(fixtures,'gradle',b.location.file),'utf8');assert(b.location.range.start.line<source.split('\n').length);}}
 assert(model.resources.every((r:any)=>r.unitIds.every((id:string)=>model.units.some((u:any)=>u.id===id))));
});
