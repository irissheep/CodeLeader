import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {Worker} from 'node:worker_threads';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {guard,root} from './common.mjs';

guard();
const report=path.join(root,'.tmp/verification-f1-discovery'),base=await fs.realpath(path.join(root,'.tmp')),temp=await fs.mkdtemp(path.join(base,'f1-workspace-')),require=createRequire(import.meta.url);
const policy=JSON.parse(await fs.readFile(path.join(root,'resources/workspace-discovery-policy.json'),'utf8')),ignored=new Set(policy.ignoredDirectories.map(item=>item.name.toLowerCase()));
const manifestFile=process.env.CODELEADER_CORPUS_ACTIVE_MANIFEST||path.join(root,'corpus/public/manifest.json');
const manifest=JSON.parse(await fs.readFile(manifestFile,'utf8')),corpus=process.env.CODELEADER_CORPUS||path.join(root,'.cache','corpus'),fixtureOnly=process.argv.includes('--fixtures-only'),corpusMode=process.argv.includes('--corpus'),results={fixtures:[],trials:[],errors:[],cleaned:false,scoreHash:'未评估：尚未将完整 A–H 评分器应用于工作区中每个项目'};
await fs.mkdir(report,{recursive:true});
const write=async(file,text)=>{await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,text);};
const verify=(name,ok,details)=>{results.fixtures.push({name,ok,details});console.log(JSON.stringify({name,ok,details}));};
const cleanup=async()=>{const actual=await fs.realpath(temp).catch(()=>undefined);if(!actual)return;const relative=path.relative(base,actual);if(!relative||relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative)||!path.basename(actual).startsWith('f1-workspace-'))throw Error('临时目录路径校验失败');await fs.rm(actual,{recursive:true,force:true,maxRetries:3,retryDelay:100});results.cleaned=!(await fs.stat(actual).catch(()=>undefined));};
let discover;
try{
 const scanner=path.join(temp,'scanner.cjs'),workerFile=path.join(temp,'worker.cjs');
 await build({entryPoints:[path.join(root,'src/main/workspace-discovery.ts')],outfile:scanner,bundle:true,platform:'node',format:'cjs',logLevel:'silent'});
 await build({entryPoints:[path.join(root,'src/analysis/worker.ts')],outfile:workerFile,bundle:true,platform:'node',format:'cjs',external:['web-tree-sitter'],logLevel:'silent'});
 ({discoverWorkspace:discover}=require(scanner));
 const fixture=path.join(temp,'fixture');await write(path.join(fixture,'README.md'),'workspace');
 const shapes=[['srv_x','pom.xml','<project><artifactId>sample-service</artifactId></project>','src/App.java','@RestController class App {}'],['ui_x','package.json',JSON.stringify({name:'sample-ui',dependencies:{vue:'1'},scripts:{dev:'dev'}}),'src/main.js',"import {createApp} from 'vue'"],['py_x','requirements.txt','fastapi','main.py','from fastapi import FastAPI\napp=FastAPI()']];
 for(const [dir,marker,content,file,source] of shapes){await write(path.join(fixture,dir,marker),content);await write(path.join(fixture,dir,file),source);}
 await fs.cp(path.join(fixture,shapes[0][0]),path.join(fixture,'copy_x'),{recursive:true});
 for(const dir of ['.git','node_modules','isolated-env']){await fs.mkdir(path.join(fixture,dir),{recursive:true});if(dir==='isolated-env')await write(path.join(fixture,dir,'pyvenv.cfg'),'home = ignored');for(let i=0;i<500;i++)await write(path.join(fixture,dir,`f${i}.js`),'ignored');}
 let early=false;const observed=await discover(fixture,1,new AbortController().signal,scan=>{if(scan.state==='scanning'&&scan.projects.length)early=true;});
 const duplicate=observed.projects.find(p=>p.duplicateOf),counts=Object.fromEntries(observed.skipped.map(item=>[item.rule,item.count]));
 verify('内容识别、疑似副本与提前显示',observed.projects.length===4&&!!duplicate&&!duplicate.selected&&early,{projects:observed.projects.map(p=>({root:p.root,type:p.type,duplicate:!!p.duplicateOf})),early});
 verify('依赖和虚拟环境进入前跳过',counts['.git']===1&&counts.node_modules===1&&counts['pyvenv.cfg']===1&&observed.files<100,{counts,files:observed.files});
 const aborted=new AbortController();aborted.abort();const cancelled=await discover(fixture,2,aborted.signal,()=>{});verify('取消达到终态',cancelled.state==='cancelled',{state:cancelled.state});
 const limited=await discover(fixture,3,new AbortController().signal,()=>{},{files:3});verify('达到上限有说明',!!limited.limit&&['found','empty'].includes(limited.state),{state:limited.state,limit:limited.limit});
 if(!fixtureOnly){
  const directDir=path.join(root,'.tmp/verification-generalization-baseline'),data=path.join(temp,'analysis-data');for(const item of ['temp','logs','java-home','stubs'])await fs.mkdir(path.join(data,item),{recursive:true});
  const worker=async(workspace,projectRoots,sharedConfigs)=>{let final,error,children=new Set();const start=Date.now(),w=new Worker(workerFile,{workerData:{root:workspace,resources:path.join(root,'resources'),data,nodeExe:process.execPath,options:{sourceRoots:[],jars:[],projectRoots,sharedConfigs}}});w.on('message',message=>{if(message.type==='index'&&!['structure','analyzing'].includes(message.value.status))final=message.value;if(message.type==='error')error=String(message.value);if(message.type==='child'){if(message.value.active)children.add(message.value.pid);else children.delete(message.value.pid);}});const timer=setTimeout(()=>{error='分析超过时间上限';void w.terminate();},policy.limits.analysisMilliseconds.value);await new Promise(resolve=>{w.on('error',e=>{error=String(e);resolve();});w.on('exit',resolve);});clearTimeout(timer);for(const pid of children)try{process.kill(pid);}catch{}return{index:final,error,elapsedMs:Date.now()-start};};
  const scoped=(model,prefix)=>{const pathIn=file=>!prefix||file===prefix||file?.startsWith(prefix+'/'),strip=file=>prefix&&file?.startsWith(prefix+'/')?file.slice(prefix.length+1):file;const entries=(model.entries||[]).filter(e=>e.kind==='http'&&pathIn(e.location?.file)),modules=(model.entities||[]).filter(m=>m.kind==='domain'&&pathIn(m.location?.file)),calls=(model.frontendLinks?.calls||[]).filter(c=>pathIn(c.source?.file));const facts={entries:entries.map(e=>[e.name,strip(e.location?.file)]).sort(),modules:modules.map(m=>[m.name,strip(m.location?.file)]).sort(),calls:calls.map(c=>[c.method,c.outcome,strip(c.source?.file)]).sort()};return{entryCount:entries.length,moduleCount:modules.length,matchedCalls:calls.filter(c=>c.outcome==='matched').length,factsHash:crypto.createHash('sha256').update(JSON.stringify(facts)).digest('hex')};};
  for(let i=0;i<manifest.projects.length;i++)for(const depth of (corpusMode?[1]:[1,2,3])){
   const target=manifest.projects[i],companions=manifest.projects.filter(p=>p.id!==target.id).sort((a,b)=>a.id.localeCompare(b.id)).slice(0,2),workspace=path.join(temp,`case-${i}-${depth}`);await write(path.join(workspace,'README.md'),'workspace');const chosen=[target,...companions],prefixes=[];
   for(let j=0;j<chosen.length;j++){const prefix=[...Array(depth-1).fill(`level_${i}_${j}`),`unit_${crypto.createHash('sha256').update(chosen[j].id+depth).digest('hex').slice(0,10)}`].join('/'),destination=path.join(workspace,prefix);prefixes.push(prefix);await fs.mkdir(path.dirname(destination),{recursive:true});await fs.cp(path.join(corpus,chosen[j].id),destination,{recursive:true,filter:async file=>{const stat=await fs.lstat(file);if(stat.isSymbolicLink())return false;if(stat.isDirectory()&&(ignored.has(path.basename(file).toLowerCase())||await fs.stat(path.join(file,'pyvenv.cfg')).then(()=>true,()=>false)))return false;return true;}});}
   const scan=await discover(workspace,i*10+depth,new AbortController().signal,()=>{}),found=prefixes.map(prefix=>scan.projects.some(project=>project.root===prefix||project.root.startsWith(prefix+'/'))),analysis=found.every(Boolean)?await worker(workspace,scan.projects.filter(p=>p.selected).map(p=>p.root),scan.sharedConfigs):{error:'有项目未被发现'};
   let before,after;if(analysis.index){const direct=JSON.parse(await fs.readFile(path.join(directDir,target.id,'model.json'),'utf8'));before=scoped(direct,'');after=scoped(analysis.index,prefixes[0]);}
   const ok=found.every(Boolean)&&!!before&&!!after&&JSON.stringify(before)===JSON.stringify(after);const row={project:target.id,depth,found,before,after,ok,error:analysis.error,elapsedMs:analysis.elapsedMs,scoreHash:results.scoreHash};results.trials.push(row);console.log(JSON.stringify(row));await fs.writeFile(path.join(report,'WORKSPACE-CHECK.partial.json'),JSON.stringify(results,null,2));const actual=await fs.realpath(workspace),relative=path.relative(await fs.realpath(temp),actual);if(!relative||relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw Error('测试工作区路径校验失败');await fs.rm(actual,{recursive:true,force:true,maxRetries:3,retryDelay:100});
  }
 }
}catch(error){results.errors.push(String(error));}finally{await cleanup();await fs.writeFile(path.join(report,corpusMode?'WORKSPACE-I.json':'WORKSPACE-CHECK.json'),JSON.stringify(results,null,2));}
if(results.errors.length||results.fixtures.some(item=>!item.ok)||results.trials.some(item=>!item.ok))process.exitCode=1;
