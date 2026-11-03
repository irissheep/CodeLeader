import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import electron from 'electron';
import {chromium} from 'playwright';
import {root,guard} from './common.mjs';
guard();
const folder=path.join(root,'.tmp/verification-u3-adaptive-look'),review=JSON.parse(fs.readFileSync(path.join(root,'tests/fixtures/u3-review.json'),'utf8'));
const index=JSON.parse(fs.readFileSync(path.join(folder,'corpus-before',review.startupProject,'model.json'),'utf8'));
const priorFile=path.join(root,'.tmp/verification-u2-motion/latest-app.json');
if(fs.existsSync(priorFile)){
 const old=JSON.parse(fs.readFileSync(priorFile,'utf8'));
 try{
  const browser=await chromium.connectOverCDP('http://127.0.0.1:'+old.port,{timeout:1500}),page=browser.contexts()[0].pages().find(p=>p.url().includes('/renderer/index.html'));
  if(page){const state=await page.evaluate(async()=>{const record=await window.codeleader.execution.current();return{project:document.querySelector('.command-project')?.textContent,state:record?.state,historical:record?.historical};});fs.writeFileSync(path.join(folder,'previous-development.json'),JSON.stringify(state,null,2));if(['recording','connecting'].includes(state.state)){await browser.close();throw Error('Active recording retained; latest build is ready but the window was not interrupted.');}await page.evaluate(()=>window.close()).catch(()=>{});}
  await browser.close().catch(()=>{});
 }catch(error){if(String(error).includes('Active recording'))throw error;}
}
const server=net.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve));
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const log=fs.openSync(path.join(folder,'latest-development.log'),'a');
const child=spawn(electron,['.','--remote-debugging-port='+port,'--verification-size=1548x945','--project='+index.root],{cwd:root,env,windowsHide:false,stdio:['ignore',log,log]});
fs.writeFileSync(path.join(folder,'latest-development.json'),JSON.stringify({pid:child.pid,port,project:index.root,startedAt:new Date().toISOString(),mode:'development',targetApplicationsStarted:false},null,2));
let browser;
try{
 for(let n=0;n<100;n++){try{browser=await chromium.connectOverCDP('http://127.0.0.1:'+port,{timeout:1000});break;}catch{await new Promise(resolve=>setTimeout(resolve,100));}}
 if(!browser)throw Error('Development window did not open');
 const page=browser.contexts()[0].pages().find(p=>p.url().includes('/renderer/index.html'))||browser.contexts()[0].pages()[0];
 await page.waitForFunction(()=>!!document.querySelector('[data-view=main]'),undefined,{timeout:30000});
 await page.waitForFunction(()=>document.querySelector('.graph-canvas')?.dataset.layoutBusy==='false'&&document.querySelectorAll('.react-flow__node').length>0,undefined,{timeout:30000});
 await page.waitForTimeout(700);
 const state=await page.evaluate(async()=>({project:document.querySelector('.command-project')?.textContent,view:document.querySelector('[data-view][aria-pressed=true]')?.getAttribute('data-view'),nodes:[...document.querySelectorAll('.react-flow__node')].map(n=>({id:n.dataset.id,name:n.querySelector('.service-heading strong,.card-name')?.textContent})),session:(await window.codeleader.execution.current())?.id,playback:!!document.querySelector('.replay-dock'),url:!!document.querySelector('.execution-page'),layoutErrors:[...document.querySelectorAll('.graph-canvas [role=alert]')].map(e=>e.textContent)}));
 await page.screenshot({path:path.join(folder,'latest-development.png')});fs.writeFileSync(path.join(folder,'latest-window.json'),JSON.stringify(state,null,2));console.log(JSON.stringify({pid:child.pid,port,...state}));
}finally{await browser?.close().catch(()=>{});}
await new Promise((resolve,reject)=>{child.once('exit',resolve);child.once('error',reject);});fs.closeSync(log);
