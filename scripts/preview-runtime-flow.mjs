import {validationInput,requireValidationInputs} from './verification-input.mjs';
requireValidationInputs();
import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright';
import electronPath from 'electron';
import {guard,root,run} from './common.mjs';
guard();const out=root+'/.tmp/verification-runtime-flow',fixture=JSON.parse(fs.readFileSync(out+'/real-ask.json','utf8'));
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const child=spawn(electronPath,[root,validationInput(import.meta.url,'v0'),'--remote-debugging-port=18098','--verification-size=1366x768'],{env,windowsHide:false,stdio:['ignore','ignore','ignore']});let browser;
for(let i=0;i<100;i++){try{browser=await chromium.connectOverCDP('http://127.0.0.1:18098');break;}catch{await new Promise(r=>setTimeout(r,100));}}
if(!browser)throw Error('Acceptance window unavailable');const page=browser.contexts()[0].pages()[0];page.setDefaultTimeout(30000);
process.on('uncaughtException',async error=>{console.error(error);await page.evaluate(()=>window.codeleader.execution.stopEnvironment()).catch(()=>{});await page.evaluate(()=>window.close()).catch(()=>{});process.exit(1);});
await page.waitForFunction(()=>!!document.querySelector('.command-project')&&!document.querySelector('.analysis-progress'),null,{timeout:90000});await page.getByTitle('真实页面与请求录制').click();await page.locator('.execution-setup select').selectOption('synthetic');await page.getByRole('button',{name:'连接页面并开始录制',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.execution-badge')?.textContent?.includes('真实录制')||!!document.querySelector('.execution-error'),null,{timeout:120000});
if(await page.locator('.execution-error').count())throw Error(await page.locator('.execution-error').innerText());const target=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().startsWith('http://127.0.0.1:15174'));
await target.getByPlaceholder('4–32 位字母、数字或下划线').fill(fixture.username);await target.getByPlaceholder('输入你的密码').fill('SyntheticOnly!73');await target.getByRole('button',{name:'登录学习空间',exact:true}).click();await target.waitForURL('http://127.0.0.1:15174/');await target.getByRole('link',{name:'知识问答'}).click();await target.getByPlaceholder('向你的知识库提一个问题…（Ctrl + Enter 发送）').fill(fixture.request.input.question);await target.locator('.chat-composer button[type=submit]').click();await target.locator('.chat-message.assistant .markdown-body').waitFor();
let record,request,gateway;for(let i=0;i<100;i++){record=await page.evaluate(()=>window.codeleader.execution.current());request=record.requests.find(r=>r.url.endsWith('/api/ai/ask'));gateway=record.spans.find(s=>s.traceId===request?.traceId&&s.name==='AiGateway.ask');if(gateway&&record.spans.some(s=>s.traceId===request.traceId&&s.attributes['codeleader.boundary']==='chroma.query'))break;await page.waitForTimeout(200);}
if(!gateway)throw Error('Latest acceptance invocation missing');await page.getByLabel('本次请求',{exact:true}).selectOption(request.id);await page.locator(`[data-id="${gateway.spanId}"]`).click();
const runtime=await page.evaluate(()=>window.codeleader.runtime());const capture=(file,width,height)=>run('pwsh.exe',['-NoProfile','-File',root+'/scripts/capture-runtime-window.ps1','-WindowHandle',runtime.windowHandle,'-Output',out+'/'+file,...(width?['-Width',String(width),'-Height',String(height)]:[])]);
await capture('1366x768-real-runtime.png');const small=await page.evaluate(()=>({width:innerWidth,height:innerHeight,font:getComputedStyle(document.querySelector('.execution-node strong')).fontSize,zoom:document.querySelector('.execution-graph .react-flow__viewport').getAttribute('style')}));
await capture('1564x954-real-runtime.png',1564,954);
fs.writeFileSync(out+'/acceptance-launch.json',JSON.stringify({at:new Date().toISOString(),pid:runtime.pid,launcherPid:child.pid,project:validationInput(import.meta.url,'v1'),sessionId:record.id,requestId:request.id,smallWindow:small,runtime,devOnly:true},null,2));console.log('Latest development acceptance is visible:',runtime.pid);
await new Promise(resolve=>child.once('exit',resolve));await browser.close();
