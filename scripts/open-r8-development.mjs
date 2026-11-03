import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import electron from 'electron';
import {chromium} from 'playwright';
import {root,guard} from './common.mjs';
guard();
const folder=path.join(root,'.tmp/verification-r8-honest-states'),review=JSON.parse(fs.readFileSync(path.join(root,'tests/fixtures/r8-review.json'),'utf8'));
const index=JSON.parse(fs.readFileSync(path.join(folder,'corpus-after',review.startupProject,'model.json'),'utf8'));
const previous=[path.join(folder,'latest-development.json'),path.join(root,'.tmp/verification-u3-adaptive-look/latest-development.json')].find(file=>fs.existsSync(file));
if(previous){const old=JSON.parse(fs.readFileSync(previous,'utf8'));let browser;try{
 browser=await chromium.connectOverCDP('http://127.0.0.1:'+old.port,{timeout:1500});const page=browser.contexts()[0].pages().find(p=>p.url().includes('/dist/renderer/index.html'));
 if(page){const record=await page.evaluate(()=>window.codeleader.execution.current());if(record&&['recording','connecting'].includes(record.state))throw Error('Active recording retained; development window was not interrupted');await page.evaluate(()=>window.close()).catch(()=>{});}
 }catch(error){if(String(error).includes('Active recording'))throw error;}finally{await browser?.close().catch(()=>{});}}
const server=net.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve));
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;const log=fs.openSync(path.join(folder,'latest-development.log'),'a');
const child=spawn(electron,['.','--remote-debugging-port='+port,'--verification-size=1564x954','--project='+index.root],{cwd:root,env,windowsHide:false,stdio:['ignore',log,log]});
fs.writeFileSync(path.join(folder,'latest-development.json'),JSON.stringify({pid:child.pid,port,project:index.root,startedAt:new Date().toISOString(),mode:'development',targetApplicationsStarted:false},null,2));
let browser;try{
 for(let n=0;n<100;n++){try{browser=await chromium.connectOverCDP('http://127.0.0.1:'+port,{timeout:1000});break;}catch{await new Promise(r=>setTimeout(r,200));}}
 if(!browser)throw Error('Development window did not open');const page=browser.contexts()[0].pages().find(p=>p.url().includes('/renderer/index.html'));
 await page.waitForFunction(()=>!!document.querySelector('[data-address-explanation]'),undefined,{timeout:45000});
 const main=await page.evaluate(async()=>{const notes=await window.codeleader.analysisNotes();let wrongProject=false,wrongContext=false;try{await window.codeleader.analysisNotes('not-current');}catch{wrongProject=true;}try{await window.codeleader.analysisNotes(notes.projectId,'expired');}catch{wrongContext=true;}return{project:document.querySelector('.command-project')?.textContent,notes:{web:notes.web.length,addresses:notes.addresses.map(n=>({count:n.count,variables:n.calls.flatMap(c=>c.variables.map(v=>({name:v.name,state:v.state})))})),partial:notes.partial.length,unread:notes.unreadFiles.length},wrongProjectRejected:wrongProject,wrongContextRejected:wrongContext,session:(await window.codeleader.execution.current())?.id||null,playback:!!document.querySelector('.replay-dock'),pageVisible:!!document.querySelector('.execution-page')?.checkVisibility(),width:innerWidth,height:innerHeight};});
 await page.getByRole('button',{name:'部分分析',exact:true}).click();await page.waitForSelector('[data-partial-explanation]');main.partialPanel=await page.locator('[data-partial-explanation]').innerText();
 await page.bringToFront();try{await page.screenshot({path:path.join(folder,'latest-development.png'),timeout:5000});}catch{main.screenshotUnavailable=true;}
 await page.locator('.inspector-close').click();const target=page.locator('[data-address-explanation]');await target.hover();await page.waitForSelector('.address-examples');main.hoverVisible=await page.locator('.address-examples').isVisible();
 await page.locator('.address-examples .explanation-evidence button').first().click();await page.waitForTimeout(400);main.sourceOpened=(await page.locator('.inspector').innerText()).includes('Main.vue');
 await page.locator('.inspector-close').click();await page.mouse.move(10,10);fs.writeFileSync(path.join(folder,'latest-window.json'),JSON.stringify(main,null,2));console.log(JSON.stringify({project:main.project,notes:main.notes,wrongProjectRejected:main.wrongProjectRejected,wrongContextRejected:main.wrongContextRejected,session:main.session,sourceOpened:main.sourceOpened}));
}finally{await browser?.close().catch(()=>{});}
