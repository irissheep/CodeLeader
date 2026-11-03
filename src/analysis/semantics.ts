import path from 'node:path';
import fs from 'node:fs';
import { spawn, ChildProcessWithoutNullStreams } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { contains, type ProjectIndex, type Range, type SymbolInfo, type Relation } from '../shared/model';
import type { StructureResult } from './structure';
import { managedPath } from '../../scripts/managed-path.mjs';
export const children = new Set<ChildProcessWithoutNullStreams>();
export let cancelled = false;
export function cancel() { cancelled=true; for(const child of children) child.kill(); }
function launch(exe:string,args:string[],cwd:string,data:string,onChild:(pid:number,active:boolean)=>void,extra:NodeJS.ProcessEnv={}) {
  for(const child of ['temp','logs','java-home','stubs'])managedPath(path.join(data,child));
  const child=spawn(exe,args,{cwd,windowsHide:true,shell:false,env:{...process.env,TEMP:path.join(data,'temp'),TMP:path.join(data,'temp'),TMPDIR:path.join(data,'temp'),PYTHONPYCACHEPREFIX:path.join(data,'temp/pycache'),...extra},stdio:['pipe','pipe','pipe']});
  children.add(child); if(child.pid)onChild(child.pid,true);
  fs.appendFileSync(path.join(data,'logs/processes.jsonl'),JSON.stringify({time:new Date().toISOString(),pid:child.pid,exe,args,cwd,temp:path.join(data,'temp'),event:'spawn'})+'\n');
  child.once('exit',()=>{children.delete(child);if(child.pid)onChild(child.pid,false);});
  child.once('error',()=>children.delete(child));
  child.stderr.on('data',buffer=>fs.appendFileSync(path.join(data,'logs/analyzers.log'),buffer));
  return child;
}
async function closeChild(child:ChildProcessWithoutNullStreams) {
  if(child.exitCode!==null||child.signalCode!==null)return;
  await new Promise<void>(resolve=>{
    const timer=setTimeout(resolve,1500);
    child.once('exit',()=>{clearTimeout(timer);resolve();});child.kill();
  });
}
function symbolAt(index:ProjectIndex,file:string,range:Range):SymbolInfo|undefined {
  return index.symbols.find(s=>s.file.toLowerCase()===file.toLowerCase()&&s.selection.start.line===range.start.line&&s.selection.start.character===range.start.character);
}
export async function javaSemantics(result:StructureResult,resources:string,data:string,onChild:(pid:number,active:boolean)=>void) {
  const {index}=result;
  const child=launch(path.join(resources,'jre/bin/java.exe'),[`-Djava.io.tmpdir=${path.join(data,'temp')}`,`-Duser.home=${path.join(data,'java-home')}`,'-Dfile.encoding=UTF-8','-jar',path.join(resources,'java/worker.jar')],data,data,onChild);
  const response:any = await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{child.kill();reject(new Error('Java 分析超时（120 秒）'));},120000);
    const lines=createInterface({input:child.stdout});
    lines.on('line',line=>{try{const message=JSON.parse(line);clearTimeout(timer);message.error?reject(new Error(message.error)):resolve(message.result);}catch(e){reject(e);}});
    child.once('error',e=>{clearTimeout(timer);reject(e);});
    child.once('exit',code=>{clearTimeout(timer);reject(new Error(`Java worker 提前退出 (${code})`));});
    child.stdin.end(JSON.stringify({id:1,root:index.root,files:index.files.filter(f=>f.language==='java').map(f=>f.path),sourceRoots:index.sourceRoots,jars:index.jars})+'\n');
  }).finally(()=>closeChild(child));
  const byQualified=new Map<string,SymbolInfo[]>();
  for(const item of response.symbols) {const s=symbolAt(index,item.file,item.range);if(s&&item.qualified){s.signature=item.qualified;byQualified.set(item.qualified,[...(byQualified.get(item.qualified)||[]),s]);}}
  for(const call of response.calls) {
    const start=call.range.start;
    const from=byQualified.get(call.from)?.find(s=>s.file===call.file&&contains(s.range,start))||index.symbols.filter(s=>s.language==='java'&&s.file===call.file&&['method','constructor'].includes(s.kind)&&contains(s.range,start)).sort((a,b)=>b.range.start.line-a.range.start.line)[0];
    if(!from) continue;
    const targets=byQualified.get(call.target)||[];
    for(const target of targets.length?targets:[undefined])index.relations.push({id:`java:${call.file}:${start.line}:${start.character}:${target?.id||'external'}`,from:from.id,to:target?.id,target:call.target||call.text,type:'CALLS',source:'JavaSymbolSolver',status:targets.length>1?'candidate':call.status,locations:[{file:call.file,range:call.range}],reason:targets.length>1?'多个源码模块包含相同限定签名，当前 classpath 无法确定唯一模块。':call.reason||(call.status==='candidate'?'找到了接口声明，还不能确定调用的是哪个实现。':!target?'项目里没找到这个方法的定义，可能来自自动生成的构造器或第三方库。':undefined)});
  }
  for(const item of response.inheritance) {
    const from=symbolAt(index,item.file,item.range);
    const targets=index.symbols.filter(s=>s.language==='java'&&['class','interface'].includes(s.kind)&&s.qualifiedName===item.target);
    if(from)for(const target of targets.length?targets:[undefined])index.relations.push({id:`inherit:${from.id}:${item.target}:${target?.id||'external'}`,from:from.id,to:item.status==='resolved'?target?.id:undefined,target:item.target,type:item.type,source:'JavaSymbolSolver',status:item.status==='resolved'&&targets.length>1?'candidate':item.status,locations:[{file:item.file,range:item.location}],reason:targets.length>1?'多个源码模块包含同限定名类型，无法确定唯一模块。':item.reason||(target?undefined:'外部类型，项目内没有源码。')});
  }
  for(const message of response.diagnostics)index.diagnostics.push({message,severity:'warning'});
}
class LSP {
  private id=0; private buffer=Buffer.alloc(0); private pending=new Map<number,{resolve:(v:any)=>void;reject:(e:Error)=>void;timer:NodeJS.Timeout}>();
  diagnostics=new Map<string,any[]>();
  constructor(private child:ChildProcessWithoutNullStreams,private config:unknown) {
    child.stdout.on('data',(chunk:Buffer)=>{
      this.buffer=Buffer.concat([this.buffer,chunk]);
      while(true) {
        const headerEnd=this.buffer.indexOf('\r\n\r\n');if(headerEnd<0)break;
        const size=Number(this.buffer.subarray(0,headerEnd).toString().match(/Content-Length:\s*(\d+)/i)?.[1]);
        if(!Number.isFinite(size)||size>64*1024*1024){this.fail(new Error('LSP 消息长度无效'));child.kill();return;}
        if(this.buffer.length<headerEnd+4+size)break;
        const message=JSON.parse(this.buffer.subarray(headerEnd+4,headerEnd+4+size).toString());this.buffer=this.buffer.subarray(headerEnd+4+size);
        if(message.method) {
          if(message.method==='textDocument/publishDiagnostics')this.diagnostics.set(message.params.uri,message.params.diagnostics);
          if(message.id!==undefined)this.send({jsonrpc:'2.0',id:message.id,result:message.method==='workspace/configuration'?message.params.items.map((i:any)=>i.section==='python'?this.config:i.section==='python.analysis'?(this.config as any).analysis:{}):null});
        } else {
          const pending=this.pending.get(message.id);if(pending){clearTimeout(pending.timer);this.pending.delete(message.id);message.error?pending.reject(new Error(message.error.message)):pending.resolve(message.result);}
        }
      }
    });
    child.once('error',e=>this.fail(e));child.once('exit',()=>this.fail(new Error(cancelled?'已取消':'Pyright 已退出')));
  }
  fail(e:Error){for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(e);}this.pending.clear();}
  send(message:unknown){if(!this.child.stdin.destroyed)this.child.stdin.write(this.encode(message));}
  encode(message:unknown){const text=JSON.stringify(message);return `Content-Length: ${Buffer.byteLength(text)}\r\n\r\n${text}`;}
  notify(method:string,params:unknown){this.send({jsonrpc:'2.0',method,params});}
  request(method:string,params:unknown):Promise<any> {
    if(cancelled)return Promise.reject(new Error('已取消'));
    const id=++this.id;
    return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);this.notify('$/cancelRequest',{id});reject(new Error(`Pyright 查询超时：${method}`));},45000);this.pending.set(id,{resolve,reject,timer});this.send({jsonrpc:'2.0',id,method,params});});
  }
}
export async function pythonSemantics(result:StructureResult,resources:string,data:string,nodeExe:string,onChild:(pid:number,active:boolean)=>void,progress:(phase:string,current:number,total:number)=>void) {
  const {index,calls,texts}=result;
  const server=path.join(resources,resources.endsWith('resources')?'../node_modules/pyright/dist/pyright-langserver.js':'pyright/pyright-langserver.js');
  const actual=fs.existsSync(path.join(resources,'pyright/pyright-langserver.js'))?path.join(resources,'pyright/pyright-langserver.js'):server;
  const child=launch(nodeExe,[actual,'--stdio'],data,data,onChild,{ELECTRON_RUN_AS_NODE:'1'});
  const config={pythonPath:path.join(data,'no-python-interpreter.exe'),analysis:{autoSearchPaths:false,extraPaths:[index.root],diagnosticMode:'openFilesOnly',useLibraryCodeForTypes:true,typeCheckingMode:'basic',stubPath:path.join(data,'stubs')}};
  const lsp=new LSP(child,config);
  try {
    await lsp.request('initialize',{processId:process.pid,rootUri:pathToFileURL(index.root).href,workspaceFolders:[{uri:pathToFileURL(index.root).href,name:index.name}],capabilities:{workspace:{configuration:true,workspaceFolders:true},textDocument:{callHierarchy:{dynamicRegistration:false},definition:{linkSupport:true}}}});
    lsp.notify('initialized',{});lsp.notify('workspace/didChangeConfiguration',{settings:{python:config}});
    for(const file of index.files.filter(f=>f.language==='python'))lsp.notify('textDocument/didOpen',{textDocument:{uri:pathToFileURL(path.join(index.root,file.path)).href,languageId:'python',version:1,text:texts.get(file.path)}});
    const pySymbols=index.symbols.filter(s=>s.language==='python'&&['function','method'].includes(s.kind));
    const seen=new Set<string>();
    for(const [i,symbol] of pySymbols.entries()) {
      if(cancelled)throw new Error('已取消');
      progress('Python 语义分析',i+1,pySymbols.length);
      const uri=pathToFileURL(path.join(index.root,symbol.file)).href;
      const items=await lsp.request('textDocument/prepareCallHierarchy',{textDocument:{uri},position:symbol.selection.start});
      for(const item of items||[]) {
        const outgoing=await lsp.request('callHierarchy/outgoingCalls',{item});
        for(const call of outgoing||[]) {
          let file:string;try{file=path.relative(index.root,fileURLToPath(call.to.uri)).replaceAll('\\','/');}catch{continue;}
          const target=symbolAt(index,file,call.to.selectionRange);
          for(const range of call.fromRanges) {
            const key=`${symbol.id}:${range.start.line}:${range.start.character}:${target?.id||call.to.name}`;
            if(seen.has(key))continue;seen.add(key);
            index.relations.push({id:`py:${key}`,from:symbol.id,to:target?.id,target:target?.qualifiedName||call.to.name,type:'CALLS',source:'Pyright',status:items.length>1?'candidate':'resolved',locations:[{file:symbol.file,range}],reason:items.length>1?'找到了多个定义，还不能确定调用的是哪一个。':!target?'外部符号，项目内无对应源码。':undefined});
          }
        }
        const incoming=await lsp.request('callHierarchy/incomingCalls',{item});
        for(const call of incoming||[]) {
          let file:string;try{file=path.relative(index.root,fileURLToPath(call.from.uri)).replaceAll('\\','/');}catch{continue;}
          const caller=symbolAt(index,file,call.from.selectionRange);if(!caller)continue;
          for(const range of call.fromRanges){const key=`${caller.id}:${range.start.line}:${range.start.character}:${symbol.id}`;if(seen.has(key))continue;seen.add(key);index.relations.push({id:`py:${key}`,from:caller.id,to:symbol.id,target:symbol.qualifiedName,type:'CALLS',source:'Pyright',status:items.length>1?'candidate':'resolved',locations:[{file,range}],reason:items.length>1?'调用层次返回多个声明。':undefined});}
        }
      }
    }
    // Query each unaccounted call's definition, rather than guessing by name.
    for(const site of calls.filter(c=>c.from.startsWith('python:'))) {
      if(index.relations.some(r=>r.type==='CALLS'&&r.from===site.from&&r.locations.some(l=>contains(site.range,l.range.start))))continue;
      const uri=pathToFileURL(path.join(index.root,site.file)).href;
      const position={...site.selection.end,character:Math.max(site.selection.start.character,site.selection.end.character-1)};
      const defs=await lsp.request('textDocument/definition',{textDocument:{uri},position});
      const targets:SymbolInfo[]=[];
      for(const def of Array.isArray(defs)?defs:defs?[defs]:[]) {
        const targetUri=def.targetUri||def.uri; const range=def.targetSelectionRange||def.range;
        if(!targetUri||!range)continue;
        try{const file=path.relative(index.root,fileURLToPath(targetUri)).replaceAll('\\','/');const target=symbolAt(index,file,range);if(target&&!targets.includes(target))targets.push(target);}catch{}
      }
      if(targets.length)for(const target of targets) index.relations.push({id:`pydef:${site.from}:${site.range.start.line}:${site.range.start.character}:${target.id}`,from:site.from,to:target.id,target:target.qualifiedName,type:'CALLS',source:'Pyright',status:'candidate',locations:[{file:site.file,range:site.range}],reason:'找到了可能的定义，前后调用还没确定。'});
      else index.relations.push({id:`pygap:${site.from}:${site.range.start.line}:${site.range.start.character}`,from:site.from,target:site.text,type:'CALLS',source:'Pyright',status:'unresolved',locations:[{file:site.file,range:site.range}],reason:'调用层次和定义未给出项目内目标；可能是动态调用、内置函数或缺失依赖。'});
    }
    for(const [uri,diagnostics] of lsp.diagnostics) for(const d of diagnostics.filter(d=>d.severity===1||d.code==='reportMissingImports'))index.diagnostics.push({file:path.relative(index.root,fileURLToPath(uri)).replaceAll('\\','/'),message:d.message,severity:'warning'});
    const grouped=new Map<string,Relation[]>();
    for(const relation of index.relations.filter(r=>r.source==='Pyright'&&r.to))for(const location of relation.locations){const key=`${relation.from}:${location.range.start.line}:${location.range.start.character}`;grouped.set(key,[...(grouped.get(key)||[]),relation]);}
    for(const group of grouped.values())if(new Set(group.map(r=>r.to)).size>1)for(const relation of group){relation.status='candidate';relation.reason='同一源码位置有多个静态目标，运行时分派未知。';}
    index.diagnostics.push({message:'Python 使用随包 typeshed 和项目源码；未启动 Python 解释器、未安装目标依赖。动态类型和外部环境可能造成分析缺口。',severity:'info'});
    await lsp.request('shutdown',null);lsp.notify('exit',null);
  } finally {await closeChild(child);}
}
