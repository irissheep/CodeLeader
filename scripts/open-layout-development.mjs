import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import electron from 'electron';
import {chromium} from 'playwright';
import {guard,root} from './common.mjs';
guard();
const read=async file=>JSON.parse(await fs.readFile(file,'utf8')),config=await read(path.resolve(root,process.argv.find(a=>a.startsWith('--review-config='))?.slice('--review-config='.length)||'tests/fixtures/u4-review.json')),out=path.join(root,config.output),model=await read(path.join(out,'after',config.deliveryProject,'model.json'));
// Close only the previous tool-owned, idle development window. Active recording is left alone.
try{
 const previous=await read(path.join(root,config.previous||'.tmp/verification-r13-dependency-routing','latest-development.json'));
 const old=await chromium.connectOverCDP('http://127.0.0.1:'+previous.port,{timeout:1200}),page=old.contexts()[0].pages().find(p=>p.url().includes('/codeleader/dist/renderer/'));
 if(page){const record=await page.evaluate(()=>window.codeleader.execution.current());if(!record||!['connecting','recording'].includes(record.state))await page.close().catch(()=>{});}
 await old.close().catch(()=>{});
}catch{}
const server=net.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve));
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;const log=await fs.open(path.join(out,'latest-development.log'),'a');
const child=spawn(electron,['.','--remote-debugging-port='+port,'--verification-size='+config.windows[0].join('x'),'--project='+model.root],{cwd:root,env,windowsHide:false,stdio:['ignore',log.fd,log.fd]});
await fs.writeFile(path.join(out,'latest-development.json'),JSON.stringify({pid:child.pid,port,project:model.root,startedAt:new Date().toISOString(),targetApplicationsStarted:false},null,2));
let browser;for(let i=0;i<60;i++){try{browser=await chromium.connectOverCDP('http://127.0.0.1:'+port,{timeout:1000});break;}catch{await new Promise(resolve=>setTimeout(resolve,200));}}
if(!browser)throw Error('Development window unavailable');
const page=browser.contexts()[0].pages().find(p=>p.url().includes('/renderer/index.html'));await page.waitForFunction(()=>!!window.codeleader);
const index=await page.evaluate(()=>new Promise(resolve=>{const off=window.codeleader.onIndex(index=>{if(!['complete','partial','failed','cancelled'].includes(index.status))return;off();resolve(index);});}));
if(index.root.toLowerCase()!==model.root.toLowerCase())throw Error('Wrong project');
const view=config.deliveryView||'guide',button=page.locator(`[data-view=${view}]`);if(await button.isEnabled())await button.click();await page.waitForFunction(view=>document.querySelector(`[data-view=${view}]`)?.getAttribute('aria-pressed')==='true'&&document.querySelector('.graph-canvas')?.dataset.layoutBusy==='false',view);await page.waitForTimeout(500);await page.bringToFront();
const state=await page.evaluate(async()=>({view:document.querySelector('[data-view][aria-pressed=true]')?.getAttribute('data-view'),modules:document.querySelectorAll('[data-module-block]').length,nodes:document.querySelectorAll('.react-flow__node').length,orientation:document.querySelector('.graph-canvas')?.getAttribute('data-dependency-lanes'),routes:[...document.querySelectorAll('.entry-route')].map(e=>e.textContent),session:(await window.codeleader.execution.current())?.id||null,viewport:{width:innerWidth,height:innerHeight}}));
try{await page.screenshot({path:path.join(out,'latest-development.png')});}catch(error){state.screenshotUnavailable=String(error).split('\n')[0];}
await fs.writeFile(path.join(out,'latest-window.json'),JSON.stringify({root:model.root,...state,targetApplicationsStarted:false},null,2));console.log(JSON.stringify(state));
await new Promise(resolve=>browser.once('disconnected',resolve));await log.close();
