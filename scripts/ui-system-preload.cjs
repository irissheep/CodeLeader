const {contextBridge,ipcRenderer}=require('electron');
const no=()=>()=>{};
let input;
const context=()=>input?Promise.resolve(input):ipcRenderer.invoke('u1:input').then(value=>input=value);
const execution={forProject:()=>execution,onOperation:no,onUpdate:no,current:async()=>(await context()).record,list:async()=>{const s=(await context()).record;return s?[s]:[];},connection:async()=>({url:'',owned:false}),bounds:async()=>{},echoAnchor:async()=>{},open:async()=>(await context()).record,thumbnail:id=>ipcRenderer.invoke('u1:thumbnail',id),stop:async()=>(await context()).record};
contextBridge.exposeInMainWorld('codeleader',{
 execution,onWindowFocus:no,windowFocused:async()=>true,onProgress:no,onError:no,
 onIndex:fn=>{let active=true;context().then(v=>{if(active)fn(v.index);});return()=>{active=false;};},
 checkStale:async()=>false,saveView:async()=>{},loadView:async()=>undefined,
 source:file=>ipcRenderer.invoke('u1:source',file),runtime:async()=>({}),
 chooseProject:async()=>undefined,analyze:async()=>{throw Error('Read-only visual review');},
 copySource:async()=>{},openSource:async()=>false,exportDocument:async()=>undefined,
 capture:name=>ipcRenderer.invoke('u1:capture',name),
 reviewMode:mode=>ipcRenderer.invoke('u1:mode',mode),reviewClose:()=>ipcRenderer.invoke('u1:close')
});
