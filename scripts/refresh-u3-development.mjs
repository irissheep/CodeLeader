import fs from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';
import {root,guard} from './common.mjs';
guard();
const folder=path.join(root,'.tmp/verification-u3-adaptive-look'),info=JSON.parse(await fs.readFile(path.join(folder,'latest-development.json'),'utf8'));
const browser=await chromium.connectOverCDP('http://127.0.0.1:'+info.port);
try{
 const page=browser.contexts()[0].pages().find(p=>p.url().includes('/renderer/index.html'));
 const record=await page.evaluate(()=>window.codeleader.execution.current());if(record&&['recording','connecting'].includes(record.state))throw Error('Active recording retained; did not refresh');
 await page.reload();await page.waitForFunction(()=>!!document.querySelector('[data-view=main]')&&document.querySelector('.graph-canvas')?.dataset.layoutBusy==='false'&&document.querySelectorAll('.react-flow__node').length>0,undefined,{timeout:30000});await page.waitForTimeout(700);
 const state=await page.evaluate(async()=>{const page=document.querySelector('.execution-page');return{project:document.querySelector('.command-project')?.textContent,view:document.querySelector('[data-view][aria-pressed=true]')?.getAttribute('data-view'),nodes:[...document.querySelectorAll('.react-flow__node')].map(n=>({id:n.dataset.id,name:n.querySelector('.service-heading strong,.card-name')?.textContent})),session:(await window.codeleader.execution.current())?.id||null,playback:!!document.querySelector('.replay-dock'),pageVisible:!!page?.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}),targetApplicationsStarted:false,layoutErrors:[...document.querySelectorAll('.graph-canvas [role=alert]')].map(e=>e.textContent),assets:[...document.scripts].map(s=>s.src).filter(Boolean)};});
 await fs.writeFile(path.join(folder,'latest-window.json'),JSON.stringify(state,null,2));
 await page.bringToFront();
 try{await page.screenshot({path:path.join(folder,'latest-development.png'),timeout:10000});state.screenshot='latest-development.png';}catch(error){state.screenshotError=String(error);await fs.rename(path.join(folder,'latest-development.png'),path.join(folder,'latest-development-before-refresh.png')).catch(()=>{});}
 await fs.writeFile(path.join(folder,'latest-window.json'),JSON.stringify(state,null,2));console.log(JSON.stringify(state));
}finally{await browser.close();}
