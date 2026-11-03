import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright';
import electronPath from 'electron';
import { guard, root } from './common.mjs';
import { clickGraphEdge } from './browser-graph.mjs';
guard();
const directory=path.join(root,process.argv.includes('--main-flow')?'.tmp/verification-main-flow':process.argv.includes('--canvas')?'.tmp/verification-canvas-entry':process.argv.includes('--graph')?'.tmp/verification-graph-refinement':'.tmp/verification-dev');fs.mkdirSync(directory,{recursive:true});
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({executablePath:electronPath,args:[root],env});
const results=[];
try {
  const page=await app.firstWindow();await page.waitForSelector('.welcome');
  await page.evaluate(()=>{window._index=undefined;window.codeleader.onIndex(value=>window._index=value);});
  for(const language of ['java','python']) {
    await page.evaluate(async target=>{window._index=undefined;await window.codeleader.analyze(target);},path.join(root,'tests/fixtures',language));
    await page.waitForFunction(()=>window._index&&['complete','partial'].includes(window._index.status));
    const index=await page.evaluate(()=>window._index);const name=language==='java'?'submit':'health';
    const start=index.symbols.find(s=>s.name===name);assert.ok(start);
    await page.keyboard.press('Control+k');await page.getByRole('textbox',{name:'搜索文件与符号'}).fill(name);
    await page.locator('.symbol-item').and(page.getByTitle(start.qualifiedName,{exact:true})).click();
    await page.waitForFunction(()=>!document.querySelector('.layout-indicator'));
    await clickGraphEdge(page,page.locator('.react-flow__edge').first());
    await page.waitForSelector('.relation-row');
    const qualified=await page.locator('.relation-row strong').first().innerText();
    if(process.argv.includes('--graph')||process.argv.includes('--canvas')||process.argv.includes('--main-flow')){
      await page.waitForTimeout(260);
      const png=await app.evaluate(async({BrowserWindow})=>(await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));
      fs.writeFileSync(path.join(directory,`ordinary-${language}.png`),Buffer.from(png,'base64'));
    }
    const target=index.symbols.find(s=>s.signature===qualified||s.qualifiedName===qualified);assert.ok(target);
    await page.locator('.source-link').first().click();await page.waitForSelector('.source-evidence');
    await page.waitForTimeout(120);
    await page.locator('.monaco-editor textarea').first().focus();await page.keyboard.press('Control+Enter');
    await page.waitForFunction(id=>[...document.querySelectorAll('.react-flow__node')].some(n=>n.dataset.id===id&&n.querySelector('.is-focus')),target.id);
    await page.getByRole('button',{name:'后退',exact:true}).click();
    await page.waitForFunction(id=>[...document.querySelectorAll('.react-flow__node')].some(n=>n.dataset.id===id&&n.querySelector('.is-focus')),start.id);
    results.push({language,from:name,target:target.id,sourceSelectionToGraph:true,backRestored:true});
  }
} finally {await app.close();}
fs.writeFileSync(path.join(directory,'source-navigation.json'),JSON.stringify(results,null,2));
console.log(JSON.stringify(results));
