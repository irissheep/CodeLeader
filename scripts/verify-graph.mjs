import {validationInput,requireValidationInputs} from './verification-input.mjs';
requireValidationInputs();
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright';
import electronPath from 'electron';
import { guard, root } from './common.mjs';
guard();
const baseline=process.argv.includes('--baseline');
const output=path.join(root,'.tmp/verification-graph-refinement');fs.mkdirSync(output,{recursive:true});
const target=validationInput(import.meta.url,'v0');assert.ok(fs.existsSync(target),'真实对照项目不可用');
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const conditions=[{width:1564,height:951,scale:1},{width:1366,height:768,scale:1},{width:1564,height:951,scale:1.25},{width:1564,height:951,scale:1.5},{width:1366,height:768,scale:1.25},{width:1366,height:768,scale:1.5}];
const report=[];
for(const condition of process.argv.includes('--quick')?conditions.slice(0,1):conditions){
  const app=await electron.launch({executablePath:electronPath,args:[root,`--force-device-scale-factor=${condition.scale}`],env});
  const label=`${baseline?'before':'after'}-${condition.width}x${condition.height}-${condition.scale*100}`;
  try{
    await app.evaluate(({BrowserWindow},size)=>BrowserWindow.getAllWindows()[0].setSize(size.width,size.height),condition);
    const page=await app.firstWindow();page.setDefaultTimeout(60000);
    await page.waitForSelector('.welcome');
    await page.evaluate(()=>{window._index=undefined;window.codeleader.onIndex(value=>window._index=value);});
    await page.evaluate(target=>window.codeleader.analyze(target),target);
    await page.waitForFunction(()=>window._index&&['complete','partial','failed'].includes(window._index.status),null,{timeout:120000});
    await page.waitForFunction(()=>document.querySelectorAll('.react-flow__node').length>0&&!document.querySelector('.layout-indicator'));
    await page.waitForTimeout(500);
    const index=await page.evaluate(()=>window._index);
    const hash=crypto.createHash('sha256').update(JSON.stringify(index.files.map(f=>[f.path,f.hash]).sort())).digest('hex');
    const dataFile=path.join(output,'baseline-index.json');
    if(baseline&&!fs.existsSync(dataFile))fs.writeFileSync(dataFile,JSON.stringify(index,null,2));
    if(!baseline){const old=JSON.parse(fs.readFileSync(dataFile,'utf8'));assert.deepEqual(index.files.map(f=>[f.path,f.hash]).sort(),old.files.map(f=>[f.path,f.hash]).sort(),'对照项目内容已变化');}
    const capture=async suffix=>{
      const png=await app.evaluate(async({BrowserWindow})=>(await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));
      fs.writeFileSync(path.join(output,`${label}-${suffix}.png`),Buffer.from(png,'base64'));
    };
    await capture('overview');
    const actual=await app.evaluate(({BrowserWindow,screen})=>({bounds:BrowserWindow.getAllWindows()[0].getBounds(),displayScale:screen.getPrimaryDisplay().scaleFactor}));
    const metrics=await page.evaluate(()=>({dpr:devicePixelRatio,client:[innerWidth,innerHeight],nodes:document.querySelectorAll('.react-flow__node').length,edges:document.querySelectorAll('.react-flow__edge').length,viewport:document.querySelector('.react-flow__viewport')?.getAttribute('style'),modal:!!document.querySelector('.modal-backdrop')}));
    if(condition.scale===1&&condition.width===1564){
      await page.locator('.module-item').filter({hasText:validationInput(import.meta.url,'v1')}).first().click();
      await page.waitForFunction(()=>!document.querySelector('.layout-indicator'));await page.waitForTimeout(500);await capture('module');
      const symbol=index.symbols.filter(s=>s.kind==='method'||s.kind==='function').sort((a,b)=>index.relations.filter(r=>r.type==='CALLS'&&(r.from===b.id||r.to===b.id)).length-index.relations.filter(r=>r.type==='CALLS'&&(r.from===a.id||r.to===a.id)).length)[0];
      await page.getByRole('textbox',{name:'搜索文件与符号'}).fill(symbol.name);
      await page.locator('.symbol-item').filter({hasText:symbol.name}).first().click();
      await page.waitForFunction(()=>!document.querySelector('.layout-indicator'));await page.waitForTimeout(500);await capture('function');
      fs.writeFileSync(path.join(output,`${baseline?'before':'after'}-function.json`),JSON.stringify({id:symbol.id,name:symbol.name}));
    }
    report.push({condition,actual,metrics,hash,modules:new Set(index.files.map(f=>f.module)).size,files:index.files.length,symbols:index.symbols.length,relations:index.relations.length});
    console.log(label,JSON.stringify(report.at(-1)));
  }finally{await app.close();}
}
fs.writeFileSync(path.join(output,`${baseline?'before':'after'}${process.argv.includes('--quick')?'-preview':''}-conditions.json`),JSON.stringify(report,null,2));
