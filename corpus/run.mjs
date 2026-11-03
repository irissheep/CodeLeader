import fs from 'node:fs/promises';
import path from 'node:path';
import {Worker} from 'node:worker_threads';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {repository,corpusRoot,records,prepare,command,assertClean} from './acquire.mjs';
import {sha} from './reference.mjs';
import {verifyLinkExpected} from './verify-link-expected.mjs';
const output=path.join(repository,'.tmp/verification-generalization-baseline');
for(const [key,value] of Object.entries({TEMP:path.join(repository,'.tmp'),TMP:path.join(repository,'.tmp'),TMPDIR:path.join(repository,'.tmp'),npm_config_cache:path.join(repository,'.cache/npm'),CODELEADER_ROOT:repository,PYTHONPYCACHEPREFIX:path.join(repository,'.cache/python')}))process.env[key]=value;
await fs.mkdir(output,{recursive:true});
const sourceFiles=[];async function collect(folder){for(const e of await fs.readdir(folder,{withFileTypes:true})){const file=path.join(folder,e.name);if(e.isDirectory())await collect(file);else sourceFiles.push(file);}}await collect(path.join(repository,'src'));
const before=Object.fromEntries(await Promise.all(sourceFiles.map(async f=>[path.relative(repository,f),sha(await fs.readFile(f))])));
const manifest=await prepare(),lock=JSON.parse(await fs.readFile(path.join(records,'expected.lock.json'),'utf8'));
await fs.writeFile(path.join(output,'active-manifest.json'),JSON.stringify(manifest,null,2));
const baselineBytes=await fs.readFile(path.join(records,'baseline-subset.json'));
const baseline=JSON.parse(baselineBytes),baselineLock=JSON.parse(await fs.readFile(path.join(records,'baseline-subset.lock.json'),'utf8'));
if(sha(baselineBytes)!==baselineLock.subsetSha256||baseline.sourceBaselineSha256!==baselineLock.sourceBaselineSha256||baseline.sourceExpectedLockSha256!==baselineLock.sourceExpectedLockSha256)throw Error('Public baseline subset differs from its recorded lock');
for(const [file,hash] of [['corpus/baseline.json',baselineLock.sourceBaselineSha256],['corpus/expected.lock.json',baselineLock.sourceExpectedLockSha256]]){
 const original=await fs.readFile(path.join(repository,file)).catch(error=>{if(error.code==='ENOENT')return undefined;throw error;});
 if(original&&sha(original)!==hash)throw Error(`Original baseline or reference lock changed: ${file}`);
}
if(baseline.publicExpectedLockSha256!==sha(await fs.readFile(path.join(records,'expected.lock.json')))||baseline.publicLinkLockSha256!==sha(await fs.readFile(path.join(records,'expected-links/expected.lock.json'))))throw Error('Public expected lock differs from reviewed baseline subset');
if(!manifest.projects.length){
 await fs.writeFile(path.join(output,'scorecard.json'),JSON.stringify({schema:1,projects:[],note:'未评估：没有可用的公开语料；已跳过（未找到私有语料）'},null,2));
 console.log('未评估：没有可用的公开语料；已跳过（未找到私有语料）。');process.exit(0);
}
await verifyLinkExpected(manifest);
const expected={};for(const project of manifest.projects){const file=`expected/${project.id}/expected.json`,bytes=await fs.readFile(path.join(records,file));if(sha(bytes)!==lock.files[file])throw Error(`${project.id}: reviewed expected.json changed; refusing silently changed answers`);expected[project.id]=JSON.parse(bytes);if(expected[project.id].commit!==project.commit)throw Error('Reference commit mismatch');
 const items=new Map();function visit(value){if(!value||typeof value!=='object')return;if(Array.isArray(value))for(const item of value)visit(item);else{if(value.file&&value.sha256)items.set(value.file,value.sha256);for(const item of Object.values(value))visit(item);}}visit(expected[project.id]);for(const [file,hash] of items)if(sha(await fs.readFile(path.join(corpusRoot,project.id,file)))!==hash)throw Error(`${project.id}: evidence ${file} changed`);
}
await build({entryPoints:['src/analysis/worker.ts'],outfile:path.join(output,'analysis-worker.cjs'),bundle:true,platform:'node',format:'cjs',external:['web-tree-sitter']});
await build({entryPoints:['corpus/measure.ts'],outfile:path.join(output,'measure.mjs'),bundle:true,platform:'node',format:'esm'});
await build({entryPoints:['src/renderer/layout.worker.ts'],outfile:path.join(output,'layout-worker.cjs'),bundle:true,platform:'node',format:'cjs',plugins:[{name:'corpus-elk-transport',setup(b){b.onResolve({filter:/^elkjs\/lib\/elk-api\.js$/},()=>({path:'elk-transport',namespace:'corpus'}));b.onLoad({filter:/.*/,namespace:'corpus'},()=>({contents:"import ELK from 'elkjs/lib/elk.bundled.js'; export default function(_options){const saved=globalThis.self;delete globalThis.self;try{return new ELK();}finally{globalThis.self=saved;}}",resolveDir:repository}));b.onResolve({filter:/\?url$/},()=>({path:'url',namespace:'corpus-url'}));b.onLoad({filter:/.*/,namespace:'corpus-url'},()=>({contents:"export default '';"}));}}]});
const results=[];
for(const project of manifest.projects){
 const folder=path.join(output,project.id);await fs.mkdir(folder,{recursive:true});const data=path.join(folder,'analysis-data');for(const f of ['temp','logs','java-home','stubs'])await fs.mkdir(path.join(data,f),{recursive:true});
 console.log(`ANALYZE ${project.id} ${project.commit}`);const started=Date.now();let final,stage,error;const phases=[];
 await new Promise(resolve=>{const worker=new Worker(path.join(output,'analysis-worker.cjs'),{workerData:{root:path.join(corpusRoot,project.id),resources:path.join(repository,'resources'),data,nodeExe:process.execPath,options:{sourceRoots:[],jars:[]}}});worker.on('message',message=>{if(message.type==='index'){if(!stage)stage=message.value;final=message.value;}else if(message.type==='progress'){if(phases.at(-1)?.phase!==message.value.phase)phases.push(message.value);}else if(message.type==='error')error=message.value;});worker.on('error',e=>{error=String(e);resolve();});worker.on('exit',()=>resolve());});
 if(final){await fs.writeFile(path.join(folder,'structure-model.json'),JSON.stringify(stage,null,2));await fs.writeFile(path.join(folder,'model.json'),JSON.stringify(final,null,2));await command(process.execPath,[path.join(output,'measure.mjs'),path.join(folder,'model.json'),path.join(folder,'graphs.json'),pathToFileURL(path.join(output,'layout-worker.cjs')).href]);}
 const graphs=final?JSON.parse(await fs.readFile(path.join(folder,'graphs.json'),'utf8')):null;
 const row={id:project.id,commit:project.commit,elapsedMs:Date.now()-started,phases,error,index:final?{files:final.files.length,parsed:final.files.filter(f=>f.parsed).length,frontendFiles:final.frontendFiles?.length||0,symbols:final.symbols.length,relations:final.relations.length,status:final.status,diagnostics:final.diagnostics.length}:null};results.push(row);await fs.writeFile(path.join(output,'runs.json'),JSON.stringify(results,null,2));console.log('DONE',project.id,row.index,row.elapsedMs);
 await assertClean(path.join(corpusRoot,project.id),project);
}
const changed=[];for(const [file,hash] of Object.entries(before))if(sha(await fs.readFile(path.join(repository,file)))!==hash)changed.push(file);
await fs.writeFile(path.join(output,'source-integrity.json'),JSON.stringify({files:sourceFiles.length,changed,hashes:before},null,2));if(changed.length)throw Error('Production source changed during baseline');
await import('./check-ui.mjs');
await import('./public/report-v1.mjs');
await import('./r1-scorecard.mjs');
await import('./r2-scorecard.mjs');
await import('./r4-scorecard.mjs');
await import('./r5-scorecard.mjs');
await import('./r6-scorecard.mjs');
await import('./r8-scorecard.mjs');
let workspace;
if(manifest.projects.length>=3){
 const started=Date.now(),file=path.join(repository,'.tmp/verification-f1-discovery/WORKSPACE-I.json');
 try{await command(process.execPath,[path.join(repository,'scripts/check-workspace.mjs'),'--corpus'],repository,{CODELEADER_CORPUS_ACTIVE_MANIFEST:path.join(output,'active-manifest.json')});}catch(error){console.error('目录发现检查未完成：',String(error));}
 const info=await fs.stat(file).catch(()=>undefined);if(info&&info.mtimeMs>=started-1000)workspace=JSON.parse(await fs.readFile(file,'utf8'));
}
await (await import('./public/scorecard.mjs')).writeScorecard(undefined,undefined,workspace);
console.log('私有语料默认未启用。');
