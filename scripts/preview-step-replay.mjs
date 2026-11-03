import {validationInput,requireValidationInputs} from './verification-input.mjs';
requireValidationInputs();
import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright';
import electronPath from 'electron';
import {guard,root} from './common.mjs';
import {managedPath} from './managed-path.mjs';
guard();
const out=managedPath(process.argv[2]||root+'/.tmp/verification-step-replay');
const fixture=JSON.parse(fs.readFileSync(root+'/.tmp/verification-runtime-flow/real-ask.json','utf8'));
const policy=JSON.parse(fs.readFileSync(root+'/.tmp/verification-step-replay/retained-capture-policy.json','utf8')).policy;
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const child=spawn(electronPath,[root,validationInput(import.meta.url,'v0'),'--remote-debugging-port=18098','--verification-size=1564x954'],{env,windowsHide:false,stdio:'ignore'});
let browser,page;
try{
  for(let i=0;i<100;i++){try{browser=await chromium.connectOverCDP('http://127.0.0.1:18098');break;}catch{await new Promise(r=>setTimeout(r,100));}}
  if(!browser)throw Error('Development window unavailable');
  page=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().startsWith('file:'));page.setDefaultTimeout(30000);
  await page.waitForFunction(()=>!!document.querySelector('.command-project')&&!document.querySelector('.analysis-progress'),null,{timeout:90000});
  await page.getByTitle('真实页面与请求录制').click();
  await page.locator('.execution-setup select').selectOption(policy);
  await page.getByRole('button',{name:'连接页面并开始录制',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.execution-header')?.textContent?.includes('停止录制')||!!document.querySelector('.execution-error'),null,{timeout:120000});
  if(await page.locator('.execution-error').count())throw Error(await page.locator('.execution-error').innerText());
  const target=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().startsWith('http://127.0.0.1:15174'));
  await target.getByPlaceholder('4–32 位字母、数字或下划线').fill(fixture.username);
  await target.getByPlaceholder('输入你的密码').fill('SyntheticOnly!73');
  await target.getByRole('button',{name:'登录学习空间',exact:true}).click();
  await target.waitForURL('http://127.0.0.1:15174/');await target.getByRole('link',{name:'知识问答'}).click();
  await target.getByPlaceholder('向你的知识库提一个问题…（Ctrl + Enter 发送）').fill(fixture.request.input.question);
  await target.locator('.chat-composer button[type=submit]').click();
  let record,request;
  for(let i=0;i<120;i++){
    record=await page.evaluate(()=>window.codeleader.execution.current());request=record.requests.find(r=>r.url.endsWith('/api/ai/ask'));
    if(request?.end&&record.spans.some(s=>s.traceId===request.traceId&&s.name==='AiGateway.ask')&&record.spans.some(s=>s.traceId===request.traceId&&s.attributes['codeleader.boundary']==='chroma.query'))break;
    await page.waitForTimeout(200);
  }
  if(!request?.end)throw Error('Sample request did not finish');
  await page.getByLabel('本次请求',{exact:true}).selectOption(request.id);await page.locator('.execution-timeline').waitFor();
  if(await page.getByRole('button',{name:'更新步骤',exact:true}).count())await page.getByRole('button',{name:'更新步骤',exact:true}).click();
  await page.getByLabel('跳到步骤',{exact:true}).press('Home');
  const runtime=await page.evaluate(()=>window.codeleader.runtime());
  fs.writeFileSync(out+'/preview-launch.json',JSON.stringify({at:new Date().toISOString(),pid:runtime.pid,sessionId:record.id,requestId:request.id,runtime,mode:'live page; paused at first recorded request step'},null,2));
  console.log('Ready for user acceptance:',runtime.pid);await browser.close();
  await new Promise(resolve=>child.once('exit',resolve));
}catch(error){
  console.error(error);if(page){await page.evaluate(()=>window.codeleader.execution.stopEnvironment()).catch(()=>{});await page.evaluate(()=>window.close()).catch(()=>{});}if(browser)await browser.close().catch(()=>{});process.exitCode=1;
}
