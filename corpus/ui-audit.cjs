const {app,BrowserWindow,ipcMain}=require('electron');
const fs=require('node:fs/promises'),sync=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),output=path.join(root,'.tmp/verification-generalization-baseline'),user=path.join(output,'ui-user-data');
for(const [key,folder] of Object.entries({userData:user,appData:path.join(user,'app'),sessionData:path.join(user,'session'),temp:path.join(output,'ui-temp'),crashDumps:path.join(output,'ui-crashes')})){sync.mkdirSync(folder,{recursive:true});app.setPath(key,folder);}
app.commandLine.appendSwitch('user-data-dir',user);app.commandLine.appendSwitch('disk-cache-dir',path.join(user,'cache'));app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');app.setAppLogsPath(path.join(output,'ui-logs'));
let current;ipcMain.handle('corpus:index',()=>current);
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function waitFor(window,condition){const start=Date.now();while(Date.now()-start<12000){if(await window.webContents.executeJavaScript(condition))return;await pause(80);}throw Error('Static renderer did not settle');}
app.whenReady().then(async()=>{
 const manifest=JSON.parse(await fs.readFile(path.join(output,'active-manifest.json'),'utf8')),results=[];
 const window=new BrowserWindow({width:1564,height:954,useContentSize:true,show:false,autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'ui-preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false,offscreen:true}});
 window.webContents.setFrameRate(30);
 for(const project of manifest.projects){
  current=JSON.parse(await fs.readFile(path.join(output,project.id,'model.json'),'utf8'));
  const views=[],errors=[];const error=(_e,_level,message)=>{if(/Uncaught|TypeError|ReferenceError/.test(message))errors.push(message);};window.webContents.on('console-message',error);
  await window.loadFile(path.join(output,'ui-renderer/index.html'));
  await waitFor(window,`!!document.querySelector('.command-view,.command-view-tabs')`);
  for(const [name,level] of [['项目主干','main'],['接口导览','guide'],['代码依赖','overview']]){
   await window.webContents.executeJavaScript(`(()=>{const direct=document.querySelector('[data-view="${level}"]');if(direct){direct.click();return;}const buttons=[...document.querySelectorAll('.command-view .command-menu button')];buttons.find(b=>b.textContent===${JSON.stringify(name)}).click();})()`);
   await waitFor(window,`(document.querySelector('[data-view="${level}"][aria-pressed=true]')||document.querySelector('.command-view summary')?.textContent===${JSON.stringify(name)})&&(!!document.querySelector('.react-flow__node:not([style*="visibility: hidden"])')||!!document.querySelector('.graph-no-data'))`);await pause(350);
   const state=await window.webContents.executeJavaScript(`(()=>{const cards=[...document.querySelectorAll('.react-flow__node')],empty=document.querySelector('.graph-no-data'),host=document.querySelector('.canvas-stage').getBoundingClientRect();return {nodes:cards.length,placeholderCount:(document.querySelector('.react-flow')?.textContent||'').split('包 / 目录结构').length-1,roleOrClassCards:cards.filter(c=>c.querySelector('.dependency-count')&&c.querySelector('.card-summary')?.textContent.trim()).length,blankCards:cards.filter(c=>!c.textContent.trim()&&!c.querySelector('.interface-anchor')).length,visible:cards.filter(c=>{const r=c.getBoundingClientRect(),s=getComputedStyle(c);return s.visibility!=='hidden'&&s.opacity!=='0'&&r.right>host.left&&r.left<host.right&&r.bottom>host.top&&r.top<host.bottom}).length,emptyText:empty?.textContent?.trim()||'',errors:[...document.querySelectorAll('.layout-error,.graph-error')].map(e=>e.textContent),text:document.querySelector('.react-flow')?.textContent?.slice(0,200)||''};})()`);
   await window.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
   const bitmap=await new Promise(resolve=>{window.webContents.once('paint',(_event,_dirty,image)=>resolve(image));window.webContents.invalidate();});
   const screenshot=path.join(output,project.id,`ui-${level}.png`);await fs.writeFile(screenshot,bitmap.toPNG());views.push({view:level,...state,screenshot});
  }
  window.webContents.removeListener('console-message',error);results.push({id:project.id,views,errors});await fs.writeFile(path.join(output,'ui-audit.json'),JSON.stringify({renderer:'current src/renderer via evaluation-only Vite build',width:1564,height:954,scope:'真实静态组件、真实完整分析模型、只模拟 IPC 输入；无目标页面/运行环境/业务请求。非遮挡或布局交互验收。',projects:results},null,2));console.log('UI',project.id,views.map(v=>`${v.view}:${v.nodes},empty=${!!v.emptyText}`).join(' '));
 }
 window.destroy();app.quit();
}).catch(async error=>{await fs.writeFile(path.join(output,'ui-audit-error.txt'),String(error.stack||error));console.error(error);app.exit(1);});
