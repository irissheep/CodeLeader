// Static rendering audit only. No target page, target execution or capture API.
const {contextBridge,ipcRenderer}=require('electron');
const no=()=>()=>{};
const execution={forProject:()=>execution,onOperation:no,onUpdate:no,current:async()=>undefined,list:async()=>[],connection:async()=>({url:'',owned:false}),bounds:async()=>{}};
contextBridge.exposeInMainWorld('codeleader',{
 execution,onWindowFocus:no,windowFocused:async()=>true,onProgress:no,onError:no,
 onIndex:fn=>{let active=true;ipcRenderer.invoke('corpus:index').then(v=>{if(active)fn(v);});return()=>{active=false;};},
 checkStale:async()=>false,saveView:async()=>{},loadView:async()=>undefined,
 source:()=>Promise.reject(Error('Source navigation is outside this static rendering audit')),
 runtime:async()=>({}),chooseProject:async()=>undefined,analyze:async()=>{throw Error('Corpus audit never launches target analysis from the UI');}
});
