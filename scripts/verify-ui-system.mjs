import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {build as viteBuild} from 'vite';
import electron from 'electron';
import {chromium} from 'playwright';
import {guard,root} from './common.mjs';
import {managedPath} from './managed-path.mjs';
import {probeUI} from './ui-system-probe.mjs';
guard();
const out=managedPath(path.join(root,'.tmp/verification-u1-visual-system')),phase=process.argv.includes('--after')?'after':'before',dir=path.join(out,phase);
const read=async file=>JSON.parse(await fs.readFile(file,'utf8')),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const input=await read(path.join(root,'tests/fixtures/u1-visual-inputs.json'));
await fs.mkdir(dir,{recursive:true});
if(phase==='before'&&!await fs.stat(path.join(out,'source-before.json')).catch(()=>false)){
 const hashes={};async function save(folder){for(const entry of await fs.readdir(path.join(root,folder),{withFileTypes:true})){if(entry.isSymbolicLink())continue;const file=path.posix.join(folder,entry.name);if(entry.isDirectory())await save(file);else{const bytes=await fs.readFile(path.join(root,file));hashes[file]=sha(bytes);await fs.mkdir(path.dirname(path.join(out,'source-before',file)),{recursive:true});await fs.writeFile(path.join(out,'source-before',file),bytes);}}}
 for(const folder of ['src','runtime','analyzers'])await save(folder);
 await fs.writeFile(path.join(out,'source-before.json'),JSON.stringify(hashes,null,2));
 const baseline=path.join(root,'.tmp/verification-generalization-baseline');await fs.mkdir(path.join(out,'corpus-before'),{recursive:true});
 for(const file of ['scorecard-v4.json','frontend-scorecard.json','source-integrity.json'])await fs.copyFile(path.join(baseline,file),path.join(out,'corpus-before',file));
 const audit=await read(path.join(root,input.audit)),sessionFolder=path.join(root,'.appdata/executions',audit.session),record=await read(path.join(sessionFolder,'session.json'));
 const indexes=[];for(const file of await fs.readdir(path.join(root,'.appdata/indexes')))if(file.endsWith('.json'))indexes.push(await read(path.join(root,'.appdata/indexes',file)));
 const same=(a,b)=>a.replaceAll('\\','/').toLowerCase()===b.replaceAll('\\','/').toLowerCase();
 const runtime=indexes.filter(i=>same(i.root,input.runtimeRoot)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))[0];
 const stat=indexes.filter(i=>same(i.root,input.staticRoot)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))[0];
 if(!runtime||!stat)throw Error('Required real project index missing');
 await fs.writeFile(path.join(out,'inputs.json'),JSON.stringify({runtime,static:stat,record,sessionFolder,requestId:audit.request,operationId:audit.operationId,width:input.width,height:input.height,step:input.step}));
}
const data=await read(path.join(out,'inputs.json'));
await build({stdin:{contents:"export {buildReplay,sessionOrderEvidence} from './src/runtime/replay';",resolveDir:root},outfile:path.join(dir,'replay-tools.mjs'),bundle:true,platform:'node',format:'esm'});
const {buildReplay,sessionOrderEvidence}=await import(pathToFileURL(path.join(dir,'replay-tools.mjs')).href),request=data.record.requests.find(r=>r.id===data.requestId),model=buildReplay(request,data.record.spans,sessionOrderEvidence(data.record));
if(model.steps.length!==17)throw Error('Reference recording must preserve its original 17 steps');
await viteBuild({configFile:false,root:phase==='before'?path.join(out,'source-before/src/renderer'):path.join(root,'src/renderer'),base:'./',build:{outDir:path.join(dir,'renderer'),emptyOutDir:true,chunkSizeWarningLimit:4000},worker:{format:'es'}});
const env={...process.env,CODELEADER_UI_PHASE:phase};delete env.ELECTRON_RUN_AS_NODE;
const child=spawn(electron,[path.join(root,'scripts/ui-system-window.cjs')],{cwd:root,env,windowsHide:true,stdio:['pipe','pipe','pipe']});
let log='';child.stderr.on('data',b=>log+=b);child.stdout.on('data',b=>log+=b);
let browser;
const results={phase,width:data.width,height:data.height,recording:{session:data.record.id,request:request.id,steps:model.steps.length,historical:true},checks:[],images:[],errors:[]};
try{
 for(let i=0;i<80;i++){try{browser=await chromium.connectOverCDP('http://127.0.0.1:18149');break;}catch{await new Promise(resolve=>setTimeout(resolve,100));}}
 if(!browser)throw Error('Visual window unavailable');
 const page=browser.contexts()[0].pages()[0];page.setDefaultTimeout(15000);page.on('pageerror',error=>results.errors.push(String(error)));
 const settle=async()=>{await page.waitForFunction(()=>document.querySelectorAll('.react-flow__node').length>0&&!document.querySelector('.analysis-progress'));await page.waitForTimeout(400);};
 const image=async name=>{await settle();await page.evaluate(name=>window.codeleader.capture(name),name);results.images.push(name);};
 const view=async(level,name)=>{const direct=page.locator(`[data-view="${level}"]`);if(await direct.count())await direct.click();else{await page.locator('.command-view>summary').click();await page.locator('.command-view').getByRole('button',{name,exact:true}).click();}};
 await settle();await image('static-main');await view('overview','代码依赖');await image('dependencies');
 await page.evaluate(()=>window.codeleader.reviewMode('runtime'));await page.waitForFunction(name=>document.querySelector('.command-project strong')?.textContent===name,data.runtime.name);await settle();
 await page.waitForFunction(async id=>(await window.codeleader.execution.current())?.projectId===id,data.runtime.id);
 await page.getByRole('button',{name:'录制',exact:true}).click();await page.waitForSelector('.replay-dock');
 const op=data.record.operations.find(o=>o.id===data.operationId),opButton=page.getByRole('button',{name:`操作 ${op.number} · ${op.label}`,exact:true});
 if(phase==='after'){await page.getByRole('button',{name:'操作历史',exact:true}).click();await opButton.click();}else if(await opButton.count()&&await opButton.isVisible())await opButton.click();else{
  if(await page.locator('.execution-menu').getAttribute('open')===null)await page.locator('.execution-menu>summary').click();
  const all=page.locator('[data-request-history]');await all.locator('summary').first().click();
  const group=all.locator(`[data-operation="${op.id}"]`);await group.locator('summary').click();
  await group.getByRole('button').filter({hasText:request.method+' '+new URL(request.url).pathname}).first().click();
  if(await page.locator('.execution-menu').getAttribute('open')!==null)await page.locator('.execution-menu>summary').click();
 }
 const goto=async i=>{const button=page.locator(`.dock-segment[data-step="${i-1}"]`);if(await button.evaluate(e=>e.tagName==='BUTTON')){await button.focus();await button.press('Enter');}else await button.click();};
 await goto(data.step);if(await page.getByLabel('暂停回放',{exact:true}).count())await page.getByLabel('暂停回放',{exact:true}).click();
 if(await page.getByLabel('收起数据面板',{exact:true}).isVisible().catch(()=>false))await page.getByLabel('收起数据面板',{exact:true}).click();
 for(const selector of ['.execution-menu','.replay-dock-menu'])if(await page.locator(selector).count()&&await page.locator(selector).getAttribute('open')!==null)await page.locator(selector+'>summary').click();
 await page.evaluate(()=>document.activeElement?.blur());await page.mouse.move(10,70);
 await image('runtime-main');
 results.metrics=await page.evaluate(()=>{
  const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&r.bottom>0&&r.top<innerHeight&&r.right>0&&r.left<innerWidth&&s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity)>0&&e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true});};
  const text=[];const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);while(walker.nextNode()){const node=walker.currentNode;if(node.textContent.trim()&&node.parentElement&&!node.parentElement.closest('script,style')&&visible(node.parentElement))text.push(node.textContent.trim());}
  const clickable=[...document.querySelectorAll('button,a,summary,input,select,[role=button],[role=slider]')].filter(e=>visible(e)&&!e.matches(':disabled,[aria-disabled=true]'));
  const current=document.querySelector('.runtime-method-row.is-current')||document.querySelector('.runtime-method-row')||document.querySelector('.service-container');
  const rect=current?.getBoundingClientRect(),x=rect?rect.x+rect.width/2:innerWidth/2,y=rect?rect.y+rect.height/2:innerHeight/2;
  const containers=document.elementsFromPoint(x,y).filter(e=>{if(!e.closest('.react-flow__node'))return false;const s=getComputedStyle(e);return (s.backgroundColor!=='transparent'&&!/,\s*0\)$/.test(s.backgroundColor))||[s.borderTopWidth,s.borderRightWidth,s.borderBottomWidth,s.borderLeftWidth].some(w=>parseFloat(w)>0);}).map(e=>({tag:e.tagName,class:e.className}));
  return {clickable:clickable.length,textNodes:text.length,topbarClickable:clickable.filter(e=>e.closest('.app-titlebar')).length,nestedContainers:containers.length,nestedAt:{x,y},containers,bottomRegions:[...document.querySelectorAll('.replay-dock,.operation-strip')].filter(visible).length,text};
 });
 const currentRow=page.locator('.runtime-method-row.is-current').first();if(await currentRow.count())await currentRow.click();else await page.locator('.runtime-card-main').first().click();
 await image('runtime-data');await page.getByRole('button',{name:'源码',exact:true}).click();await page.waitForTimeout(600);await image('runtime-source');
 await page.getByLabel('收起数据面板',{exact:true}).click();await page.getByLabel('步骤走读',{exact:true}).click();await image('runtime-walkthrough');
 if(phase==='after')results.interactions=await probeUI(page,dir);
 await fs.writeFile(path.join(dir,'metrics.json'),JSON.stringify(results,null,2));
 console.log(JSON.stringify({phase,metrics:results.metrics,images:results.images,errors:results.errors}));
}catch(error){if(browser){const p=browser.contexts()[0].pages()[0];await fs.writeFile(path.join(dir,'failure.json'),JSON.stringify({error:String(error),body:await p.locator('body').innerText(),record:await p.evaluate(async()=>{const r=await window.codeleader.execution.current();return r&&{id:r.id,projectId:r.projectId,state:r.state};})},null,2));}throw error;}finally{if(browser){await browser.contexts()[0].pages()[0].evaluate(()=>window.codeleader.reviewClose()).catch(()=>{});await browser.close();}child.kill();await fs.writeFile(path.join(dir,'window.log'),log);}
