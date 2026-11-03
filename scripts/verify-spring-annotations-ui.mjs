import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import electron from 'electron';
import {chromium} from 'playwright';
import {root,guard} from './common.mjs';
guard();
const out=path.join(root,'.tmp/verification-r11-spring-annotations'),read=async f=>JSON.parse(await fs.readFile(f,'utf8')),review=await read(path.join(root,'tests/fixtures/r11-review.json'));
const metadata=path.join(out,'latest-development.json'),prior=await read(metadata).catch(()=>read(path.join(root,review.previousDevelopment)));
let browser,child,log,port=prior.port;
try{browser=await chromium.connectOverCDP('http://127.0.0.1:'+port,{timeout:1500});}catch{}
if(!browser){
 const server=net.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));port=server.address().port;await new Promise(resolve=>server.close(resolve));
 const startup=await read(path.join(out,'after',review.returnProject,'model.json')),env={...process.env};delete env.ELECTRON_RUN_AS_NODE;log=await fs.open(path.join(out,'development.log'),'a');
 child=spawn(electron,['.','--remote-debugging-port='+port,'--verification-size=1564x954','--project='+startup.root],{cwd:root,env,windowsHide:false,stdio:['ignore',log.fd,log.fd]});
 for(let n=0;n<100;n++){try{browser=await chromium.connectOverCDP('http://127.0.0.1:'+port,{timeout:1000});break;}catch{await new Promise(r=>setTimeout(r,200));}}
 if(!browser)throw Error('Development window did not open');
}
try{
 await fs.writeFile(metadata,JSON.stringify({pid:child?.pid||prior.pid,port,startedAt:new Date().toISOString(),targetApplicationsStarted:false},null,2));
 const page=browser.contexts()[0].pages().find(p=>p.url().includes('/renderer/index.html'));if(!page)throw Error('Renderer missing');
 const record=await page.evaluate(()=>window.codeleader.execution.current());if(record&&['recording','connecting'].includes(record.state))throw Error('Active recording retained; static review did not interrupt it');
 await page.reload();await page.bringToFront();const errors=[];page.on('pageerror',e=>errors.push(String(e)));
 const screenshot=async name=>{try{await page.screenshot({path:path.join(out,name+'.png'),timeout:5000});return{file:name+'.png'};}catch(error){return{unavailable:String(error).split('\n')[0]};}};
 const open=async project=>{const model=await read(path.join(out,'after',project,'model.json'));return page.evaluate(async root=>{
  const previous=await new Promise(resolve=>{const off=window.codeleader.onIndex(index=>{off();resolve(index.createdAt);});});
  return new Promise((resolve,reject)=>{const off=window.codeleader.onIndex(index=>{if(index.createdAt===previous||index.root.toLowerCase()!==root.toLowerCase()||!['complete','partial','failed','cancelled'].includes(index.status))return;off();if(!index.entries)return reject(Error('Current analysis has no entry results'));resolve({root:index.root,version:index.versions.rules,status:index.status,http:index.entries.filter(e=>e.kind==='http').length});});window.codeleader.analyze(root).catch(e=>{off();reject(e);});});
 },model.root);};
 let project;const results=process.argv.includes('--resume')?(await read(path.join(out,'ui-progress.json'))).results:[];
 for(const item of review.cases){if(results.some(r=>r.project===item.project&&r.label.startsWith(item.expected)))continue;if(project!==item.project){await open(item.project);project=item.project;}
  const entry=await page.evaluate(async item=>{const index=await new Promise(resolve=>{const off=window.codeleader.onIndex(value=>{off();resolve(value);});}),entry=index.entries.find(e=>e.owner===item.owner&&index.symbols.find(s=>s.id===e.symbolId)?.name===item.method);if(!entry)throw Error('Missing source entry');return{id:entry.id,group:entry.group,aliases:entry.pathEvidence.aliases||[],evidence:entry.pathEvidence.basis};},item);
  const guide=page.getByRole('button',{name:'接口导览',exact:true});if(await guide.isEnabled())await guide.click();
  const card=page.locator(`[data-id=${JSON.stringify('entry-group:'+entry.group)}] .card-accessible`);await card.waitFor({timeout:30000});await card.press('Enter');
  const button=page.locator(`.inspector [data-entry-id=${JSON.stringify(entry.id)}] .entry-route`);await button.waitFor({timeout:30000});await button.scrollIntoViewIfNeeded();
  const label=(await button.innerText()).replace(/\s+/g,' '),title=await button.getAttribute('title');if(!label.includes(item.expected)||label.includes('REQUEST')||item.alias&&!title.includes(item.alias))throw Error('Incorrect visible route: '+label);
  await button.hover();results.push({project:item.project,entry:entry.id,label,title,aliases:entry.aliases,evidence:entry.evidence,screenshot:await screenshot(item.file),disclosedRegression:item.project.startsWith('blind-')});
  await fs.writeFile(path.join(out,'ui-progress.json'),JSON.stringify({results,errors,targetApplicationsStarted:false},null,2));
 }
 const delivery=await open(review.returnProject),main=page.getByRole('button',{name:'项目主干',exact:true});if(await main.isEnabled())await main.click();await page.bringToFront();const finalScreenshot=await screenshot('latest-development');
 await fs.writeFile(metadata,JSON.stringify({pid:child?.pid||prior.pid,port,project:delivery.root,startedAt:new Date().toISOString(),targetApplicationsStarted:false},null,2));
 await fs.writeFile(path.join(out,'ui.json'),JSON.stringify({results,delivery,finalScreenshot,errors,targetApplicationsStarted:false},null,2));if(errors.length)throw Error('Renderer errors: '+errors.join('; '));
 console.log('Native route labels and aliases passed; latest static development window remains open');
 await new Promise(resolve=>browser.once('disconnected',resolve));
}finally{await browser?.close().catch(()=>{});await log?.close();}
