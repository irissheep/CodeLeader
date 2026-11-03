import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import electron from 'electron';
import {chromium} from 'playwright';
import {root,guard} from './common.mjs';
guard();
const out=path.join(root,'.tmp/verification-r10-frontend-addresses'),read=async f=>JSON.parse(await fs.readFile(f,'utf8')),review=await read(path.join(root,'tests/fixtures/r10-review.json')),model=await read(path.join(out,'after',review.project,'model.json'));
const metadata=path.join(out,'latest-development.json'),prior=await read(metadata).catch(()=>read(path.join(root,review.previousDevelopment)));
let old;
try{old=await chromium.connectOverCDP('http://127.0.0.1:'+prior.port,{timeout:1500});const page=old.contexts()[0].pages().find(p=>p.url().includes('/renderer/index.html'));if(page){const record=await page.evaluate(()=>window.codeleader.execution.current());if(record&&['recording','connecting'].includes(record.state))throw Error('Active recording retained');await page.evaluate(()=>window.close()).catch(()=>{});}}
catch(e){if(String(e).includes('Active recording'))throw e;}finally{await old?.close().catch(()=>{});}
const server=net.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve));
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;const log=await fs.open(path.join(out,'development.log'),'a'),child=spawn(electron,['.','--remote-debugging-port='+port,'--verification-size=1564x954','--project='+model.root],{cwd:root,env,windowsHide:false,stdio:['ignore',log.fd,log.fd]});
await fs.writeFile(metadata,JSON.stringify({pid:child.pid,port,project:model.root,startedAt:new Date().toISOString(),targetApplicationsStarted:false},null,2));
const openOnly=process.argv.includes('--open-only');if(!openOnly)child.unref();
let browser;for(let n=0;n<100;n++){try{browser=await chromium.connectOverCDP('http://127.0.0.1:'+port,{timeout:1000});break;}catch{await new Promise(r=>setTimeout(r,200));}}if(!browser)throw Error('Development window did not open');
try{
 const page=browser.contexts()[0].pages().find(p=>p.url().includes('/renderer/index.html'));if(!page)throw Error('Renderer missing');
 const errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.waitForFunction(()=>document.querySelector('[data-address-explanation]')?.textContent.includes('被注释'),undefined,{timeout:60000});await page.locator('.backend-choice > button').waitFor();if(await page.getByRole('button',{name:'用户指定 · 更改',exact:true}).count()){await page.getByRole('button',{name:'用户指定 · 更改',exact:true}).click();await page.getByRole('button',{name:'撤销指定',exact:true}).click();}await page.getByRole('button',{name:'指定后端',exact:true}).waitFor();await page.bringToFront();
 const shot=name=>page.screenshot({path:path.join(out,name+'.png')}),stored=()=>page.evaluate(()=>window.codeleader.loadView()),edgeId=model.frontendLinks.units.find(u=>u.kind==='cross-unit').id;
 const edge=()=>page.evaluate(id=>{const g=[...document.querySelectorAll('.react-flow__edge')].find(e=>e.dataset.id===id),p=g?.querySelector('.react-flow__edge-path');return{exists:!!p,dash:p?.style.strokeDasharray||'',path:p?.getAttribute('d')||''};},edgeId);
 if(openOnly){
  await page.bringToFront();await shot('latest-development');const state={project:model.root,text:await page.locator('[data-address-explanation]').innerText(),edge:await edge(),view:await stored(),session:(await page.evaluate(()=>window.codeleader.execution.current()))?.id||null,targetApplicationsStarted:false};
  await fs.writeFile(path.join(out,'delivery-window.json'),JSON.stringify(state,null,2));console.log('Latest development window open, target applications not started');await new Promise(resolve=>child.once('exit',resolve));
 }else{
 const initial={text:await page.locator('[data-address-explanation]').innerText(),edge:await edge(),view:await stored()};await shot('manual-before');
 await page.getByRole('button',{name:'指定后端',exact:true}).click();await page.getByRole('dialog',{name:'指定后端'}).waitFor();
 const emptyAddress=await page.getByRole('textbox',{name:'后端地址',exact:true}).inputValue(),hasCandidates=await page.locator('.backend-target-popup details summary').count();let candidate=null;if(hasCandidates){await page.locator('.backend-target-popup details summary').click();candidate=await page.locator('.backend-address-option').first().innerText();}await shot('manual-candidates');
 await page.evaluate(()=>{window.__r10Nodes=new Map([...document.querySelectorAll('.react-flow__node')].map(n=>[n.dataset.id,n]));window.__r10Frames=[];window.__r10Sampling=true;const frame=()=>{if(!window.__r10Sampling)return;const nodes=[...document.querySelectorAll('.react-flow__node')];window.__r10Frames.push({nodes:nodes.length,rebuilt:nodes.filter(n=>window.__r10Nodes.has(n.dataset.id)&&window.__r10Nodes.get(n.dataset.id)!==n).length,hidden:nodes.filter(n=>getComputedStyle(n).visibility==='hidden'||getComputedStyle(n).opacity==='0').length,emptyPaths:[...document.querySelectorAll('.react-flow__edge-path')].filter(p=>!p.getAttribute('d')).length});requestAnimationFrame(frame);};requestAnimationFrame(frame);});
 await page.locator('.backend-target-popup > .button').first().click();await page.waitForFunction(async()=>Object.keys((await window.codeleader.loadView())?.frontendTargets||{}).length>0);await page.getByRole('button',{name:'用户指定 · 更改',exact:true}).waitFor();await shot('manual-after');
 const chosen={edge:await edge(),view:await stored(),nodes:await page.evaluate(()=>{window.__r10Sampling=false;return{frames:window.__r10Frames,identity:[...window.__r10Nodes].map(([id,n])=>({id,same:document.querySelector(`.react-flow__node[data-id="${CSS.escape(id)}"]`)===n}))};})};
 await page.reload();await page.getByRole('button',{name:'用户指定 · 更改',exact:true}).waitFor({timeout:30000});await page.waitForFunction(id=>[...document.querySelectorAll('.react-flow__edge')].some(e=>e.dataset.id===id&&e.querySelector('.react-flow__edge-path')?.getAttribute('d')),edgeId);const restored={edge:await edge(),view:await stored()};
 await page.getByRole('button',{name:'用户指定 · 更改',exact:true}).click();await page.getByRole('button',{name:'撤销指定',exact:true}).click();await page.waitForFunction(async()=>Object.keys((await window.codeleader.loadView())?.frontendTargets||{}).length===0);const undone={edge:await edge(),view:await stored()};await shot('manual-undone');
 let addressChoice={executed:false,reason:'没有用户提供的地址，且该项目未明确填写后端端口，不填入任何推测值'};
 if(hasCandidates){await page.getByRole('button',{name:'指定后端',exact:true}).click();await page.locator('.backend-target-popup details summary').click();await page.locator('.backend-address-option').first().click();const filled=await page.getByRole('textbox',{name:'后端地址',exact:true}).inputValue(),beforeApply=await edge();await page.getByRole('button',{name:'应用地址',exact:true}).click();await page.waitForFunction(async()=>Object.values((await window.codeleader.loadView())?.frontendTargets||{}).some(c=>c.address));addressChoice={executed:true,filled,beforeApply,after:await edge(),view:await stored()};await shot('manual-address');await page.getByRole('button',{name:'用户指定 · 更改',exact:true}).click();await page.getByRole('button',{name:'撤销指定',exact:true}).click();await page.waitForFunction(async()=>Object.keys((await window.codeleader.loadView())?.frontendTargets||{}).length===0);}
 let wrongProject=false;try{await page.evaluate(()=>window.codeleader.loadView('not-current'));}catch{wrongProject=true;}
 const notes=await page.evaluate(()=>window.codeleader.analysisNotes()),result={initial,candidate,emptyAddress,chosen,restored,undone,addressChoice,wrongProjectRejected:wrongProject,sourceUnknownAfterChoice:notes.addresses.map(n=>({count:n.count,summary:n.summary})),errors,targetApplicationsStarted:false};
 if(!initial.edge.dash||chosen.edge.dash||!undone.edge.dash||!restored.edge.exists||emptyAddress||!wrongProject||chosen.nodes.identity.some(n=>!n.same)||chosen.nodes.frames.some(f=>f.rebuilt||f.hidden||f.emptyPaths)||errors.length)throw Error('Native UI validation failed: '+JSON.stringify(result));
 await fs.writeFile(path.join(out,'native-ui.json'),JSON.stringify(result,null,2));console.log('Native manual target, restore, undo, empty address and DOM identity passed; address-input GUI executed:',addressChoice.executed);
 }
}finally{await browser.close();await log.close();}
