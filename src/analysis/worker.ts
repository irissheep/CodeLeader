import { parentPort, workerData } from 'node:worker_threads';
import { structure } from './structure';
import { javaSemantics, pythonSemantics, cancel, cancelled } from './semantics';
import { frameworks } from './frameworks';
import { projectRules } from './project-rules';
const send=(type:string,value:unknown)=>parentPort!.postMessage({type,value});
parentPort!.on('message',message=>{if(message==='cancel')cancel();});
async function main() {
  const {root,resources,data,nodeExe,options}=workerData;
  const progress=(phase:string,current:number,total:number)=>send('progress',{phase,current,total});
  const result=await structure(root,resources,progress,options.projectRoots,options.sharedConfigs,index=>send('index',structuredClone(index)));
  result.index.diagnostics.push(...options.warnings||[]);
  result.index.sourceRoots=[...new Set([...result.index.sourceRoots,...options.sourceRoots])];
  result.index.jars=[...new Set([...result.index.jars,...options.jars])];
  progress('正在整理项目关系',0,0);try{frameworks(result);}catch{result.index.diagnostics.push({message:'入口识别未完成，已保留源码结构。',severity:'warning'});}
  try{projectRules(result,options.configuration);}catch{result.index.diagnostics.push({message:'关系补充未完成，已保留源码结构。',severity:'warning'});}
  send('index',structuredClone(result.index));
  result.index.status='analyzing';send('index',structuredClone(result.index));
  const child=(pid:number,active:boolean)=>send('child',{pid,active});
  for(const language of result.index.languages) {
    if(cancelled)break;
    try{if(language==='java')await javaSemantics(result,resources,data,child);else await pythonSemantics(result,resources,data,nodeExe,child,progress);}
    catch(error){result.index.diagnostics.push({message:`${language} 语义分析失败：${error}`,severity:'error'});}
  }
  if(!cancelled)try{projectRules(result,options.configuration);}catch{result.index.diagnostics.push({message:'关系补充未完成，已保留源码结构。',severity:'warning'});}
  result.index.status=cancelled?'cancelled':result.index.diagnostics.some(d=>d.severity!=='info')||result.index.relations.some(r=>r.status==='unresolved')?'partial':'complete';
  send('index',result.index);send('done',null);parentPort!.close();
}
main().catch(error=>{send('error',String(error));parentPort!.close();});
