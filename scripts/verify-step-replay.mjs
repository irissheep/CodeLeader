import {validationInput,requireValidationInputs} from './verification-input.mjs';
requireValidationInputs();
import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import electronPath from 'electron';
import {guard,root,run} from './common.mjs';
import {managedPath} from './managed-path.mjs';
guard();const out=managedPath(root+'/.tmp/verification-step-replay');
await build({entryPoints:['src/runtime/replay.ts'],outfile:out+'/replay-tools.mjs',platform:'node',format:'esm',bundle:true});
const {buildReplay,sessionOrderEvidence}=await import(pathToFileURL(out+'/replay-tools.mjs').href);
const old=JSON.parse(fs.readFileSync(out+'/retained-capture-policy.json','utf8')),fixture=JSON.parse(fs.readFileSync(root+'/.tmp/verification-runtime-flow/real-ask.json','utf8'));
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const child=spawn(electronPath,[root,validationInput(import.meta.url,'v0'),'--remote-debugging-port=18098','--verification-size=1564x954'],{env,windowsHide:false,stdio:'ignore'});let browser,page;
const assert=(ok,message)=>{if(!ok)throw Error(message);};
const result={at:new Date().toISOString(),passed:false,checks:{},newBusinessRequests:0,retainedPolicy:old.policy};
try{
  for(let i=0;i<100;i++){try{browser=await chromium.connectOverCDP('http://127.0.0.1:18098');break;}catch{await new Promise(r=>setTimeout(r,100));}}
  if(!browser)throw Error('Development acceptance window unavailable');page=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().startsWith('file:'));page.setDefaultTimeout(20000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.waitForFunction(()=>!!document.querySelector('.command-project')&&!document.querySelector('.analysis-progress'),null,{timeout:90000});
  await page.getByTitle('真实页面与请求录制').click();
  // Verify real overlapping historical requests before starting any business page.
  const core=JSON.parse(fs.readFileSync(root+'/.tmp/verification-runtime-flow/core-verification.json','utf8')),concurrency=JSON.parse(fs.readFileSync(root+'/.tmp/verification-runtime-flow/concurrency.json','utf8'));
  await page.getByText('已有真实记录',{exact:true}).click();await page.locator(`[data-session-id="${core.sessionId}"]`).click();
  const progress=async()=>Number(await page.getByLabel('跳到步骤',{exact:true}).inputValue());
  const first=concurrency.requests[0],second=concurrency.requests[1];await page.getByLabel('本次请求',{exact:true}).selectOption(first.id);await page.locator('.execution-timeline').waitFor();await page.getByTitle('下一步',{exact:true}).click();const saved=await progress();await page.getByLabel('本次请求',{exact:true}).selectOption(second.id);await page.locator('.execution-timeline').waitFor();assert(await progress()===0,'Second request inherited cursor');await page.getByTitle('下一步',{exact:true}).click();await page.getByLabel('本次请求',{exact:true}).selectOption(first.id);assert(await progress()===saved,'Request switching lost cursor');
  assert(await page.locator('.execution-page').isHidden(),'History loaded a business page');assert(!browser.contexts().flatMap(c=>c.pages()).some(p=>p.url().startsWith('http://127.0.0.1:15174')),'Historical replay created a frontend');result.checks.overlappingHistoryIsolation=true;result.checks.historicalNoBusinessPage=true;
  await page.getByRole('button',{name:'接入与历史',exact:true}).click();
  // Retain the already authorized synthetic verification policy, not a new whitelist/default.
  await page.locator('.execution-setup select').selectOption(old.policy);await page.getByRole('button',{name:'连接页面并开始录制',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.execution-badge')?.textContent?.includes('真实录制')||!!document.querySelector('.execution-error'),null,{timeout:120000});
  if(await page.locator('.execution-error').count())throw Error(await page.locator('.execution-error').innerText());
  const target=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().startsWith('http://127.0.0.1:15174'));
  await target.getByPlaceholder('4–32 位字母、数字或下划线').fill(fixture.username);await target.getByPlaceholder('输入你的密码').fill('SyntheticOnly!73');await target.getByRole('button',{name:'登录学习空间',exact:true}).click();await target.waitForURL('http://127.0.0.1:15174/');await target.getByRole('link',{name:'知识问答'}).click();
  const runtime=await page.evaluate(()=>window.codeleader.runtime()),capture=(file,width,height,frames)=>run('pwsh.exe',['-NoProfile','-File',root+'/scripts/capture-runtime-window.ps1','-WindowHandle',runtime.windowHandle,'-Output',out+'/'+file,...(width?['-Width',String(width),'-Height',String(height)]:[]),...(frames?['-Frames',String(frames)]:[])]);
  fs.mkdirSync(managedPath(out+'/recording-frames'),{recursive:true});
  const recording=capture('recording-frames',0,0,64);
  const before=await page.evaluate(()=>window.codeleader.execution.current()),beforeIds=new Set(before.requests.map(r=>r.id));
  await target.getByPlaceholder('向你的知识库提一个问题…（Ctrl + Enter 发送）').fill(fixture.request.input.question);await target.locator('.chat-composer button[type=submit]').click();result.newBusinessRequests++;
  await target.locator('.chat-message.assistant .markdown-body').waitFor();
  let record,request;for(let i=0;i<100;i++){record=await page.evaluate(()=>window.codeleader.execution.current());request=record.requests.find(r=>!beforeIds.has(r.id)&&r.url.endsWith('/api/ai/ask'));if(request?.end&&record.spans.some(s=>s.traceId===request.traceId&&s.name==='AiGateway.ask')&&record.spans.some(s=>s.traceId===request.traceId&&s.attributes['codeleader.boundary']==='chroma.query'))break;await page.waitForTimeout(200);}
  assert(request?.end,'Real ask did not finish with spans');await page.getByLabel('本次请求',{exact:true}).selectOption(request.id);await page.locator('.execution-timeline').waitFor();
  if(await page.getByRole('button',{name:'更新步骤',exact:true}).count())await page.getByRole('button',{name:'更新步骤',exact:true}).click();
  const model=buildReplay(request,record.spans,sessionOrderEvidence(record)),gateway=model.calls.find(c=>c.span?.name==='AiGateway.ask'),sql=model.calls.find(c=>c.kind==='sql'),controller=model.calls.find(c=>c.span?.name==='AiController.ask');
  const go=async id=>{await page.locator('.execution-step-list button').nth(model.positions[id]).click();await page.waitForTimeout(40);};
  const position=async()=>Number(await page.getByLabel('跳到步骤',{exact:true}).inputValue());
  const inspector=page.locator('.execution-inspector');
  assert(model.positions[sql.enterId]<model.positions[gateway.enterId],'MySQL not before Gateway');assert(!model.notes.some(n=>n.includes('冲突')),'Unexpected replay order conflict');
  assert(model.calls.some(c=>c.kind==='chroma'),'Actual Chroma missing');result.checks.realRequestOrder=true;result.sessionId=record.id;result.requestId=request.id;
  result.steps=model.steps.map(s=>({phase:s.phase,call:model.byCall[s.callId].name,id:s.id}));
  await go(controller.enterId);await page.getByRole('button',{name:'步入',exact:true}).click();assert(await position()===model.positions[sql.enterId],'Step into did not select first recorded downstream');
  // Inspect a future node without moving the cursor or exposing its output.
  await page.locator(`[data-id="${gateway.id}"] .execution-node-body`).click();assert(await position()===model.positions[sql.enterId],'Inspect moved cursor');assert((await inspector.innerText()).includes('尚未播放到此调用'),'Future inspection lacks phase notice');
  await page.getByRole('button',{name:'到此步',exact:true}).click();assert(await position()===model.positions[gateway.enterId],'Explicit goto failed');
  const values=await inspector.locator('.execution-values').first().innerText();assert(values.includes('userId')&&values.includes('question')&&values.includes('notes'),'Field tree omitted safe gateway fields');
  await inspector.getByLabel('比较来源',{exact:true}).selectOption(model.calls[0].id+':input');const diff=await inspector.locator('.execution-differences').innerText();assert(diff.includes('userId')&&diff.includes('notes')&&diff.includes('仅在当前快照出现'),'Snapshot endpoints or additions missing');
  await capture('1564x954-gateway-input.png');
  await inspector.getByLabel('数据显示',{exact:true}).selectOption('structure');assert((await inspector.locator('.execution-values').first().innerText()).includes('仅保存类型'),'Structure display failed');
  await inspector.getByLabel('数据显示',{exact:true}).selectOption('synthetic');assert((await inspector.locator('.execution-values').first().innerText()).includes(fixture.request.input.question),'Saved synthetic value did not return');
  result.checks.fieldsAndModeAndComparison=true;
  await page.getByRole('button',{name:'跳过',exact:true}).click();assert(await position()===model.positions[gateway.returnId],'Skip failed');assert((await inspector.innerText()).includes('以下是从你的笔记'),'Actual return not visible');await capture('gateway-return.png');
  await page.getByTitle('上一步',{exact:true}).click();await page.locator(`[data-id="${gateway.id}"] .execution-node-body`).click();assert((await inspector.innerText()).includes('走到返回后可查看'),'Back failed to hide future return');
  await go(gateway.enterId);await page.getByRole('button',{name:'步入',exact:true}).click();const http=model.calls.find(c=>c.id===gateway.children[0]);assert(await position()===model.positions[http.enterId],'Gateway step into failed');await page.getByRole('button',{name:'步出',exact:true}).click();assert(await position()===model.positions[http.returnId],'Step out failed at current layer');
  result.checks.navigationAndReturnGating=true;
  await page.getByRole('button',{name:'回放断点：AiGateway.ask',exact:true}).click();await go(sql.enterId);await page.getByLabel('回放速度',{exact:true}).selectOption('500');await page.getByTitle('播放回放',{exact:true}).click();await page.getByRole('status').filter({hasText:'即将进入回放断点'}).waitFor();assert(await position()===model.positions[sql.enterId],'Breakpoint advanced past previous cursor');await capture('breakpoint.png');
  await page.getByTitle('播放回放',{exact:true}).click();await page.waitForFunction(i=>Number(document.querySelector('[aria-label="跳到步骤"]').value)>=i,model.positions[gateway.enterId]);if(await page.getByTitle('暂停回放',{exact:true}).count())await page.getByTitle('暂停回放',{exact:true}).click();assert(await position()>=model.positions[gateway.enterId],'Resume stuck on breakpoint');result.checks.breakpointResume=true;
  await page.getByRole('button',{name:'回放断点：AiGateway.ask',exact:true}).click();
  // Complete playback, then prove that it generated no second business request.
  await go(model.steps[0].id);await page.getByLabel('回放速度',{exact:true}).selectOption('1000');await page.getByTitle('播放回放',{exact:true}).click();await page.waitForFunction(i=>Number(document.querySelector('[aria-label="跳到步骤"]').value)===i,model.steps.length-1,{timeout:30000});
  assert((await inspector.innerText()).includes('退出时返回'),'Browser response missing');const afterReplay=await page.evaluate(()=>window.codeleader.execution.current());assert(afterReplay.requests.filter(r=>r.url.endsWith('/api/ai/ask')).length===record.requests.filter(r=>r.url.endsWith('/api/ai/ask')).length,'Replay resent an ask');result.checks.playbackDoesNotResend=true;
  await go(gateway.enterId);const viewport=await page.locator('.execution-graph .react-flow__viewport').getAttribute('style');await page.getByTitle('查看本次运行对应源码',{exact:true}).click();await inspector.locator('.source-path').waitFor();await page.getByRole('button',{name:'返回本次方法数据',exact:true}).click();assert(await page.locator('.execution-graph .react-flow__viewport').getAttribute('style')===viewport,'Source return moved viewport');result.checks.sourceViewport=true;
  await capture('1366x768-gateway-input.png',1366,768);await capture('1564x954-final.png',1564,954);
  await recording;
  // Actual mouse drag on the timeline, then back to the chosen stable step.
  const slider=page.getByLabel('跳到步骤',{exact:true}),box=await slider.boundingBox();await page.mouse.move(box.x+box.width*.2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width*.65,box.y+box.height/2,{steps:8});await page.mouse.up();assert(await position()>0&&await position()<model.steps.length,'Timeline drag failed');await go(gateway.enterId);result.checks.timelineDrag=true;
  result.checks.capturePolicyUnchanged=(await page.evaluate(()=>window.codeleader.execution.current())).policy===old.policy;result.checks.noRendererErrors=errors.length===0;assert(errors.length===0,errors.join('; '));
  result.passed=true;result.runtime=runtime;result.recordingFrames=64;fs.writeFileSync(out+'/ui-results.json',JSON.stringify(result,null,2));fs.writeFileSync(out+'/acceptance-launch.json',JSON.stringify({at:new Date().toISOString(),pid:runtime.pid,runtime,sessionId:record.id,requestId:request.id,mode:'live isolated frontend; playback paused at Gateway input',devOnly:true},null,2));console.log('Step replay verified; latest development acceptance is visible:',runtime.pid);
  await browser.close();
}catch(error){result.error=String(error);fs.writeFileSync(out+'/ui-results.json',JSON.stringify(result,null,2));console.error(error);if(page){await page.evaluate(()=>window.codeleader.execution.stopEnvironment()).catch(()=>{});await page.evaluate(()=>window.close()).catch(()=>{});}if(browser)await browser.close().catch(()=>{});process.exitCode=1;}
if(result.passed)await new Promise(resolve=>child.once('exit',resolve));
