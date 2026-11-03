import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { _electron as electron } from 'playwright';
import electronPath from 'electron';
import { guard, root } from './common.mjs';
guard();
const packaged=process.argv.includes('--packaged');
const dir=path.join(root,'.tmp',packaged?'verification-packaged':'verification-dev');fs.mkdirSync(dir,{recursive:true});
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
if(packaged){env.PATH=path.join(process.env.SystemRoot,'System32');delete env.JAVA_HOME;delete env.PYTHONPATH;delete env.NODE_PATH;}
function fingerprint(folder){const result={};for(const entry of fs.readdirSync(folder,{withFileTypes:true})){const p=path.join(folder,entry.name);if(entry.isDirectory())Object.assign(result,fingerprint(p));else result[p]=crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');}return result;}
const fixtureBefore=fingerprint(path.join(root,'tests/fixtures'));
const app=await electron.launch({executablePath:packaged?path.join(root,'release/win-unpacked/CodeLeader.exe'):electronPath,args:packaged?[]:[root],env,timeout:45000});
const report={packaged,machine:{os:os.release(),cpu:os.cpus()[0].model,logicalCPUs:os.cpus().length,memoryGB:Math.round(os.totalmem()/1024**3)},runtime:null,projects:[],consoleErrors:[],measurements:[]};
const capture=async name=>{
  for(let attempt=0;attempt<4;attempt++)try {
    const base64=await app.evaluate(async({BrowserWindow})=>(await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));
    fs.writeFileSync(path.join(dir,name),Buffer.from(base64,'base64'));return;
  } catch(error) {if(attempt===3||!String(error).includes('UnknownVizError'))throw error;await new Promise(resolve=>setTimeout(resolve,200));}
};
try {
  const page=await app.firstWindow();page.on('pageerror',error=>{report.consoleErrors.push(error.stack||String(error));console.error(error.stack);});page.on('console',msg=>{if(msg.type()==='error'){report.consoleErrors.push(msg.text());console.error(msg.text());}});
  await page.waitForSelector('.welcome');await capture('welcome.png');
  report.runtime=await page.evaluate(()=>window.codeleader.runtime());
  for(const language of ['java','python']) {
    const target=path.join(root,'tests/fixtures',language);
    await page.evaluate(()=>{window._indexes=[];window._disposeIndex?.();window._disposeIndex=window.codeleader.onIndex(index=>window._indexes.push(index));window._analysisError='';window.codeleader.onError(e=>window._analysisError=e);});
    // Exercise the real open-project flow while replacing only the native dialog.
    await app.evaluate(({dialog},target)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[target]});},target);
    const started=performance.now();
    if(language==='java')await page.locator('.open-project').click();
    else {
      const cdp=await page.context().newCDPSession(page);
      for(const type of ['dragEnter','dragOver','drop'])await cdp.send('Input.dispatchDragEvent',{type,x:600,y:400,data:{items:[],files:[target],dragOperationsMask:1}});
      await cdp.detach();
    }
    await page.waitForFunction(()=>window._indexes.some(i=>['complete','partial','cancelled'].includes(i.status))||window._analysisError,{},{timeout:150000});
    const info=await page.evaluate(()=>({index:window._indexes.at(-1),error:window._analysisError}));
    assert.equal(info.error,'');assert.ok(info.index.symbols.length>5);assert.ok(info.index.relations.some(r=>r.type==='CALLS'&&r.to));
    report.projects.push({language,analysisMs:Math.round(performance.now()-started),symbols:info.index.symbols.length,relations:info.index.relations.length,status:info.index.status,diagnostics:info.index.diagnostics});
    await page.waitForSelector('.react-flow__node');await page.waitForFunction(()=>!document.querySelector('.layout-indicator'));await capture(`${language}-overview.png`);
    await page.getByRole('button',{name:language==='java'?'demo.api':'app/api',exact:false}).first().click();
    const name=language==='java'?'submit':'health';
    await page.getByRole('textbox',{name:'搜索文件与符号'}).fill(name);
    await page.locator('.symbol-item').filter({has:page.locator('strong',{hasText:new RegExp(`^${name}$`)})}).first().click();
    await page.waitForSelector('.source-panel .monaco-editor');await page.waitForFunction(()=>!document.querySelector('.layout-indicator'));await page.waitForTimeout(300);
    assert.ok(await page.locator('.react-flow__node').count()>1);
    await capture(`${language}-function.png`);
    const before=await page.locator('.react-flow__viewport').getAttribute('style');
    const edge=page.locator('.edge-label').filter({hasText:'调用'}).first();await edge.click();await page.waitForSelector('.relation-row');
    assert.ok((await page.locator('.source-file').innerText()).length>0);
    const outgoing=info.index.relations.find(r=>r.type==='CALLS'&&r.from===info.index.symbols.find(s=>s.name===name).id&&r.to);
    const nextName=info.index.symbols.find(s=>s.id===outgoing.to).name;
    await page.getByRole('textbox',{name:'搜索文件与符号'}).fill(nextName);
    await page.locator('.symbol-item strong').filter({hasText:new RegExp(`^${nextName}$`)}).first().click();
    await page.getByRole('button',{name:'后退',exact:true}).click();
    await page.waitForFunction(()=>!document.querySelector('.layout-indicator'));await page.waitForTimeout(250);
    assert.equal((await page.locator('.workspace-heading h1').innerText()),name);
    assert.equal(await page.locator('.react-flow__viewport').getAttribute('style'),before,'后退必须恢复视口');
    await capture(`${language}-restored.png`);
    if(language==='java') {
      for(const size of [{width:1920,height:1080},{width:1366,height:768}]) {
        await app.evaluate(({BrowserWindow},size)=>BrowserWindow.getAllWindows()[0].setContentSize(size.width,size.height),size);
        for(const zoom of [1,1.25,1.5]) {
          await app.evaluate(({BrowserWindow},zoom)=>BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(zoom),zoom);
          await page.waitForTimeout(180);await capture(`java-${size.width}x${size.height}-${zoom}.png`);
        }
      }
      await app.evaluate(({BrowserWindow})=>{BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1);BrowserWindow.getAllWindows()[0].setContentSize(1580,960);});
    }
    await page.waitForTimeout(350);
    await page.getByRole('button',{name:'适应画面',exact:true}).click();await page.waitForTimeout(250);
    const selected=page.locator('.react-flow__node').first();
    for(let i=0;i<30;i++) {const start=performance.now();await selected.click();await page.waitForFunction(()=>!!document.querySelector('.graph-card.is-selected'));report.measurements.push(performance.now()-start);}
    await page.getByRole('button',{name:'适应画面',exact:true}).click();
    await page.getByRole('button',{name:'关闭源码侧栏',exact:true}).click();
    await page.getByRole('textbox',{name:'搜索文件与符号'}).fill('');
  }
  // Real synthetic source, never executed: 60 functions and 120 statically resolved calls.
  const denseRoot=path.join(root,'.tmp/performance-source');fs.mkdirSync(denseRoot,{recursive:true});
  const denseSource=Array.from({length:60},(_,i)=>`def f${i}():\n    return ${i===0?Array.from({length:60},(_,j)=>`f${j}()`).join(' + '):i===1?'f0() + f2()':'f0()'}\n`).join('\n');
  fs.writeFileSync(path.join(denseRoot,'dense.py'),denseSource);
  await page.evaluate(async target=>{window._indexes=[];await window.codeleader.analyze(target);},denseRoot);
  await page.waitForFunction(()=>window._indexes.some(i=>['complete','partial'].includes(i.status)),{},{timeout:150000});
  await page.getByRole('textbox',{name:'搜索文件与符号'}).fill('f0');await page.locator('.symbol-item strong').filter({hasText:/^f0$/}).first().click();
  await page.waitForFunction(()=>!!document.querySelector('[title="展开聚合符号"]')&&!document.querySelector('.layout-indicator'));
  report.denseCollapsedNodes=await page.locator('.react-flow__node').count();await page.waitForTimeout(280);await capture('dense-aggregated.png');
  await page.getByRole('button',{name:'展开聚合符号',exact:true}).first().click();
  await page.waitForFunction(()=>document.querySelectorAll('.react-flow__node').length===60&&!document.querySelector('.layout-indicator'));
  assert.equal(await page.locator('.react-flow__edge').count(),120);
  await page.waitForTimeout(250);await capture('dense-60-nodes-120-edges.png');
  const visible=await page.evaluate(()=>{const area=document.querySelector('.graph-canvas').getBoundingClientRect();return [...document.querySelectorAll('.react-flow__node')].filter(n=>{const r=n.getBoundingClientRect();return r.left>area.left+5&&r.right<area.right-5&&r.top>area.top+40&&r.bottom<area.bottom-50;}).map(n=>n.dataset.id).slice(0,2);});
  assert.equal(visible.length,2);
  const selection=[],expansion=[];
  for(let i=0;i<30;i++) {
    const id=visible[i%2];
    const target=page.locator('.react-flow__node').and(page.locator(`[data-id="${id}"]`));
    const start=performance.now();await target.click();await page.waitForFunction(id=>[...document.querySelectorAll('.react-flow__node')].some(n=>n.dataset.id===id&&n.querySelector('.is-selected')),id);selection.push(performance.now()-start);
    const expanded=performance.now();await target.locator('.card-expand').click();await page.waitForFunction(()=>!document.querySelector('.layout-indicator'));await page.waitForTimeout(230);expansion.push(performance.now()-expanded);
  }
  const p95=values=>Math.round(values.toSorted((a,b)=>a-b)[Math.ceil(values.length*.95)-1]);
  report.dense={nodes:60,edges:120,selectionP95Ms:p95(selection),expansionP95Ms:p95(expansion),selection,expansion};
  fs.appendFileSync(path.join(denseRoot,'dense.py'),'\n# stale-index verification\n');
  assert.equal(await page.evaluate(()=>window.codeleader.checkStale()),true);
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.waitForSelector('.stale-banner');
  await page.evaluate(()=>window._indexes=[]);await page.getByRole('button',{name:'刷新索引',exact:true}).click();
  await page.waitForFunction(()=>window._indexes.some(i=>['complete','partial'].includes(i.status)),{},{timeout:150000});
  assert.equal(await page.locator('.stale-banner').count(),0);report.staleRefresh=true;
  const invalid=await page.evaluate(async file=>{try{await window.codeleader.analyze(file);return false;}catch{return true;}},path.join(root,'.tmp','does-not-exist'));assert.equal(invalid,true);report.invalidProjectRejected=true;
  // Cancellation and worker cleanup run against real analyzers, including packaged resources.
  await page.evaluate(async target=>{await window.codeleader.analyze(target);await window.codeleader.cancel();},path.join(root,'tests/fixtures/python'));
  await page.waitForTimeout(150);
  const runtime=await page.evaluate(()=>window.codeleader.runtime());assert.equal(runtime.worker,false);assert.deepEqual(runtime.children,[]);
  report.cleanup=runtime;
  assert.deepEqual(fingerprint(path.join(root,'tests/fixtures')),fixtureBefore);report.targetReadOnly=true;
  for(const folder of Object.values(runtime.managedPaths))assert.match(folder,/^D:\\/i);
  const sorted=report.measurements.toSorted((a,b)=>a-b);report.selectionP95Ms=Math.round(sorted[Math.ceil(sorted.length*.95)-1]);
  assert.deepEqual(report.consoleErrors,[]);
  await page.evaluate(target=>window.codeleader.analyze(target),path.join(root,'tests/fixtures/python'));
  report.exitChildPids=[];
  for(let attempt=0;attempt<300;attempt++){
    const runtime=await page.evaluate(()=>window.codeleader.runtime());
    if(runtime.children.length){report.exitChildPids=runtime.children;break;}
    await page.waitForTimeout(20);
  }
  assert.ok(report.exitChildPids.length>0,'退出检查必须捕获到正在运行的分析器');
} finally {
  await app.close();
  report.exitChildrenStopped=(report.exitChildPids||[]).every(pid=>{try{process.kill(pid,0);return false;}catch{return true;}});
  fs.writeFileSync(path.join(dir,'report.json'),JSON.stringify(report,null,2));
}
assert.equal(report.exitChildrenStopped,true,'关闭应用后不应遗留分析进程');
console.log(JSON.stringify({packaged,report:path.join(dir,'report.json'),projects:report.projects.map(p=>({language:p.language,status:p.status,analysisMs:p.analysisMs})),selectionP95Ms:report.selectionP95Ms}));
