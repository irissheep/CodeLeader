import uiTokens from '../shared/ui-tokens';
import {collectAnalysisNotes} from './analysis-notes';
import {analysisNotesKey,webNotesText} from '../shared/analysis-notes';
import { app, BrowserWindow, ipcMain, dialog, session, shell, clipboard } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import crypto from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { configurePaths, inside } from './paths';
import { managedPath } from '../../scripts/managed-path.mjs';
import { redact } from '../shared/redact';
import type { ProjectIndex, ViewState } from '../shared/model';
import { ExecutionManager } from './execution-manager';
import {validScope,type ExecutionScope} from '../shared/project-scope';
import { editorURL } from '../shared/source-editor';
import {discoverWorkspace} from './workspace-discovery';
import workspacePolicy from '../../resources/workspace-discovery-policy.json';
let paths:ReturnType<typeof configurePaths>;
try {paths=configurePaths(app);}catch(error){dialog.showErrorBox('CodeLeader 无法启动',`${error}\n请将应用放在可写的 D 盘目录中。`);app.exit(1);throw error;}
let window:BrowserWindow|null=null, worker:Worker|undefined, index:ProjectIndex|undefined;
const execution=new ExecutionManager(paths.base,paths.data,()=>window!,value=>{if(value.projectId===index?.id)emit('execution:update',{...value,contextId:index.contextId});},operation=>{const record=execution.current;if(record&&record.projectId===index?.id)emit('execution:operation',{projectId:record.projectId,contextId:index.contextId,sessionId:record.id,operation});});
function handle(channel:string,listener:(event:Electron.IpcMainInvokeEvent,...args:any[])=>unknown){ipcMain.handle(channel,(event,...args)=>{if(event.sender!==window?.webContents||event.senderFrame!==window.webContents.mainFrame)throw Error('IPC 来源未授权');return listener(event,...args);});}
let projectGeneration=0,indexGeneration=0,activation=Promise.resolve(),runtimeJob:Promise<unknown>|undefined;
let discoveryController:AbortController|undefined,discoveryEpoch=0;
let projectContext=crypto.randomUUID(),contextProject='';
let pendingProject:{root:string;generation:number}|undefined;
const childPids=new Set<number>();
const workerChildren=new WeakMap<Worker,Set<number>>();
const log=(message:string)=>fsSync.appendFileSync(path.join(paths.data,'logs/app.log'),`${new Date().toISOString()} ${message}\n`);
function emit(type:string,value:unknown){if(window&&!window.isDestroyed())window.webContents.send(type,value);}
async function atomic(file:string,value:unknown) {
  managedPath(file);managedPath(file+'.tmp');
  const temporary=file+'.tmp';await fs.writeFile(temporary,JSON.stringify(value),'utf8');await fs.rename(temporary,file);
}
let persistence=Promise.resolve();
function persist(file:string,value:unknown) {const generation=projectGeneration;persistence=persistence.then(()=>atomic(file,value)).catch(e=>{log(`快照写入失败 ${e}`);if(generation===projectGeneration)emit('error',`无法保存本地快照：${e}`);});return persistence;}
async function stop() {
  const current=worker;if(!current)return;
  const owned=workerChildren.get(current)||new Set<number>();
  current.postMessage('cancel');
  await Promise.race([new Promise(resolve=>current.once('exit',resolve)),new Promise(resolve=>setTimeout(resolve,1500))]);
  for(const pid of owned){try{process.kill(pid);}catch{}childPids.delete(pid);}owned.clear();
  await current.terminate();if(worker===current)worker=undefined;
}
async function analyze(root:string,options:{sourceRoots:string[];jars:string[];configuration?:string;projectRoots?:string[];sharedConfigs?:string[]}={sourceRoots:[],jars:[]}) {
  if(runtimeJob||execution.current&&['connecting','recording'].includes(execution.current.state))throw Error('请先停止运行录制，再切换或刷新项目');
  if(typeof root!=='string'||root.length>32767)throw new Error('项目路径无效');
  const generation=++projectGeneration;
  pendingProject={root:path.resolve(root),generation};
  let canonical:string;
  try{canonical=await fs.realpath(root);if(!(await fs.stat(canonical)).isDirectory())throw Error('请选择本地项目目录');}
  catch(error){if(generation!==projectGeneration)return;await stop();if(generation!==projectGeneration)return;const requested=path.resolve(root),id=crypto.createHash('sha256').update(requested.toLowerCase()).digest('hex').slice(0,20);activation=activation.catch(()=>{}).then(async()=>{if(generation===projectGeneration)await execution.activateProject({id,root:requested});});await activation;if(generation!==projectGeneration)return;if(contextProject!==id){contextProject=id;projectContext=crypto.randomUUID();}indexGeneration=generation;index={contextId:projectContext,schema:2,id,root:requested,name:path.basename(requested),createdAt:new Date().toISOString(),status:'failed',languages:[],symbols:[],files:[],relations:[],diagnostics:[{message:'这个目录暂时无法读取，请检查路径。',severity:'error'}],versions:{rules:'cross-project/3'},sourceRoots:[],jars:[]};emit('index',index);throw error;}
  if(!options||!Array.isArray(options.sourceRoots)||!Array.isArray(options.jars))throw new Error('Java 路径参数无效');
  const missing:ProjectIndex['diagnostics']=[],sourceRoots:string[]=[],jars:string[]=[];
  for(const p of options.sourceRoots)try{if(typeof p!=='string'||!(await fs.stat(p)).isDirectory())throw Error();sourceRoots.push(p);}catch{missing.push({message:'一个附加源码目录不可用，仍会读取项目内源码。',severity:'warning'});}
  for(const p of options.jars)try{if(typeof p!=='string'||!p.toLowerCase().endsWith('.jar')||!(await fs.stat(p)).isFile())throw Error();jars.push(p);}catch{missing.push({message:'一个附加依赖文件不可用，仍会保留文件和入口。',severity:'warning'});}
  const projectRoots:string[]=[];if(options.projectRoots!==undefined){if(!Array.isArray(options.projectRoots)||!options.projectRoots.length)throw Error('请选择至少一个项目');for(const candidate of options.projectRoots){if(typeof candidate!=='string'||path.isAbsolute(candidate))throw Error('项目范围无效');const real=await fs.realpath(path.resolve(canonical,candidate));const relative=path.relative(canonical,real);if(relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative)||!(await fs.stat(real)).isDirectory())throw Error('项目范围超出所选目录');projectRoots.push(relative.replaceAll('\\','/'));}}
  const sharedConfigs:string[]=[];for(const candidate of options.sharedConfigs||[]){if(typeof candidate!=='string'||path.isAbsolute(candidate)||!(/^(?:docker-)?compose[^/\\]*\.ya?ml$/i.test(path.basename(candidate))||!candidate.includes('/')&&!candidate.includes('\\')&&/^\.env[^/\\]*$/.test(candidate)))continue;try{const real=await fs.realpath(path.resolve(canonical,candidate)),relative=path.relative(canonical,real);if(relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative)&&(await fs.stat(real)).isFile())sharedConfigs.push(relative.replaceAll('\\','/'));}catch{}}
  options={...options,sourceRoots,jars,...(options.projectRoots?{projectRoots}:{}),sharedConfigs};
  if(generation!==projectGeneration)return;
  await stop();if(generation!==projectGeneration)return;
  const id=crypto.createHash('sha256').update(canonical.toLowerCase()).digest('hex').slice(0,20);
  activation=activation.catch(()=>{}).then(async()=>{if(generation===projectGeneration)await execution.activateProject({id,root:canonical});});await activation;if(generation!==projectGeneration)return;
  if(contextProject!==id){contextProject=id;projectContext=crypto.randomUUID();}indexGeneration=generation;index={contextId:projectContext,schema:2,id,root:canonical,name:path.basename(canonical),createdAt:new Date().toISOString(),status:'structure',languages:[],symbols:[],files:[],relations:[],diagnostics:[],versions:{rules:'cross-project/3'},sourceRoots:[],jars:[]};emit('index',index);
  const current=worker=new Worker(path.join(__dirname,'worker.cjs'),{workerData:{root:canonical,resources:paths.resources,data:paths.data,nodeExe:process.execPath,options:{...options,warnings:missing}}});
  const ownedChildren=new Set<number>();workerChildren.set(current,ownedChildren);
  let finished=false;const timer=setTimeout(()=>{if(worker!==current||generation!==projectGeneration||finished)return;finished=true;if(index){index.status=index.files.length||index.frontendFiles?.length?'partial':'failed';index.diagnostics.push({message:'分析超过时间上限，已保留读出的内容；可选择更小范围重试。',severity:'warning'});emit('index',index);}for(const pid of ownedChildren){try{process.kill(pid);}catch{}childPids.delete(pid);}ownedChildren.clear();void current.terminate();},workspacePolicy.limits.analysisMilliseconds.value);
  if(pendingProject?.generation===generation)pendingProject=undefined;
  current.on('message',message=>{
    if(message.type==='child'){if(message.value.active){ownedChildren.add(message.value.pid);childPids.add(message.value.pid);}else{ownedChildren.delete(message.value.pid);childPids.delete(message.value.pid);}return;}
    if(worker!==current||generation!==projectGeneration||finished)return;
    if(message.type==='index') {index={...message.value,contextId:projectContext};emit('index',index);if(!['structure','analyzing'].includes(index!.status)){finished=true;clearTimeout(timer);execution.reconcileIndex(index!);void persist(path.join(paths.data,'indexes',index!.id+'.json'),index);}}
    if(message.type==='progress')emit('progress',message.value);
    if(message.type==='error'){finished=true;clearTimeout(timer);log(message.value);if(index){index.status=index.files.length||index.frontendFiles?.length?'partial':'failed';index.diagnostics.push({message:'分析中断，已保留当前结果。',severity:'error'});emit('index',index);}emit('error',message.value);}
  });
  current.on('error',error=>{if(worker!==current||generation!==projectGeneration||finished)return;finished=true;clearTimeout(timer);log(String(error));if(index){index.status=index.files.length||index.frontendFiles?.length?'partial':'failed';index.diagnostics.push({message:'分析中断，已保留当前结果。',severity:'error'});emit('index',index);}emit('error',String(error));});
  current.once('exit',()=>{clearTimeout(timer);for(const pid of ownedChildren){try{process.kill(pid);}catch{}childPids.delete(pid);}ownedChildren.clear();if(worker===current){worker=undefined;if(generation===projectGeneration&&!finished&&index){index.status=index.files.length||index.frontendFiles?.length?'partial':'failed';index.diagnostics.push({message:'分析提前结束，已保留读出的内容。',severity:'warning'});emit('index',index);}}});
}
function currentIndex(id:string){if(!index||index.id!==id||indexGeneration!==projectGeneration)throw Error('项目已切换，请重新选择');return index;}
function stillCurrent(project:ProjectIndex){if(index?.id!==project.id||index.createdAt!==project.createdAt||indexGeneration!==projectGeneration)throw Error('项目已切换，请重新选择');}
async function source(file:string,projectId=index?.id||'') {
  const index=currentIndex(projectId);
  if(!index||typeof file!=='string'||![...index.files,...index.frontendFiles||[],...index.inputs||[]].some(f=>f.path===file))throw new Error('这份项目分析里没有这个文件');
  const absolute=await fs.realpath(path.resolve(index.root,file));if(!inside(index.root,absolute))throw new Error('文件越出项目目录');
  const text=await fs.readFile(absolute,'utf8');const stale=crypto.createHash('sha256').update(text).digest('hex')!==[...index.files,...index.frontendFiles||[],...index.inputs||[]].find(f=>f.path===file)!.hash;
  stillCurrent(index);if(stale)index.stale=true;return {file,text:index.inputs?.some(f=>f.path===file)?redact(text):text,stale};
}
handle('project:choose',async()=>{const r=await dialog.showOpenDialog(window!,{title:'选择 Java / Python 项目',properties:['openDirectory']});return r.canceled?undefined:r.filePaths[0];});
handle('project:choose-source',async()=>{const r=await dialog.showOpenDialog(window!,{title:'选择源码文件',properties:['openFile'],filters:[{name:'源码',extensions:['java','py','ts','tsx','js','jsx','vue','html']}]});return r.canceled||!r.filePaths[0]?undefined:path.dirname(r.filePaths[0]);});
handle('workspace:discover',async(_e,root,requestId)=>{if(typeof root!=='string'||root.length>32767||!Number.isSafeInteger(requestId))throw Error('目录无效');discoveryController?.abort();const controller=discoveryController=new AbortController(),epoch=++discoveryEpoch;try{return await discoverWorkspace(root,requestId,controller.signal,value=>{if(epoch===discoveryEpoch)emit('workspace:progress',value);});}finally{if(discoveryController===controller)discoveryController=undefined;}});
handle('workspace:cancel',()=>{discoveryController?.abort();});
handle('project:current',()=>index);
handle('project:analyze',(_e,root,options)=>analyze(root,options));
handle('project:cancel',async()=>{
 discoveryController?.abort();
 const pending=pendingProject,generation=++projectGeneration;pendingProject=undefined;await stop();if(generation!==projectGeneration)return;
 if(pending){const root=pending.root,id=crypto.createHash('sha256').update(root.toLowerCase()).digest('hex').slice(0,20);activation=activation.catch(()=>{}).then(async()=>{if(generation===projectGeneration)await execution.activateProject({id,root});});await activation;if(generation!==projectGeneration)return;if(contextProject!==id){contextProject=id;projectContext=crypto.randomUUID();}if(index?.id!==id)index={contextId:projectContext,schema:2,id,root,name:path.basename(root),createdAt:new Date().toISOString(),status:'cancelled',languages:[],symbols:[],files:[],relations:[],diagnostics:[],versions:{rules:'cross-project/3'},sourceRoots:[],jars:[]};}
 indexGeneration=generation;if(index){index.status='cancelled';emit('index',index);}
});
handle('source:read',(_e,scope,file)=>source(file,scoped(scope).id));
let notesCache:{index:ProjectIndex;key:string;value:ReturnType<typeof collectAnalysisNotes>}|undefined;
async function analysisNotes(scope:Parameters<typeof scoped>[0]){
 const selected=scoped(scope);
 const key=analysisNotesKey(selected);
 if(notesCache?.index!==selected||notesCache.key!==key)notesCache={index:selected,key,value:collectAnalysisNotes(selected,async file=>{if(scoped(scope)!==selected)throw Error('项目已切换，请重新选择');const result=await source(file,selected.id);return result.stale?undefined:result.text;})};
 const notes=await notesCache.value;if(scoped(scope)!==selected)throw Error('项目已切换，请重新选择');stillCurrent(selected);return notes;
}
handle('analysis:notes',(_e,scope)=>analysisNotes(scope));
handle('analysis:copy-notes',async(_e,scope,unitId)=>{
 const notes=await analysisNotes(scope),note=notes.web.find(n=>n.unitId===unitId);
 if(!note)throw Error('没有找到这份说明');
 scoped(scope);await clipboard.writeText(webNotesText(note));
});
async function sourcePosition(project:string,file:string,line:number){
  const index=currentIndex(project);
  if(!index||typeof file!=='string'||![...index.files,...index.frontendFiles||[],...index.inputs||[]].some(item=>item.path===file)||!Number.isSafeInteger(line)||line<1||line>10000000)throw Error('无法打开这个源码位置');
  const absolute=await fs.realpath(path.resolve(index.root,file));if(!inside(index.root,absolute))throw Error('无法打开项目外的文件');stillCurrent(index);return absolute;
}
handle('source:copy-position',async(_e,scope,file,line)=>{const project=scoped(scope);await sourcePosition(project.id,file,line);clipboard.writeText(`${file}:${line}`);});
handle('source:open-editor',async(_e,scope,file,line,editor)=>{
  const selected=scoped(scope),project=selected.id;
  if(!['vscode','idea'].includes(editor))throw Error('请选择编辑器');
  const absolute=await sourcePosition(project,file,line);
  const url=editorURL(absolute,line,editor);
  try{if(!app.getApplicationNameForProtocol(url))throw Error('No editor handler');await shell.openExternal(url);return true;}
  catch{stillCurrent(selected);clipboard.writeText(`${file}:${line}`);return false;}
});
handle('project:stale',async(_e,scope)=>{
  const index=scoped(scope),id=index.id;
  for(const file of [...index.files,...index.inputs||[]]){try{if((await source(file.path,id)).stale)return true;}catch{stillCurrent(index);index.stale=true;return true;}}
  return !!index.stale;
});
handle('java:paths',async()=>{
  const roots=await dialog.showOpenDialog(window!,{title:'选择附加 Java 源码根（取消可跳过）',properties:['openDirectory','multiSelections']});
  const jars=await dialog.showOpenDialog(window!,{title:'选择本地已有 JAR（不会下载项目依赖）',properties:['openFile','multiSelections'],filters:[{name:'Java archives',extensions:['jar']}]});
  return roots.canceled&&jars.canceled?undefined:{sourceRoots:roots.filePaths,jars:jars.filePaths};
});
handle('view:save',(_e,scope,view:ViewState)=>{
  const index=scoped(scope);
  if(index&&view&&JSON.stringify(view).length<2*1024*1024)return persist(path.join(paths.data,'session',index.id+'.json'),{indexVersion:index.createdAt,view});
});
handle('frontend:targets',(_e,scope,targets:ViewState['frontendTargets'])=>{
 const index=scoped(scope),clean:NonNullable<ViewState['frontendTargets']>={};if(!targets||typeof targets!=='object')throw Error('请重新指定后端');
 for(const[id,value]of Object.entries(targets)){if(!index.units?.some(u=>u.id===id&&u.kind==='frontend'))throw Error('这个前端不在当前项目里');if(!value||typeof value!=='object')throw Error('请重新指定后端');
  if(value.backendUnitId){if(!index.units.some(u=>u.id===value.backendUnitId&&u.kind==='application'))throw Error('这个后端不在当前项目里');clean[id]={backendUnitId:value.backendUnitId};}
  if(value.address){const address=new URL(value.address);if(!['http:','https:'].includes(address.protocol)||address.username||address.password)throw Error('请填写 http 或 https 地址');clean[id]={...clean[id],address:address.href.replace(/\/$/,'')};}
 }
 return persist(path.join(paths.data,'session',index.id+'-frontend.json'),{projectId:index.id,targets:clean});
});
handle('view:load',async(_e,scope)=>{const index=scoped(scope);let frontendTargets:ViewState['frontendTargets'];try{const saved=JSON.parse(await fs.readFile(path.join(paths.data,'session',index.id+'-frontend.json'),'utf8'));stillCurrent(index);if(saved.projectId===index.id)frontendTargets=saved.targets;}catch{}stillCurrent(index);try{const saved=JSON.parse(await fs.readFile(path.join(paths.data,'session',index.id+'.json'),'utf8'));stillCurrent(index);if(saved.indexVersion===index.createdAt)return{...saved.view,frontendTargets:frontendTargets||saved.view.frontendTargets};}catch{}stillCurrent(index);return frontendTargets?{level:'main',expanded:[],positions:{},viewport:{x:0,y:0,zoom:1},filter:'all',query:'',frontendTargets}:undefined;});
handle('runtime',()=>({pid:process.pid,windowHandle:window?.getNativeWindowHandle().readBigUInt64LE().toString(),version:app.getVersion(),electron:process.versions.electron,node:process.versions.node,platform:process.platform,arch:process.arch,paths,managedPaths:Object.fromEntries(['appData','userData','sessionData','temp','crashDumps','logs'].map(key=>[key,app.getPath(key as Parameters<typeof app.getPath>[0])])),children:[...childPids],worker:!!worker}));
handle('window:focused',()=>!!window&&!window.isMinimized()&&window.isFocused());
let quitting=false;
function scoped(scope:ExecutionScope,session=false){const project=currentIndex(scope?.projectId);if(scope.contextId!==projectContext||!validScope(scope,project.id,session?execution.current?.id:undefined)||session&&!execution.current)throw Error('录制已切换，请重新选择');return project;}
handle('execution:start',(_event,scope,options)=>{const project=scoped(scope);if(runtimeJob||['structure','analyzing'].includes(project.status))throw Error('请等待当前操作完成');const job=execution.configure(options).then(()=>execution.start(project,options));runtimeJob=job;return job.finally(()=>{if(runtimeJob===job)runtimeJob=undefined;});});
handle('execution:startup',(_event,scope)=>execution.startup(scoped(scope)));
handle('execution:confirm-startup',(_event,scope,plan)=>execution.confirmStartup(scoped(scope),plan));
handle('execution:export',(_event,scope,options)=>{scoped(scope,true);return execution.export(!!options?.hidden);});
handle('execution:current',(_event,scope)=>{const project=scoped(scope);return execution.current?.projectId===project.id?execution.current:undefined;});
handle('execution:stop',(_event,scope)=>{scoped(scope,true);return execution.stop();});
handle('execution:stop-environment',(_event,scope)=>{scoped(scope);return execution.stopEnvironment();});
handle('execution:list',(_event,scope)=>{scoped(scope);return execution.list();});
handle('execution:open',(_event,scope,id)=>execution.open(id,scoped(scope)));
handle('execution:remove',(_event,scope,id)=>{scoped(scope);return execution.remove(id);});
handle('execution:bounds',(_event,scope,bounds)=>{if(indexGeneration!==projectGeneration||scope?.contextId!==projectContext||!validScope(scope,index?.id,execution.current?.id)||!execution.current||!bounds||!['x','y','width','height'].every(k=>Number.isFinite(bounds[k])))return;execution.bounds(bounds);});
handle('execution:reload',(_event,scope)=>{scoped(scope,true);execution.browser?.view.webContents.reload();});
handle('execution:thumbnail',(_event,scope,id)=>{scoped(scope,true);return execution.thumbnail(id);});
handle('execution:thumbnails',(_event,scope,enabled)=>{scoped(scope,true);return execution.thumbnails(enabled);});
handle('execution:background-idle',(_event,scope,seconds)=>{scoped(scope,true);return execution.backgroundIdle(seconds);});
handle('execution:open-startup-log',async(_event,scope)=>{scoped(scope);const file=await execution.startupLog();const error=await shell.openPath(file);if(error)throw Error('无法打开记录：'+error);});
handle('execution:copy-startup-log',async(_event,scope)=>{scoped(scope);const failure=execution.startupFailure();if(!failure)throw Error('没有可复制的启动记录');const output=failure.logAvailable?await fs.readFile(await execution.startupLog(),'utf8'):failure.output;clipboard.writeText(`服务：${failure.service}\n命令：${failure.command}\n目录：${failure.cwd}\n退出码：${failure.exitCode??'未知'}\n\n${output}`);});
handle('execution:suggest-port',(_event,scope)=>{scoped(scope,true);return execution.suggestPort();});
handle('execution:save-setup-failure',(_event,scope,failure)=>{scoped(scope);return execution.saveSetupFailure(failure);});
handle('execution:echo-anchor',(_event,scope,anchor)=>{if(indexGeneration===projectGeneration&&scope?.contextId===projectContext&&validScope(scope,index?.id,execution.current?.id)&&execution.current&&anchor&&typeof anchor==='object')execution.echoAnchor(anchor);});
handle('execution:connection',(_event,scope)=>{scoped(scope);return execution.connection();});
handle('execution:configure',(_event,scope,options)=>{scoped(scope);return execution.configure(options);});
handle('execution:java-connection',(_event,scope)=>execution.javaConnection(scoped(scope)));
app.on('before-quit',event=>{if(!quitting){event.preventDefault();quitting=true;void execution.close().then(()=>stop()).then(()=>persistence).finally(()=>app.quit());}});
app.on('window-all-closed',()=>app.quit());
app.whenReady().then(async()=>{
  session.defaultSession.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
  const size=!app.isPackaged&&process.argv.find(a=>a.startsWith('--verification-size='))?.match(/=(1564|1366)x(954|768)$/);
  window=new BrowserWindow({width:size?Number(size[1]):1580,height:size?Number(size[2]):960,minWidth:1050,minHeight:480,backgroundColor:uiTokens.color["canvas"],title:'CodeLeader · 代码关系导航',titleBarStyle:'hidden',...(process.platform!=='darwin'?{titleBarOverlay:{color:uiTokens.color["canvas"],symbolColor:uiTokens.color["compat-017"],height:42}}:{}),autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true}});
  const titleFocus=(focused:boolean)=>{if(process.platform!=='darwin')window?.setTitleBarOverlay({color:uiTokens.color["canvas"],symbolColor:focused?uiTokens.color["compat-017"]:uiTokens.color["compat-018"]});emit('window:focus',focused);};
  window.on('focus',()=>titleFocus(true));window.on('blur',()=>titleFocus(false));window.on('minimize',()=>titleFocus(false));window.on('restore',()=>titleFocus(window?.isFocused()??false));
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  window.webContents.on('will-navigate',event=>event.preventDefault());
  await window.loadFile(path.join(__dirname,'renderer/index.html'));
  log(JSON.stringify({event:'started',...paths,versions:process.versions}));
  // Explicit test-only CLI; never execute any target project code.
  const target=process.argv.find(arg=>arg.startsWith('--project='))?.slice(10);
  if(target)await analyze(target);
});
