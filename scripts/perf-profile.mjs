import fs from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import electron from 'electron';
import {_electron} from 'playwright';
import {guard,root} from './common.mjs';
import {managedPath} from './managed-path.mjs';

guard();
const argument=name=>process.argv.find(value=>value.startsWith(`--${name}=`))?.slice(name.length+3);
const target=argument('project'),mode=argument('mode')||'development',seconds=Number(argument('seconds')||60),label=argument('label')||`profile-${Date.now()}`,idleOnly=process.argv.includes('--idle-only'),backgroundOnly=process.argv.includes('--background-only'),runtimeOnly=process.argv.includes('--runtime-only'),disableBand=process.argv.includes('--disable-band'),verifyIdle=process.argv.includes('--verify-idle');
const runtimeTool=argument('runtime-tool'),runtimeArg=argument('runtime-arg'),runtimeUrl=argument('runtime-url');
if(runtimeOnly&&(!target||!runtimeTool||!runtimeArg||!runtimeUrl||!process.argv.includes('--confirmed-startup')))throw Error('运行测量必须提供项目、完整启动选项和已确认标记');
if(!/^[a-z0-9_-]+$/i.test(label)||!Number.isFinite(seconds)||seconds<1||seconds>3600||!['development','packaged'].includes(mode))throw Error('测量参数无效');
const output=managedPath(path.join(root,'.tmp/verification-p1-resources',label));if(await fs.stat(output).catch(()=>undefined))throw Error('测量名称已存在，请使用新的 --label 保留旧结果');await fs.mkdir(output,{recursive:true});
const executable=mode==='packaged'?argument('executable'):electron;
if(!executable)throw Error('测量已有打包版时请提供 --executable=绝对路径');
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const launchStarted=Date.now(),app=await _electron.launch({executablePath:executable,args:mode==='packaged'?[]:['.','--verification-size=1564x954'],cwd:root,env});
const sampleStream=createWriteStream(path.join(output,'electron-metrics.jsonl'),{flags:'wx'});
let sampler,metricsTimer,page,client,closing=false,logDirectory;const samples=[],phases=[],unavailable=[],errors=[];
const cpuProfiles={};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const sample=async()=>{try{const values=await app.evaluate(({app,BrowserWindow})=>{const window=BrowserWindow.getAllWindows()[0];return{time:Date.now(),processes:app.getAppMetrics(),mainMemory:process.memoryUsage(),window:window?{visible:window.isVisible(),minimized:window.isMinimized(),focused:window.isFocused()}:null};});let heap;try{heap=await client.send('Runtime.getHeapUsage');}catch{}if(!closing){const item={...values,rendererHeap:heap};samples.push(item);sampleStream.write(JSON.stringify(item)+'\n');}}catch(error){if(!closing)errors.push(`metrics: ${String(error)}`);}};
async function startProfiler(){try{await app.evaluate(async()=>{const inspector=process.getBuiltinModule('node:inspector');globalThis.__p1session=new inspector.Session();globalThis.__p1session.connect();const call=(name)=>new Promise((resolve,reject)=>globalThis.__p1session.post(name,(error,result)=>error?reject(error):resolve(result)));await call('Profiler.enable');await call('Profiler.start');});await client.send('Profiler.enable');await client.send('Profiler.start');return true;}catch(error){unavailable.push(`CPU 剖析启动失败：${String(error)}`);return false;}}
async function stopProfiler(name,started){if(!started)return;try{const main=await app.evaluate(()=>new Promise((resolve,reject)=>globalThis.__p1session.post('Profiler.stop',(error,result)=>{globalThis.__p1session.disconnect();error?reject(error):resolve(result.profile);})));const renderer=(await client.send('Profiler.stop')).profile;cpuProfiles[name]={main,renderer};}catch(error){unavailable.push(`${name} CPU 剖析未完成：${String(error)}`);}}
async function phase(name,fn,profile=true){const start=Date.now(),started=profile?await startProfiler():false;let error;try{await fn();}catch(e){error=String(e);errors.push(`${name}: ${error}`);}await stopProfiler(name,started);phases.push({name,start,end:Date.now(),error});console.log(`${name}: ${error||'完成'} · ${(Date.now()-start)/1000}s`);}
try{
 const pid=await app.evaluate(()=>process.pid);logDirectory=await app.evaluate(({app})=>app.getPath('logs'));page=await app.firstWindow();await page.waitForLoadState('domcontentloaded');const windowReady=Date.now();phases.push({name:'startup-window',start:launchStarted,end:windowReady,note:'此阶段的进程 CPU 没有从进程创建瞬间开始采样'});client=await page.context().newCDPSession(page);await client.send('Performance.enable');
 sampler=spawn('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(root,'scripts/perf-process-sampler.ps1'),'-RootPid',String(pid),'-Output',path.join(output,'processes.jsonl')],{cwd:root,env,windowsHide:true,stdio:'ignore'});
 await sample();metricsTimer=setInterval(()=>void sample(),1000);
 if(!idleOnly&&!backgroundOnly&&!runtimeOnly)await phase('S1',()=>sleep(seconds*1000));
 if(target){
  await app.evaluate(({dialog},value)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[value]});},target);
  const prepareIndex=()=>page.evaluate(()=>{window.__p1indexes=[];window.__p1unsub?.();window.__p1unsub=window.codeleader.onIndex(i=>window.__p1indexes.push({status:i.status,files:i.files?.length,entries:i.entries?.length,createdAt:i.createdAt}));});
  const open=async(first)=>{const previous=await page.evaluate(()=>window.__p1lastCreated);await prepareIndex();if(first)await page.getByRole('button',{name:/打开本地项目/}).click();else await page.keyboard.press('Control+O');const choose=page.getByRole('button',{name:'开始分析'});try{await choose.waitFor({timeout:3000});await choose.click();}catch{}await page.waitForFunction(({first,previous})=>window.__p1indexes.some(i=>['complete','partial','failed','cancelled'].includes(i.status)&&(first||i.createdAt!==previous)),{first,previous},{timeout:150000});return page.evaluate(()=>{const all=window.__p1indexes;window.__p1lastCreated=all.filter(i=>['complete','partial','failed','cancelled'].includes(i.status)).at(-1)?.createdAt;return all;});};
  await phase('S2',async()=>{await fs.writeFile(path.join(output,'analysis-first.json'),JSON.stringify(await open(true),null,2));});
  if(verifyIdle){
   const state=()=>page.evaluate(()=>({focused:document.hasFocus(),hidden:document.hidden,idle:document.documentElement.classList.contains('resource-idle'),background:document.documentElement.classList.contains('resource-background'),dots:[...document.querySelectorAll('.hierarchy-front-band .hierarchy-travel-dot')].map(element=>getComputedStyle(element).animationPlayState)}));
   await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0]?.focus());await page.mouse.move(15,75);await sleep(150);const active=await state();await sleep(1300);const idle=await state();await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0]?.minimize());await sleep(300);const background=await state();await app.evaluate(({BrowserWindow})=>{const win=BrowserWindow.getAllWindows()[0];win?.restore();win?.focus();});await page.mouse.move(18,78);await sleep(150);const restored=await state();
   const ok=active.dots.length>0&&active.dots.every(value=>value==='running')&&idle.dots.every(value=>value==='paused')&&background.background&&!restored.background&&restored.dots.every(value=>value==='running');
   await fs.writeFile(path.join(output,'idle-behavior.json'),JSON.stringify({active,idle,background,restored,ok},null,2));if(!ok)errors.push('空闲动画暂停或恢复检查失败，详见 idle-behavior.json');
  }
  if(disableBand)await page.addStyleTag({content:'.hierarchy-travel-dot{animation-play-state:paused!important}'});
  await fs.writeFile(path.join(output,'idle-animations.json'),JSON.stringify(await page.evaluate(()=>document.getAnimations().map(a=>({name:a.animationName||'',state:a.playState,target:a.effect?.target?.tagName,classes:a.effect?.target?.getAttribute?.('class')}))),null,2));
  if(!backgroundOnly&&!runtimeOnly)await phase('S3',()=>sleep(seconds*1000));
  if(!idleOnly&&!runtimeOnly){
   await phase('S4',async()=>{await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0]?.minimize());await sleep(seconds*1000);await app.evaluate(({BrowserWindow})=>{const win=BrowserWindow.getAllWindows()[0];win?.restore();win?.focus();});});
   if(!backgroundOnly){await phase('S5',async()=>{const canvas=page.locator('.graph-canvas');const box=await canvas.boundingBox();if(!box)throw Error('画布不可用');const end=Date.now()+20000;await page.mouse.move(box.x+box.width/2,box.y+box.height/2);let n=0;while(Date.now()<end){await page.mouse.wheel(0,n++%2?80:-80);if(n%5===0){await page.mouse.down();await page.mouse.move(box.x+box.width/2+40,box.y+box.height/2+20,{steps:4});await page.mouse.up();}await sleep(120);}});
   await phase('S6',async()=>{for(let round=0;round<5;round++)for(const name of ['main','guide','overview']){const b=page.locator(`[data-view="${name}"]`);if(await b.isEnabled())await b.click();await sleep(250);}});}
  }
  if(runtimeOnly){await phase('S7',async()=>{
   let button=false;try{await page.getByRole('button',{name:/打开真实页面/}).first().click({timeout:3000});button=await page.getByRole('dialog',{name:'打开真实页面'}).isVisible();}catch{}
   const result=await page.evaluate(async({tool,arg,url})=>{const api=window.codeleader.execution,plan=await api.startup(),choice=plan.choices.find(item=>item.command.tool===tool&&item.command.args.length===1&&item.command.args[0]===arg);if(!choice)throw Error('检测结果与用户确认的命令不一致');const started=Date.now(),confirmed=await api.confirmStartup({...plan,url,selected:[choice.id]}),prepared=Date.now();try{const record=await api.start({url,owned:true,startupToken:confirmed.token,policy:'raw',thumbnails:false});await api.bounds({x:20,y:75,width:600,height:600,visible:true});return{preparedMs:prepared-started,readyMs:Date.now()-prepared,state:record.state,copy:confirmed.plan.copy,session:record.id};}catch(error){await api.stopEnvironment().catch(()=>{});throw error;}},{tool:runtimeTool,arg:runtimeArg,url:runtimeUrl});
   await sleep(3000);const pageState=await app.evaluate(async({webContents},url)=>{const target=webContents.getAllWebContents().find(item=>item.getURL().startsWith(url));return target?{url:target.getURL(),ready:await target.executeJavaScript('document.readyState')}:null;},runtimeUrl);
   const stop=await page.evaluate(async()=>{const api=window.codeleader.execution,current=await api.current();try{await api.stop();}finally{await api.stopEnvironment();}return{requests:current?.requests?.length||0};});
   await fs.writeFile(path.join(output,'runtime-result.json'),JSON.stringify({button,result,pageState,stop,method:'启动使用先前明确确认的命令，通过现有接入接口触发；页面可见性通过现有 bounds 接口设置'},null,2));
  });}else unavailable.push('S7 未执行：需用户明确选择已确认的本项目运行配置和服务，不自动执行陌生项目的启动命令。');
  if(!idleOnly&&!backgroundOnly&&!runtimeOnly)await phase('S9',async()=>{await fs.writeFile(path.join(output,'analysis-second.json'),JSON.stringify(await open(false),null,2));});
 }else unavailable.push('未传 --project，S2–S7 和 S9 未执行。');
 const soak=Number(argument('soak')||0);if(soak>0)await phase('soak',()=>sleep(soak*1000),false);
 const beforeClose=Date.now();closing=true;clearInterval(metricsTimer);metricsTimer=undefined;await app.close();phases.push({name:'S8',start:beforeClose,end:Date.now()+5000});await sleep(5000);
}finally{
 closing=true;clearInterval(metricsTimer);if(sampler){if(sampler.exitCode===null){sampler.kill();await new Promise(resolve=>sampler.once('exit',resolve)).catch(()=>{});}}await app.close().catch(()=>{});await new Promise(resolve=>sampleStream.end(resolve));
 await fs.writeFile(path.join(output,'electron-metrics.json'),JSON.stringify(samples,null,2));
 for(const [name,profiles] of Object.entries(cpuProfiles))for(const [processName,profile] of Object.entries(profiles))await fs.writeFile(path.join(output,`${name}-${processName}.cpuprofile`),JSON.stringify(profile));
 await fs.writeFile(path.join(output,'run.json'),JSON.stringify({mode,target,logDirectory,logicalCpus:os.cpus().length,cpu:os.cpus()[0]?.model,seconds,conditions:{idleOnly,backgroundOnly,runtimeOnly,disableBand},phases,unavailable,errors,notes:['每秒采样器及 CPU 剖析本身有额外开销','Electron 在 Windows 上的 idleWakeupsPerSecond 恒为 0，不能作为实际唤醒次数','应用内工作线程与主进程共用系统 PID；当前没有逐工作线程 CPU 剖析','系统盘写入未做全机追踪','真实拖放由受控目录选择替代']},null,2));
}
await import('./perf-report.mjs').then(m=>m.report(output));
if(errors.length)process.exitCode=1;
