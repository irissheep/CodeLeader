import {validationInput,requireValidationInputs} from './verification-input.mjs';
requireValidationInputs();
import fs from 'node:fs';
import crypto from 'node:crypto';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {createServer} from 'vite';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import electronPath from 'electron';
import {guard,root} from './common.mjs';
guard();const out=root+'/.tmp/verification-runtime-flow/react-fixture';fs.mkdirSync(out+'/site',{recursive:true});fs.mkdirSync(out+'/electron',{recursive:true});
const source=validationInput(import.meta.url,'v0');
fs.writeFileSync(out+'/site/main.tsx',source);fs.writeFileSync(out+'/site/index.html','<div id="root"></div><script type="module" src="/main.tsx"></script>');
const api=http.createServer((req,res)=>{req.resume();req.on('end',()=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({answer:'React fixture received'}));});});await new Promise(resolve=>api.listen(19194,'127.0.0.1',resolve));
const vite=await createServer({configFile:false,root:out+'/site',cacheDir:root+'/.cache/runtime-react',resolve:{alias:[{find:/^react$/,replacement:root+'/node_modules/react/index.js'},{find:/^react-dom\/client$/,replacement:root+'/node_modules/react-dom/client.js'}]},server:{host:'127.0.0.1',port:19193,strictPort:true,fs:{allow:[root]},proxy:{'/sample':'http://127.0.0.1:19194'}}});await vite.listen();
await build({entryPoints:['src/main/execution-browser.ts'],outfile:out+'/browser.cjs',bundle:true,platform:'node',format:'cjs',external:['electron']});
const sourceHash=crypto.createHash('sha256').update(source).digest('hex');
const fixtureIndex={id:'react-fixture',root:out+'/site',symbols:[],entities:[],frontendFiles:[{path:'main.tsx',hash:sourceHash,size:source.length,language:'typescript'}]};
fs.writeFileSync(out+'/index.json',JSON.stringify(fixtureIndex));
fs.writeFileSync(out+'/main.cjs',`const {app,BrowserWindow}=require('electron');const fs=require('fs');const {ExecutionBrowser}=require('./browser.cjs');app.setPath('userData',${JSON.stringify(out+'/electron')});app.setPath('sessionData',${JSON.stringify(out+'/electron')});app.setPath('temp',${JSON.stringify(root+'/.tmp')});let observation;app.whenReady().then(async()=>{const window=new BrowserWindow({width:1000,height:700,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true}});await window.loadURL('about:blank');const record={id:'react-fixture-'+Date.now(),frontendUrl:'http://127.0.0.1:19193',policy:'synthetic',requests:[],dropped:0,plan:{routes:[{method:'POST',path:'/sample'}]}};observation=new ExecutionBrowser(window,record,require('./index.json'),()=>fs.writeFileSync(${JSON.stringify(out+'/record.json')},JSON.stringify(record)));await observation.load();observation.bounds({x:0,y:0,width:984,height:661,visible:true});});app.on('window-all-closed',()=>app.quit());`);
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;const child=spawn(electronPath,[out+'/main.cjs','--remote-debugging-port=18099'],{env,windowsHide:false,stdio:'ignore'});let browser;
try{
  for(let i=0;i<80;i++){try{browser=await chromium.connectOverCDP('http://127.0.0.1:18099');break;}catch{await new Promise(r=>setTimeout(r,200));}}
  let page;for(let i=0;i<80;i++){page=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().startsWith('http://127.0.0.1:19193'));if(page)break;await new Promise(r=>setTimeout(r,100));}
  await page.getByRole('button',{name:'发送测试请求'}).click();await page.getByText('React fixture received').waitFor();
  let record;for(let i=0;i<40;i++){try{record=JSON.parse(fs.readFileSync(out+'/record.json','utf8'));if(record.requests[0]?.initiator?.some(i=>i.location?.file==='main.tsx'))break;}catch{}await new Promise(r=>setTimeout(r,100));}
  if(!record.requests[0]?.initiator?.some(i=>i.location?.file==='main.tsx'))throw Error('React source mapping missing');
  await page.screenshot({path:out+'/react-typescript.png'});fs.writeFileSync(out+'/results.json',JSON.stringify({passed:true,fixtureOnly:true,request:record.requests[0],sourceHash},null,2));console.log('React/TS actual button request and hash-checked sourcemap passed.');
}finally{if(browser)await browser.close();if(child.exitCode===null)child.kill();await vite.close();await new Promise(resolve=>api.close(resolve));}
