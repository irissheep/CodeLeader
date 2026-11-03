const {app,BrowserWindow,ipcMain}=require('electron');
const path=require('node:path'),fs=require('node:fs');
const root=path.resolve(__dirname,'..'),dir=path.join(root,'.tmp','verification-u9d-overlays','electron');
for(const [key,name] of Object.entries({userData:'user',sessionData:'session',temp:'temp',crashDumps:'crashes'})){const target=path.join(dir,name);fs.mkdirSync(target,{recursive:true});app.setPath(key,target);}app.setAppLogsPath(path.join(dir,'logs'));app.commandLine.appendSwitch('remote-debugging-port',process.env.CODELEADER_OVERLAY_PORT);
ipcMain.handle('overlay:zoom',(event,factor)=>event.sender.setZoomFactor(factor));
ipcMain.handle('overlay:size',(event,width,height)=>BrowserWindow.fromWebContents(event.sender).setContentSize(width,height));
app.whenReady().then(async()=>{const window=new BrowserWindow({width:1200,height:900,useContentSize:true,show:true,webPreferences:{contextIsolation:true,sandbox:true,preload:path.join(__dirname,'overlay-fit-preload.cjs')}});await window.loadFile(path.join(root,'.tmp','verification-u9d-overlays','fixture','index.html'));});
app.on('window-all-closed',()=>app.quit());
