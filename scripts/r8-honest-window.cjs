const {app,BrowserWindow,ipcMain,clipboard,ClipboardItem}=require('electron');
const fs=require('node:fs/promises'),path=require('node:path');
const root=path.resolve(__dirname,'..'),out=process.env.CODELEADER_HONEST_OUTPUT||path.join(root,'.tmp/verification-r8-honest-states'),phase=process.env.CODELEADER_HONEST_PHASE||'after',folder=path.join(out,phase),models=process.env.CODELEADER_HONEST_MODELS||path.join(out,'corpus-'+phase);
app.setPath('userData',path.join(folder,'electron'));app.setPath('sessionData',path.join(folder,'electron','session'));app.setPath('temp',path.join(root,'.tmp'));
app.commandLine.appendSwitch('disable-gpu');app.commandLine.appendSwitch('disable-http-cache');
let active,notes;
ipcMain.handle('r8:index',()=>active);
ipcMain.handle('r8:notes',(_e,scope)=>{if(scope.projectId!==active.id||scope.contextId!==active.contextId)throw Error('Wrong project');return notes;});
ipcMain.handle('r8:copy',async(_e,scope,unitId)=>{if(scope.projectId!==active.id||scope.contextId!==active.contextId)throw Error('Wrong project');const note=notes.web.find(n=>n.unitId===unitId);if(!note)throw Error('Missing note');await clipboard.writeText(require(path.join(out,'notes.cjs')).webNotesText(note));});
ipcMain.handle('r8:source',async(_e,file)=>{if(![...active.files,...active.frontendFiles||[],...active.inputs||[]].some(f=>f.path===file))throw Error('Not indexed');const actual=await fs.realpath(path.resolve(active.root,file)),relative=path.relative(await fs.realpath(active.root),actual);if(relative.startsWith('..')||path.isAbsolute(relative))throw Error('Outside project');return{file,text:await fs.readFile(actual,'utf8'),stale:false};});
const delay=ms=>new Promise(r=>setTimeout(r,ms));
app.whenReady().then(async()=>{
 const projects=JSON.parse(await fs.readFile(path.join(out,'projects.json'),'utf8')),window=new BrowserWindow({width:1564,height:954,useContentSize:true,show:false,webPreferences:{preload:path.join(__dirname,'r8-honest-preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true,offscreen:true,backgroundThrottling:false}});
 const errors=[],results=[];window.webContents.on('console-message',(_e,_l,text)=>{if(/Uncaught|TypeError|ReferenceError/.test(text))errors.push(text);});
 const js=async code=>{try{return await window.webContents.executeJavaScript(code,true);}catch(error){await fs.writeFile(path.join(folder,'failed-script.json'),JSON.stringify({project:active?.reviewId,code,errors},null,2));throw error;}},shot=async name=>{await fs.writeFile(path.join(folder,active.reviewId,name+'.png'),(await window.webContents.capturePage()).toPNG());};
 for(const project of projects.filter(p=>!process.env.CODELEADER_HONEST_FILTER||process.env.CODELEADER_HONEST_FILTER.split(',').includes(p.id))){
  active=JSON.parse(await fs.readFile(path.join(models,project.id,'model.json'),'utf8'));active.reviewId=project.id;
  notes=JSON.parse(await fs.readFile(path.join(folder,project.id,'notes.json'),'utf8'));
  await window.loadFile(path.join(folder,'renderer/index.html'));
  for(let n=0;n<100;n++){if(await js(`!!document.querySelector('.react-flow__node')`))break;await delay(100);}
  if(phase==='after')for(let n=0;n<100;n++){const count=await js(`document.querySelectorAll('[data-address-explanation]').length`);if(count===notes.addresses.length)break;await delay(100);}
  await delay(400);const row={project:project.id,views:[],errors:[]};
  const captureText=()=>js(`({text:document.body.innerText,web:[...document.querySelectorAll('[data-web-explanation]')].map(e=>({unit:e.dataset.webExplanation,text:e.innerText})),addresses:[...document.querySelectorAll('[data-address-explanation]')].map(e=>({unit:e.dataset.addressExplanation,text:e.innerText})),badge:document.querySelector('[data-analysis-status]')?.innerText||'',nodes:document.querySelectorAll('.react-flow__node').length,empty:document.querySelector('.graph-no-data')?.innerText||''})`);
  row.main=await captureText();await shot('main');
  if(notes.addresses.length&&row.main.addresses.length){
   const target=await js(`(()=>{const r=document.querySelector('[data-address-explanation]').getBoundingClientRect();return{x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};})()`);window.webContents.sendInputEvent({type:'mouseMove',...target});await delay(150);row.addressHover=await js(`document.querySelector('.address-examples')?.innerText||''`);await shot('addresses');
   row.addressFocusVisible=await js(`(()=>{const e=document.querySelector('.address-examples');if(!e)return false;const r=e.getBoundingClientRect();return getComputedStyle(e).visibility==='visible'&&r.width>0&&r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth;})()`);
   window.webContents.sendInputEvent({type:'mouseMove',x:10,y:10});await delay(50);await js(`document.querySelector('[data-address-explanation]')?.blur()`);
  }else if(notes.addresses.length){row.addressHover='';row.addressFocusVisible=false;await shot('addresses');}
  await js(`document.querySelector('[data-analysis-status]')?.click()`);await delay(250);
  row.partial=await js(`({text:document.querySelector('[data-partial-explanation]')?.innerText||'',groups:document.querySelectorAll('[data-explanation-category]').length,rawClosed:[...document.querySelectorAll('details')].find(e=>e.querySelector('summary')?.innerText.startsWith('原始记录'))?.open===false})`);
  await shot('partial');
  await js(`document.querySelector('.inspector-close')?.click()`);
  for(const view of ['guide','overview']){
   await js(`document.querySelector('[data-view="${view}"]').click()`);
   await delay(600);const state=await captureText();row.views.push({view,...state});await shot(view);
   if(view==='guide'&&notes.web.length&&phase==='after'){
    const saved=await Promise.all((await clipboard.read()).filter(item=>item.types.length).map(async item=>new ClipboardItem(Object.fromEntries(await Promise.all(item.types.map(async type=>[type,await item.getType(type)]))))));
    try{await clipboard.writeText('');await js(`document.querySelector('.web-explanation .button')?.click()`);for(let n=0;n<20;n++){if(await js(`document.querySelector('.web-explanation .button')?.textContent==='已复制'`))break;await delay(100);}row.copied=await clipboard.readText();}
    finally{if(saved.length)await clipboard.write(saved);else clipboard.clear();}
   }
  }
  row.errors=errors.splice(0);results.push(row);await fs.writeFile(path.join(folder,'ui.json'),JSON.stringify(results,null,2));console.log('R8 UI',phase,project.id,'badge',row.main.badge,'address',row.main.addresses.length,'web',row.views[0].web.length,'groups',row.partial.groups);
 }
 window.destroy();app.quit();
}).catch(async e=>{await fs.writeFile(path.join(folder,'ui-failure.txt'),String(e.stack||e));app.exit(1);});
