const {contextBridge,ipcRenderer}=require('electron');
const no=()=>()=>{};
const execution={forProject:()=>execution,onOperation:no,onUpdate:no,current:async()=>undefined,list:async()=>[],connection:async()=>({url:'',owned:false}),bounds:async()=>{}};
contextBridge.exposeInMainWorld('codeleader',{
 execution,onWindowFocus:no,windowFocused:async()=>true,onProgress:no,onError:no,
 onIndex:fn=>{let active=true;ipcRenderer.invoke('r8:index').then(v=>{if(active)fn(v);});return()=>{active=false;};},
 checkStale:async()=>false,saveView:async()=>{},loadView:async()=>undefined,
 analysisNotes:(projectId,contextId)=>ipcRenderer.invoke('r8:notes',{projectId,contextId}),
 copyAnalysisNotes:(unitId,projectId,contextId)=>ipcRenderer.invoke('r8:copy',{projectId,contextId},unitId),
 source:file=>ipcRenderer.invoke('r8:source',file),runtime:async()=>({}),chooseProject:async()=>undefined,
 analyze:async()=>{throw Error('Read-only review does not start target applications');}
});
