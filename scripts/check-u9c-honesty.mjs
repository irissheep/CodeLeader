import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {build as viteBuild} from 'vite';
import {build} from 'esbuild';
import electron from 'electron';
import {chromium} from 'playwright';
import {guard,root} from './common.mjs';
import {scoreHonestyV3U9c} from '../corpus/honesty-v3-u9c.mjs';

guard();
const out=path.resolve(root,process.env.CODELEADER_U9C_OUTPUT||'.tmp/verification-u9c-metrics'),folder=path.join(out,'layout/u9c'),configFile=path.join(out,'review.json');
const manifestFile=process.env.CODELEADER_U9C_MODELS?path.join(process.env.CODELEADER_U9C_MODELS,'active-manifest.json'):path.join(root,'corpus/public/manifest.json');
if(process.env.CODELEADER_U9C_MODELS){
 const manifest=JSON.parse(await fs.readFile(manifestFile,'utf8')),projects=manifest.projects.map(p=>({id:p.id}));
 await fs.mkdir(out,{recursive:true});await fs.writeFile(path.join(out,'projects.json'),JSON.stringify(projects));
 for(const project of projects){await fs.mkdir(path.join(out,'before',project.id),{recursive:true});await fs.copyFile(path.join(process.env.CODELEADER_U9C_MODELS,project.id,'model.json'),path.join(out,'before',project.id,'model.json'));}
 const first=JSON.parse(await fs.readFile(path.join(out,'before',projects[0].id,'model.json'),'utf8'));await fs.writeFile(path.join(out,'runtime-inputs.json'),JSON.stringify({static:first,runtime:first,record:{}}));
}
const navigationOnly=process.argv.includes('--navigation');
const corpusProjects=new Set(JSON.parse(await fs.readFile(manifestFile,'utf8')).projects.map(p=>p.id));
const screenshotProjects=navigationOnly?new Set(JSON.parse(await fs.readFile(path.join(root,'tests/fixtures/u9c-review.json'),'utf8')).recommendationProjects||[]):new Set();
const projects=JSON.parse(await fs.readFile(path.join(out,'projects.json'),'utf8')).filter(p=>corpusProjects.has(p.id)&&(!navigationOnly||screenshotProjects.has(p.id)));
await fs.writeFile(configFile,JSON.stringify({output:path.relative(root,out)}));
await fs.mkdir(folder,{recursive:true});
await build({stdin:{contents:"export {collectAnalysisNotes} from './src/main/analysis-notes';",resolveDir:root},outfile:path.join(folder,'notes.cjs'),bundle:true,platform:'node',format:'cjs'});
await viteBuild({configFile:false,root:path.join(root,'src/renderer'),base:'./',build:{outDir:path.join(folder,'renderer'),emptyOutDir:true,chunkSizeWarningLimit:4000},worker:{format:'es'}});
const {collectAnalysisNotes}=await import(pathToFileURL(path.join(folder,'notes.cjs')).href);
const server=net.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve));
const env={...process.env,CODELEADER_LAYOUT_CONFIG:configFile,CODELEADER_LAYOUT_PHASE:'u9c',CODELEADER_LAYOUT_PORT:String(port),CODELEADER_ZOOM_NATIVE:'1'};delete env.ELECTRON_RUN_AS_NODE;
const log=await fs.open(path.join(folder,'window.log'),'a'),child=spawn(electron,[path.join(root,'scripts/layout-window.cjs')],{cwd:root,env,windowsHide:false,stdio:['ignore',log.fd,log.fd]});
let browser,page;const output=[];
const shot=async name=>{await page.screenshot({path:path.join(out,name)});return true;};
const closeInspector=async()=>{const close=page.locator('.inspector-close');if(await close.isVisible())await close.click();};
try{
 for(let i=0;i<80;i++){try{browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`,{timeout:1000});break;}catch{await new Promise(resolve=>setTimeout(resolve,100));}}
 if(!browser)throw Error('检查窗口没有打开');page=browser.contexts()[0].pages()[0];await page.waitForSelector('[data-view=main]');
 for(const {id} of projects){
  const model=JSON.parse(await fs.readFile(path.join(out,'before',id,'model.json'),'utf8'));
  const notes=await collectAnalysisNotes(model,async file=>{const target=await fs.realpath(path.resolve(model.root,file)),base=await fs.realpath(model.root);if(path.relative(base,target).startsWith('..'))throw Error('outside project');return fs.readFile(target,'utf8');});
  const errors=[],observed={views:[],web:[],addresses:[],partial:{text:'',rawClosed:false,screenshot:false},errors};const onError=error=>errors.push(String(error)),onConsole=message=>{if(/Uncaught|TypeError|ReferenceError/.test(message.text()))errors.push(message.text());};page.on('pageerror',onError);page.on('console',onConsole);
  const loaded=page.waitForEvent('load');await page.evaluate(project=>window.codeleader.layoutLoad({mode:'static',project}),id).catch(error=>{if(!String(error).includes('destroyed'))throw error;});await loaded;await page.waitForFunction(()=>document.querySelector('.graph-canvas')?.dataset.layoutBusy==='false');
  const dismiss=page.getByRole('button',{name:'知道了'});if(await dismiss.isVisible())await dismiss.click();
  for(const view of ['main','guide','overview']){
   const tab=page.locator(`[data-view=${view}]`);if(await tab.isEnabled())await tab.click();await page.waitForFunction(v=>document.querySelector(`[data-view="${v}"]`)?.getAttribute('aria-pressed')==='true'&&document.querySelector('.graph-canvas')?.dataset.layoutBusy==='false',view);await page.waitForTimeout(350);
   const baseline=await page.evaluate(()=>{const button=document.querySelector('[data-view-issues]');return{nodes:document.querySelectorAll('.react-flow__node').length,empty:document.querySelector('.graph-absence')?.innerText||'',text:document.body.innerText,issueCount:Number(button?.getAttribute('data-view-issues')||0),buttonCount:button?Number(button.textContent?.match(/^\s*(\d+)/)?.[1]||-1):0,buttonVisible:!!button&&button.checkVisibility({checkOpacity:true,checkVisibilityCSS:true})};});
   if(view==='guide'){const web=await page.locator('[data-web-explanation]').evaluateAll(nodes=>nodes.map(node=>({unit:node.getAttribute('data-web-explanation'),text:node.innerText})));for(const item of web)observed.web.push({...item,screenshot:await shot(`${id}-web.png`)});}
   let rows=0,allHaveLocation=true,allHaveReason=true,issueScreenshot=false;
   if(baseline.issueCount){await page.locator('[data-view-issues]').click();await page.waitForSelector('[data-view-issue-list]');const details=await page.locator('[data-view-issue-item]').evaluateAll(nodes=>nodes.map(node=>({reason:node.querySelector('p')?.textContent,location:node.querySelector('.source-link')?.textContent})));rows=details.length;allHaveLocation=details.every(row=>/:\d+$/.test(row.location||''));allHaveReason=details.every(row=>!!row.reason);issueScreenshot=await shot(`${id}-${view}-issues.png`);await closeInspector();}
   observed.views.push({view,...baseline,rows,allHaveLocation,allHaveReason,issueScreenshot});
  }
  const main=page.locator('[data-view=main]');if(await main.isEnabled())await main.click();await page.waitForFunction(()=>document.querySelector('.graph-canvas')?.dataset.layoutBusy==='false');
  await page.locator('.orientation-help > summary').click();await page.locator('.orientation-help .command-more > summary').click();await page.getByRole('button',{name:'分析详情',exact:true}).click();await page.waitForSelector('.inspector-content');await page.waitForTimeout(400);
  observed.partial={text:await page.locator('[data-partial-explanation]').innerText().catch(()=>''),rawClosed:await page.locator('.inspector-content details').evaluateAll(nodes=>{const raw=nodes.filter(n=>n.querySelector('summary')?.textContent?.startsWith('未读完整的地方'));return raw.length===1&&!raw[0].open;}),screenshot:await shot(`${id}-analysis.png`)};
  for(const note of notes.addresses){const detail=page.locator(`[data-address-details="${note.unitId}"]`);if(await detail.count()){const summary=await detail.locator('summary').textContent();await detail.locator('summary').click();observed.addresses.push({unit:note.unitId,count:Number(summary?.match(/^\s*(\d+) 处/)?.[1]||-1),text:await detail.innerText(),visible:await detail.isVisible(),screenshot:await shot(`${id}-addresses.png`)});}}
  await closeInspector();if(await page.locator('.orientation-help').evaluate(e=>e.open))await page.locator('.orientation-help > summary').click();
  if(navigationOnly&&screenshotProjects.has(id)){
   const card=page.locator('.hierarchy-application-heading').first();if(await card.count()){await card.click();await page.waitForTimeout(350);const rows=await page.locator('.inspector-content .entry-choice[data-entry-id]').evaluateAll(nodes=>nodes.slice(0,3).map(n=>({id:n.getAttribute('data-entry-id'),text:n.innerText})));observed.recommendations=rows;await shot(`${id}-recommendations.png`);if(rows.length){const entry=model.entries.find(item=>item.id===rows[0].id);await page.locator('.inspector-content .entry-choice[data-entry-id]').first().click();try{await page.waitForFunction(symbol=>[...document.querySelectorAll('.react-flow__node')].some(node=>node.getAttribute('data-id')===symbol),entry?.symbolId,{timeout:15000});observed.recommendationNavigation={ok:true,entry:entry.id,symbol:entry.symbolId,screenshot:await shot(`${id}-recommendation-opened.png`)};}catch{observed.recommendationNavigation={ok:false,entry:entry?.id,symbol:entry?.symbolId};}}await closeInspector();}
  }
  page.off('pageerror',onError);page.off('console',onConsole);const score=scoreHonestyV3U9c(model,notes,observed);output.push({project:id,score,observed});console.log(JSON.stringify({project:id,status:score.status,failures:score.failures}));
  await fs.writeFile(path.join(out,navigationOnly?'RECOMMENDATION-CHECK.json':'H-V3-U9C.json'),JSON.stringify(output,null,2));
 }
}finally{await page?.evaluate(()=>window.codeleader.reviewClose()).catch(()=>{});await browser?.close().catch(()=>{});child.kill();await log.close();}
if(output.length!==projects.length||output.some(row=>row.score.status!=='✓'||navigationOnly&&!row.observed.recommendationNavigation?.ok))process.exitCode=1;
