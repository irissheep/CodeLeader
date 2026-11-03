const {app,BrowserWindow,ipcMain,screen}=require('electron');
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),phase=process.env.CODELEADER_MOTION_PHASE,port=process.env.CODELEADER_MOTION_PORT;
const base=process.env.CODELEADER_MOTION_BASE||path.join(root,'.tmp/verification-u2-motion'),folder=path.join(base,phase),sources=JSON.parse(fs.readFileSync(path.join(base,'inputs.json'),'utf8'));
for(const[key,name]of Object.entries({userData:'user',appData:'app',sessionData:'session',temp:'temp',crashDumps:'crashes'})){const target=path.join(folder,name);fs.mkdirSync(target,{recursive:true});app.setPath(key,target);}
app.setAppLogsPath(path.join(folder,'logs'));app.commandLine.appendSwitch('remote-debugging-port',port);app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
let mode='runtime',window;
const input=()=>({index:mode==='runtime'?sources.runtime:sources.static,...(mode==='runtime'?{record:{...sources.record,historical:true}}:{})});
ipcMain.handle('u2:input',()=>input());
ipcMain.handle('u2:source',(_event,file)=>{const target=path.resolve(input().index.root,file);if(!target.startsWith(path.resolve(input().index.root)+path.sep))throw Error('Source outside project');return {text:fs.readFileSync(target,'utf8'),stale:false};});
ipcMain.handle('u2:thumbnail',(_event,id)=>{const op=sources.record.operations?.find(o=>o.id===id),name=op?.thumbnail?.name;if(!name)return;const file=path.resolve(sources.sessionFolder,name);if(!file.startsWith(path.resolve(sources.sessionFolder)+path.sep)||!fs.existsSync(file))return;return 'data:image/png;base64,'+fs.readFileSync(file).toString('base64');});
ipcMain.handle('u2:mode',(_event,value)=>{if(!['static','runtime'].includes(value))throw Error('Invalid mode');mode=value;setImmediate(()=>window.reload());});
ipcMain.handle('u2:frame',()=>window.webContents.invalidate());
ipcMain.handle('u2:close',()=>{setImmediate(()=>app.quit());});
ipcMain.handle('u2:capture',async(_event,name)=>{if(!/^[a-z0-9/-]+$/.test(name)||name.includes('..'))throw Error('Invalid capture name');const file=path.join(folder,name+'.png');fs.mkdirSync(path.dirname(file),{recursive:true});const image=await window.webContents.capturePage();fs.writeFileSync(file,image.toPNG());});
app.whenReady().then(async()=>{
 const machine={electron:process.versions.electron,chrome:process.versions.chrome,screen:screen.getPrimaryDisplay(),offscreen:true,requestedFrameRate:60};fs.writeFileSync(path.join(folder,'display.json'),JSON.stringify(machine,null,2));
 window=new BrowserWindow({width:sources.width,height:sources.height,useContentSize:true,show:false,autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'u2-motion-preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false,offscreen:true}});
 window.webContents.setFrameRate(60);
 await window.loadFile(path.join(folder,'renderer/index.html'));
});
app.on('window-all-closed',()=>app.quit());
