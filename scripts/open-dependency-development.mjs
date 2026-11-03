import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import electron from 'electron';
import {chromium} from 'playwright';
import {guard,root} from './common.mjs';
guard();
const read=async file=>JSON.parse(await fs.readFile(file,'utf8')),review=await read(path.join(root,'tests/fixtures/r13-review.json')),out=path.join(root,review.output),model=await read(path.join(out,'after',review.deliveryProject,'model.json'));
const server=net.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve));
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;const log=await fs.open(path.join(out,'latest-development.log'),'a');
const child=spawn(electron,['.','--remote-debugging-port='+port,'--verification-size='+review.width+'x'+review.height,'--project='+model.root],{cwd:root,env,windowsHide:false,stdio:['ignore',log.fd,log.fd]});
await fs.writeFile(path.join(out,'latest-development.json'),JSON.stringify({pid:child.pid,port,project:model.root,startedAt:new Date().toISOString(),targetApplicationsStarted:false},null,2));
let browser;for(let i=0;i<60;i++){try{browser=await chromium.connectOverCDP('http://127.0.0.1:'+port,{timeout:1000});break;}catch{await new Promise(resolve=>setTimeout(resolve,200));}}
if(!browser)throw Error('Development window did not open');const page=browser.contexts()[0].pages().find(p=>p.url().includes('/renderer/index.html'));
await page.waitForFunction(()=>!!window.codeleader,undefined,{timeout:30000});
const index=await page.evaluate(()=>new Promise(resolve=>{const off=window.codeleader.onIndex(index=>{if(!['complete','partial','failed','cancelled'].includes(index.status))return;off();resolve(index);});}));
if(index.root.toLowerCase()!==model.root.toLowerCase())throw Error('Wrong project');
await page.getByRole('button',{name:'代码依赖',exact:true}).click();
await page.waitForFunction(()=>document.querySelector('[data-view=overview]')?.getAttribute('aria-pressed')==='true'&&document.querySelector('.graph-canvas')?.dataset.layoutBusy==='false'&&!!document.querySelector('.dependency-card'),undefined,{timeout:45000});await page.bringToFront();
const state=await page.evaluate(async()=>({nodes:document.querySelectorAll('.react-flow__node').length,edges:document.querySelectorAll('.react-flow__edge-path').length,bundles:document.querySelectorAll('[data-bundle-id]').length,session:(await window.codeleader.execution.current())?.id||null,errors:[...document.querySelectorAll('.graph-canvas [role=alert]')].map(e=>e.textContent)}));
try{await page.screenshot({path:path.join(out,'latest-development.png'),timeout:5000});state.screenshot='latest-development.png';}catch(error){state.screenshotUnavailable=String(error).split('\n')[0];}
await fs.writeFile(path.join(out,'latest-window.json'),JSON.stringify({root:model.root,...state,targetApplicationsStarted:false},null,2));console.log(JSON.stringify(state));
await new Promise(resolve=>browser.once('disconnected',resolve));await log.close();
