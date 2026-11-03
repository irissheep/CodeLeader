const {contextBridge,ipcRenderer}=require('electron');
const no=()=>()=>{};
const execution={forProject:()=>execution,onOperation:no,onUpdate:no,current:async()=>undefined,list:async()=>[],connection:async()=>({url:'',owned:false}),bounds:async()=>{}};
contextBridge.exposeInMainWorld('codeleader',{
 execution,onWindowFocus:no,windowFocused:async()=>true,onProgress:fn=>{const listener=(_event,value)=>fn(value);ipcRenderer.on('u3:progress',listener);return()=>ipcRenderer.removeListener('u3:progress',listener);},onError:fn=>{const listener=(_event,message)=>fn(message);ipcRenderer.on('u3:error',listener);return()=>ipcRenderer.removeListener('u3:error',listener);},
 onIndex:fn=>{let active=true;ipcRenderer.invoke('u3:index').then(v=>{if(active)fn(v);});return()=>{active=false;};},
 checkStale:async()=>false,saveView:async()=>{},loadView:async()=>undefined,
 source:async()=>({text:'',stale:false}),runtime:async()=>({}),chooseProject:async()=>undefined,
 analyze:async()=>{throw Error('Read-only visual review does not launch target code');}
});
