import {validationInput,requireValidationInputs} from './verification-input.mjs';
requireValidationInputs();
import fs from 'node:fs';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright';
import electronPath from 'electron';
import {guard,root,run} from './common.mjs';
guard();const out=root+'/.tmp/verification-runtime-flow',core=JSON.parse(fs.readFileSync(out+'/core-verification.json','utf8'));
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const child=spawn(electronPath,[root,validationInput(import.meta.url,'v0'),'--remote-debugging-port=18098','--verification-size=1366x768'],{env,stdio:'ignore',windowsHide:false});let browser,page;
try{
  for(let i=0;i<100;i++){try{browser=await chromium.connectOverCDP('http://127.0.0.1:18098');break;}catch{await new Promise(r=>setTimeout(r,100));}}
  page=browser.contexts()[0].pages()[0];await page.waitForFunction(()=>!!document.querySelector('.command-project')&&!document.querySelector('.analysis-progress'),null,{timeout:90000});
  await page.getByTitle('真实页面与请求录制').click();await page.getByText('已有真实记录',{exact:true}).click();await page.locator(`[data-session-id="${core.sessionId}"]`).click();await page.getByLabel('本次请求',{exact:true}).selectOption(core.firstAsk);
  const record=await page.evaluate(()=>window.codeleader.execution.current()),gateway=record.spans.find(s=>s.traceId===record.requests.find(r=>r.id===core.firstAsk).traceId&&s.name==='AiGateway.ask');
  await page.locator(`[data-id="${gateway.spanId}"]`).click();const before=await page.locator('.execution-graph .react-flow__viewport').getAttribute('style');
  const runtime=await page.evaluate(()=>window.codeleader.runtime());await run('pwsh.exe',['-NoProfile','-File',root+'/scripts/capture-runtime-window.ps1','-WindowHandle',runtime.windowHandle,'-Output',out+'/1366x768-historical.png']);
  await page.getByTitle('查看本次运行对应源码').click();await page.locator('.execution-inspector .source-path').waitFor();await page.getByRole('button',{name:'返回本次方法数据'}).click();const after=await page.locator('.execution-graph .react-flow__viewport').getAttribute('style');if(before!==after)throw Error('Source panel reset the reading viewport');
  const copyId=crypto.randomUUID(),folder=root+'/.appdata/executions/'+copyId;fs.mkdirSync(folder);fs.writeFileSync(folder+'/session.json',JSON.stringify({...record,id:copyId,sourceVersion:'different-build',historical:undefined}));
  const mismatch=await page.evaluate(id=>window.codeleader.execution.open(id),copyId);if(mismatch.spans.some(s=>s.symbolId||s.location))throw Error('Historical version mismatch mapped to current source');
  await page.evaluate(id=>window.codeleader.execution.remove(id),copyId);if(fs.existsSync(folder))throw Error('Deleted session remains on disk');
  fs.writeFileSync(out+'/history-window.json',JSON.stringify({passed:true,size:[1366,768],viewportPreserved:true,mismatchedSourceMappingDisabled:true,deleteSessionRemovesFiles:true,requestsSent:0,runtime},null,2));console.log('Small window, source return, history version mismatch and session deletion passed.');
}finally{if(page)await page.evaluate(()=>window.close()).catch(()=>{});if(browser)await browser.close();}
