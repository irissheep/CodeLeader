const {app,BrowserWindow,ipcMain}=require('electron');
const fs=require('node:fs/promises'),sync=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),review=sync.readFileSync(path.join(root,'tests/fixtures/r13-review.json'),'utf8'),config=JSON.parse(review),out=path.join(root,config.output),phase=process.env.CODELEADER_ROUTING_PHASE||'after',folder=path.join(out,'ui',phase);
for(const[key,dir]of Object.entries({userData:'user',sessionData:'session',temp:'temp',crashDumps:'crashes'})){const file=path.join(folder,dir);sync.mkdirSync(file,{recursive:true});app.setPath(key,file);}app.setAppLogsPath(path.join(folder,'logs'));app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
let current;ipcMain.handle('u3:index',()=>current);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
app.whenReady().then(async()=>{
 const window=new BrowserWindow({width:config.width,height:config.height,useContentSize:true,show:false,webPreferences:{preload:path.join(root,'scripts/u3-adaptive-preload.cjs'),contextIsolation:true,sandbox:true,offscreen:true,backgroundThrottling:false}});
 const js=code=>window.webContents.executeJavaScript(code,true),wait=async condition=>{for(let i=0;i<300;i++){if(await js(condition))return;await sleep(50);}throw Error('Did not settle: '+condition);};
 const results=[],errors=[];window.webContents.on('console-message',(_e,_l,m)=>{if(/Uncaught|TypeError|ReferenceError/.test(m))errors.push(m);});
 const shot=async file=>fs.writeFile(file,(await window.webContents.capturePage()).toPNG());
 for(const id of config.projects){
  current=JSON.parse(await fs.readFile(path.join(out,'before',id,'model.json'),'utf8'));const destination=path.join(folder,id);await fs.mkdir(destination,{recursive:true});
  await window.loadFile(path.join(folder,'renderer/index.html'));await wait(`!!document.querySelector('[data-view=overview]')`);await js(`document.querySelector('[data-view=overview]').click()`);
  await wait(`document.querySelector('.graph-canvas')?.dataset.layoutBusy==='false'&&document.querySelectorAll('.react-flow__node').length>0`);await sleep(300);
  await shot(path.join(destination,'default.png'));
  const row={project:id,nodes:await js(`document.querySelectorAll('.react-flow__node').length`),edges:await js(`document.querySelectorAll('.react-flow__edge-path').length`),bundles:await js(`document.querySelectorAll('[data-bundle-id]').length`),interactions:[]};
  if(phase==='after'){
   async function action(name,code){
    await js(`window.__routingBefore=new Map([...document.querySelectorAll('.react-flow__node')].map(n=>[n.dataset.id,n]));window.__routingFrames=[];window.__routingSampling=true;requestAnimationFrame(function sample(){if(!window.__routingSampling)return;const nodes=[...document.querySelectorAll('.react-flow__node')];window.__routingFrames.push({count:nodes.length,bad:nodes.filter(n=>window.__routingBefore.has(n.dataset.id)&&(getComputedStyle(n).visibility==='hidden'||Number(getComputedStyle(n).opacity)===0)).map(n=>n.dataset.id),empty:[...document.querySelectorAll('.react-flow__edge-path')].filter(e=>!e.getAttribute('d')||/NaN/.test(e.getAttribute('d'))).length});requestAnimationFrame(sample);});`);
    await js(code);await sleep(50);await wait(`document.querySelector('.graph-canvas')?.dataset.layoutBusy==='false'`);await sleep(250);
    const frames=path.join(destination,name);await fs.mkdir(frames,{recursive:true});for(let i=0;i<10;i++){await js('new Promise(resolve=>requestAnimationFrame(()=>resolve(true)))');await shot(path.join(frames,String(i).padStart(2,'0')+'.png'));}
    const result=await js(`(()=>{window.__routingSampling=false;const now=new Map([...document.querySelectorAll('.react-flow__node')].map(n=>[n.dataset.id,n]));return{common:[...window.__routingBefore.keys()].filter(id=>now.has(id)).length,recreated:[...window.__routingBefore].filter(([id,n])=>now.has(id)&&now.get(id)!==n).length,frames:window.__routingFrames,menuMembers:document.querySelectorAll('.edge-choices button').length-1};})()`);row.interactions.push({name,...result});
   }
   if(row.bundles){await action('open-members',`document.querySelector('[data-bundle-id]').click()`);await action('close-members',`[...document.querySelectorAll('.edge-choices button')].find(b=>b.textContent==='取消').click()`);}
   await action('project-scope',`document.querySelector('.dependency-scope').open=true;[...document.querySelectorAll('.dependency-scope button')].find(b=>b.textContent==='整个项目').click()`);
   await action('chain-scope',`document.querySelector('.dependency-scope').open=true;[...document.querySelectorAll('.dependency-scope button')].find(b=>/当前.*链路/.test(b.textContent)).click()`);
   await shot(path.join(destination,'restored.png'));
  }
  results.push(row);await fs.writeFile(path.join(folder,'RESULT.json'),JSON.stringify({phase,results,errors,scope:'Real production renderer and frozen real semantic models; isolated IPC; no target application started'},null,2));console.log(phase,id,row.nodes,row.edges,row.bundles);
 }
 window.destroy();app.quit();
}).catch(async error=>{await fs.writeFile(path.join(folder,'failure.txt'),String(error.stack));app.exit(1);});
