const {app,BrowserWindow,ipcMain}=require('electron');
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),phase=process.env.CODELEADER_UI_PHASE,folder=path.join(root,'.tmp/verification-u1-visual-system',phase);
for(const [key,name]of Object.entries({userData:'user',appData:'app',sessionData:'session',temp:'temp',crashDumps:'crashes'})){const target=path.join(folder,name);fs.mkdirSync(target,{recursive:true});app.setPath(key,target);}
app.setAppLogsPath(path.join(folder,'logs'));
app.commandLine.appendSwitch('remote-debugging-port','18149');
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
let mode='static';const sources=JSON.parse(fs.readFileSync(path.join(root,'.tmp/verification-u1-visual-system/inputs.json'),'utf8'));
const input=()=>mode==='static'?{index:sources.static}:{index:sources.runtime,record:{...sources.record,historical:true}};
ipcMain.handle('u1:input',()=>input());
ipcMain.handle('u1:source',(_event,file)=>{const index=input().index,target=path.resolve(index.root,file);if(!target.startsWith(path.resolve(index.root)+path.sep))throw Error('Source outside project');return {text:fs.readFileSync(target,'utf8'),stale:false};});
ipcMain.handle('u1:thumbnail',(_event,id)=>{const op=sources.record.operations?.find(o=>o.id===id),name=op?.thumbnail?.name;if(!name)return;const target=path.resolve(sources.sessionFolder,name);if(!target.startsWith(path.resolve(sources.sessionFolder)+path.sep)||!fs.existsSync(target))return;return 'data:image/png;base64,'+fs.readFileSync(target).toString('base64');});
let window;
ipcMain.handle('u1:mode',(_event,next)=>{if(!['static','runtime'].includes(next))throw Error('Invalid review mode');mode=next;setImmediate(()=>window.reload());});
ipcMain.handle('u1:close',()=>{setImmediate(()=>app.quit());});
ipcMain.handle('u1:capture',async(_event,name)=>{if(!/^[a-z-]+$/.test(name))throw Error('Invalid screenshot name');const image=await new Promise(resolve=>{window.webContents.once('paint',(_event,_rect,image)=>resolve(image));window.webContents.invalidate();});fs.writeFileSync(path.join(folder,name+'.png'),image.toPNG());});
app.whenReady().then(async()=>{
 window=new BrowserWindow({width:sources.width,height:sources.height,useContentSize:true,show:false,autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'ui-system-preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false,offscreen:true}});
 await window.loadFile(path.join(folder,'renderer/index.html'));
 process.stdin.on('data',async data=>{if(String(data).includes('runtime')){mode='runtime';await window.reload();}else if(String(data).includes('quit'))app.quit();});
});
app.on('window-all-closed',()=>app.quit());
