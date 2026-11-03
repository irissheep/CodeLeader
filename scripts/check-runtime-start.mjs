import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {_electron} from 'playwright';
import electron from 'electron';
import {guard,root,run} from './common.mjs';

guard();
const output=path.join(root,'.tmp/verification-s1-start-failure');
await fs.mkdir(output,{recursive:true});
const targets=process.argv.slice(2).filter(value=>!value.startsWith('--'));
if(!targets.length)targets.push(...JSON.parse(await fs.readFile(path.join(root,'tests/fixtures/s1-runtime-targets.json'),'utf8')));
await run(process.execPath,[path.join(root,'scripts/build.mjs')]);
const results=[];
async function digest(folder){const hash=crypto.createHash('sha256');async function visit(dir){for(const entry of (await fs.readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){if(['node_modules','.git','dist','build','target','.venv','venv','__pycache__'].includes(entry.name)||entry.name==='.env'||entry.name.startsWith('.env.')||entry.isSymbolicLink())continue;const file=path.join(dir,entry.name);if(entry.isDirectory())await visit(file);else if(entry.isFile()){hash.update(path.relative(folder,file));hash.update(await fs.readFile(file));}}}await visit(folder);return hash.digest('hex');}
for(const [number,target] of targets.entries()){
 const result={target};results.push(result);let app,settings=[],choiceId,testUrl;
 try{
  const before=await digest(target);const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  app=await _electron.launch({executablePath:electron,args:['.','--project='+target,'--verification-size=1564x954'],cwd:root,env});
  const page=await app.firstWindow();await page.waitForFunction(()=>!!window.codeleader,{timeout:30000});
  const index=await page.evaluate(()=>new Promise(resolve=>{const off=window.codeleader.onIndex(value=>{if(['complete','partial','failed','cancelled'].includes(value.status)){off();resolve({id:value.id,root:value.root,status:value.status});}});}));
  if(index.root.toLowerCase()!==path.resolve(target).toLowerCase())throw Error('项目身份不一致');
  settings=await Promise.all([path.join(root,'.tools/runtime/environments',index.id,'startup.json'),path.join(root,'.appdata/connections',index.id+'.json')].map(async file=>({file,previous:await fs.readFile(file).catch(()=>undefined)})));
  const plan=await page.evaluate(()=>window.codeleader.execution.startup());
  const choice=plan.choices.find(item=>item.language==='javascript'&&item.command.tool==='npm'&&item.port&&item.command.label)||plan.choices.find(item=>item.command.tool==='npm'&&item.port&&item.command.label);
  if(!choice)throw Error('没有找到带端口的前端启动方式');
  // Enter the same workspace as the user, but select only the frontend in the reviewed plan below.
  await page.getByRole('button',{name:/打开真实页面/}).first().click();const entry=page.getByRole('dialog',{name:'打开真实页面'});await entry.getByText('已找到前端的启动方式').waitFor();await entry.getByRole('button',{name:'启动并打开',exact:true}).click();const setup=page.getByRole('dialog',{name:'启动方式'});await setup.waitFor();await setup.getByRole('button',{name:'取消'}).click();
  const url=`http://127.0.0.1:${choice.port}/`;choiceId=choice.id;testUrl=url;
  result.detected={unit:choice.name,command:choice.command.label,port:choice.port,source:choice.command.basis,relativeDirectory:choice.root,url};
  const started=await page.evaluate(async({choiceId,url})=>{const api=window.codeleader.execution,plan=await api.startup(),confirmed=await api.confirmStartup({...plan,selected:[choiceId],url});try{const session=await api.start({url,owned:true,startupToken:confirmed.token,policy:'raw',thumbnails:false});return{state:session.state,id:session.id,copy:confirmed.plan.copy};}catch(error){const session=await api.current();return{state:session?.state,id:session?.id,failure:session?.startupFailure,error:String(error)};}},{choiceId:choice.id,url});
  result.started=started;
  if(started.state!=='recording')throw Error('页面未成功打开：'+(started.failure?.reason||started.failure?.output||started.error));
  result.httpStatus=(await fetch(url)).status;
  result.nativePage=await app.evaluate(async({webContents},url)=>{const page=webContents.getAllWebContents().find(item=>item.getURL().startsWith(url));return page?{url:page.getURL(),ready:await page.executeJavaScript('document.readyState')}:null;},url);
  if(!result.nativePage||result.httpStatus>=400)throw Error('真实页面不可访问');
  await page.waitForTimeout(800);const runtime=await page.evaluate(()=>window.codeleader.runtime());await run('pwsh.exe',['-NoProfile','-File',path.join(root,'scripts/capture-runtime-window.ps1'),'-WindowHandle',runtime.windowHandle,'-Output',path.join(output,`runtime-start-${number+1}.png`)]);
  await page.evaluate(async()=>{await window.codeleader.execution.stop();await window.codeleader.execution.stopEnvironment();});
  result.stopped=true;result.sourceUnchanged=before===await digest(target);if(!result.sourceUnchanged)throw Error('源目录内容发生变化');
 }catch(error){result.error=String(error);try{const page=app&&await app.firstWindow();if(page)await page.evaluate(()=>window.codeleader.execution.stopEnvironment()).catch(()=>{});}catch{}}
 finally{if(app)await app.close().catch(()=>{});result.settingsRestored=true;for(const setting of settings){try{const now=await fs.readFile(setting.file),value=JSON.parse(now.toString());const ours=value.url===testUrl&&(!value.selected||value.selected.length===1&&value.selected[0]===choiceId);if(!ours){if(!setting.previous||!now.equals(setting.previous))result.settingsRestored=false;continue;}if(setting.previous)await fs.writeFile(setting.file,setting.previous);else await fs.rm(setting.file);}catch{if(setting.previous)result.settingsRestored=false;}}await fs.writeFile(path.join(output,'runtime-start-results.json'),JSON.stringify(results,null,2));}
}
console.log(JSON.stringify(results,null,2));if(results.some(item=>item.error))process.exitCode=1;
