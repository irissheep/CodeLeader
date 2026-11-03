const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('overlayZoom',factor=>ipcRenderer.invoke('overlay:zoom',factor));
contextBridge.exposeInMainWorld('overlaySize',(width,height)=>ipcRenderer.invoke('overlay:size',width,height));
