import fs from 'node:fs/promises';
import path from 'node:path';
import {Worker} from 'node:worker_threads';
import {guard,root} from './common.mjs';
import {managedPath} from './managed-path.mjs';

guard();
const project=process.argv.find(value=>value.startsWith('--project='))?.slice(10);
if(!project)throw Error('请用 --project=指定要只读分析的项目目录');
const discoveryFile=process.argv.find(value=>value.startsWith('--discovery='))?.slice(12),discovery=discoveryFile?JSON.parse(await fs.readFile(discoveryFile,'utf8')):undefined;
if(discovery&&path.resolve(discovery.root).toLowerCase()!==path.resolve(project).toLowerCase())throw Error('发现结果不属于所选项目');
const workerFile=managedPath(path.resolve(process.argv.find(value=>value.startsWith('--worker-file='))?.slice(14)||path.join(root,'dist/worker.cjs')));
const label=process.argv.find(value=>value.startsWith('--label='))?.slice(8)||'worker-profile';if(!/^[a-z0-9_-]+$/i.test(label))throw Error('测量名称无效');
const folder=managedPath(path.join(root,'.tmp/verification-p1-resources',label));
for(const name of ['temp','logs','java-home','stubs'])await fs.mkdir(path.join(folder,name),{recursive:true});
const phases=[],start=Date.now(),cpuStart=process.cpuUsage();let status,error,terminal;
await new Promise(resolve=>{
 const worker=new Worker(workerFile,{workerData:{root:project,resources:path.join(root,'resources'),data:folder,nodeExe:process.execPath,options:{sourceRoots:[],jars:[],...(discovery?{projectRoots:discovery.projects.filter(item=>item.selected).map(item=>item.root),sharedConfigs:discovery.sharedConfigs}: {})}}});
 worker.on('message',message=>{if(message.type==='progress'&&phases.at(-1)?.phase!==message.value.phase)phases.push({time:Date.now(),...message.value});if(message.type==='index'){status=message.value.status;if(!['structure','analyzing'].includes(status))terminal=message.value;}if(message.type==='error')error=String(message.value);});
 worker.once('error',reason=>{error=String(reason);resolve();});worker.once('exit',resolve);
});
const cpu=process.cpuUsage(cpuStart);
await fs.writeFile(path.join(folder,'worker-run.json'),JSON.stringify({project,start,end:Date.now(),phases,status,error,processCpuSeconds:(cpu.user+cpu.system)/1e6,note:'本进程包含分析工作线程；不包含 Java/Pyright 子进程 CPU'},null,2));
if(process.argv.includes('--save-index')&&terminal)await fs.writeFile(path.join(folder,'terminal-model.json'),JSON.stringify(terminal));
if(error)process.exitCode=1;
