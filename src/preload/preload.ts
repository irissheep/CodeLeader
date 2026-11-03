import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { CodeLeaderAPI } from '../shared/model';
import type {ExecutionAPI} from '../shared/execution';
function listen(channel:string,fn:(value:any)=>void) {const listener=(_event:Electron.IpcRendererEvent,value:unknown)=>fn(value);ipcRenderer.on(channel,listener);return()=>ipcRenderer.removeListener(channel,listener);}
let projectId='',contextId:string|undefined,sessionId:string|undefined;
function acceptIndex(index:{id:string;contextId?:string}){if(index.id!==projectId||index.contextId!==contextId){projectId=index.id;contextId=index.contextId;sessionId=undefined;}}
listen('index',acceptIndex);
listen('execution:update',record=>{if(record.projectId===projectId)sessionId=record.id;});
function execution(project?:string,session?:string):ExecutionAPI{
 const context=project===projectId?contextId:undefined;
 const scope=()=>({projectId:project??projectId,contextId:project===undefined?contextId:context,sessionId:session??(project===undefined?sessionId:undefined)});
 const invoke=(channel:string,...args:unknown[])=>ipcRenderer.invoke('execution:'+channel,scope(),...args);
 const accept=async(promise:Promise<any>)=>{const expected=scope();const value=await promise;if(value?.projectId===projectId&&expected.contextId===contextId)sessionId=value.id;return value;};
 return {forProject:execution,startup:()=>invoke('startup'),confirmStartup:plan=>invoke('confirm-startup',plan),current:()=>accept(invoke('current')),start:options=>accept(invoke('start',options)),stop:()=>accept(invoke('stop')),stopEnvironment:()=>invoke('stop-environment'),export:options=>invoke('export',options),list:()=>invoke('list'),open:id=>accept(invoke('open',id)),remove:id=>invoke('remove',id),bounds:value=>invoke('bounds',value),reload:()=>invoke('reload'),thumbnail:id=>invoke('thumbnail',id),thumbnails:enabled=>invoke('thumbnails',enabled),backgroundIdle:seconds=>invoke('background-idle',seconds),openStartupLog:()=>invoke('open-startup-log'),copyStartupLog:()=>invoke('copy-startup-log'),suggestPort:()=>invoke('suggest-port'),saveSetupFailure:failure=>invoke('save-setup-failure',failure),echoAnchor:anchor=>invoke('echo-anchor',anchor),connection:()=>invoke('connection'),configure:options=>invoke('configure',options),javaConnection:()=>invoke('java-connection'),onUpdate:fn=>listen('execution:update',value=>{if(value.projectId===(project??projectId)&&value.contextId===(project===undefined?contextId:context)&&(!session||value.id===session))fn(value);}),onOperation:fn=>listen('execution:operation',value=>{if(value.projectId===(project??projectId)&&value.contextId===(project===undefined?contextId:context)&&(!session||value.sessionId===session))fn(value.operation);})};
}
const api:CodeLeaderAPI={
  execution:execution(),
  chooseProject:()=>ipcRenderer.invoke('project:choose'),
  chooseSource:()=>ipcRenderer.invoke('project:choose-source'),
  discoverWorkspace:(root,requestId)=>ipcRenderer.invoke('workspace:discover',root,requestId),
  cancelDiscovery:()=>ipcRenderer.invoke('workspace:cancel'),
  onWorkspaceProgress:fn=>listen('workspace:progress',fn),
  analyze:(root,options)=>ipcRenderer.invoke('project:analyze',root,options),
  cancel:()=>ipcRenderer.invoke('project:cancel'),
  source:(file,project=projectId,context=contextId)=>ipcRenderer.invoke('source:read',{projectId:project,contextId:context},file),
  analysisNotes:(project=projectId,context=contextId)=>ipcRenderer.invoke('analysis:notes',{projectId:project,contextId:context}),
  copyAnalysisNotes:(unitId,project=projectId,context=contextId)=>ipcRenderer.invoke('analysis:copy-notes',{projectId:project,contextId:context},unitId),
  openSource:(file,line,editor,project=projectId,context=contextId)=>ipcRenderer.invoke('source:open-editor',{projectId:project,contextId:context},file,line,editor),
  copySource:(file,line,project=projectId,context=contextId)=>ipcRenderer.invoke('source:copy-position',{projectId:project,contextId:context},file,line),
  checkStale:(project=projectId,context=contextId)=>ipcRenderer.invoke('project:stale',{projectId:project,contextId:context}),
  chooseJavaPaths:()=>ipcRenderer.invoke('java:paths'),
  saveView:(view,project=projectId,context=contextId)=>ipcRenderer.invoke('view:save',{projectId:project,contextId:context},view),
  loadView:(project=projectId,context=contextId)=>ipcRenderer.invoke('view:load',{projectId:project,contextId:context}),
  setFrontendTargets:(targets,project=projectId,context=contextId)=>ipcRenderer.invoke('frontend:targets',{projectId:project,contextId:context},targets),
  onIndex:fn=>{let received=false,active=true;const stop=listen('index',value=>{received=true;fn(value);});void ipcRenderer.invoke('project:current').then(value=>{if(active&&!received&&value){acceptIndex(value);fn(value);}}).catch(()=>{});return()=>{active=false;stop();};},onProgress:fn=>listen('progress',fn),onError:fn=>listen('error',fn),
  droppedPath:file=>webUtils.getPathForFile(file),runtime:()=>ipcRenderer.invoke('runtime'),
  windowFocused:()=>ipcRenderer.invoke('window:focused'),onWindowFocus:fn=>listen('window:focus',fn)
};
contextBridge.exposeInMainWorld('codeleader',api);
