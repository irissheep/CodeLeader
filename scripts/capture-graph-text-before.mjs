import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {guard,root,run} from './common.mjs';
import {managedPath} from './managed-path.mjs';
guard();const out=managedPath(root+'/.tmp/verification-graph-text-reduction');
await build({entryPoints:['src/runtime/replay.ts'],outfile:out+'/replay-tools.mjs',platform:'node',format:'esm',bundle:true});
const {buildReplay,sessionOrderEvidence}=await import(pathToFileURL(out+'/replay-tools.mjs').href);
const launch=JSON.parse(fs.readFileSync(root+'/.tmp/verification-step-replay/preview-launch.json','utf8'));
const browser=await chromium.connectOverCDP('http://127.0.0.1:18098'),page=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().startsWith('file:'));
try{
  if(!await page.locator('.execution-workspace').count())await page.getByTitle('真实页面与请求录制').click();
  await page.locator('.execution-header').waitFor();
  let record=await page.evaluate(()=>window.codeleader.execution.current());
  const runtime=await page.evaluate(()=>window.codeleader.runtime()),geometry=()=>page.evaluate(()=>Object.fromEntries(['reading','graph','inspector','page'].map(name=>{const r=document.querySelector('.execution-'+name)?.getBoundingClientRect();return [name,r&&{x:r.x,y:r.y,width:r.width,height:r.height}];})));
  const capture=async(file,width,height)=>{await run('pwsh.exe',['-NoProfile','-File',root+'/scripts/capture-runtime-window.ps1','-WindowHandle',runtime.windowHandle,'-Output',out+'/'+file,'-Width',String(width),'-Height',String(height)]);return geometry();};
  const target=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url()==='http://127.0.0.1:15174/login');
  const liveEmpty=target&&record.requests.length===0?await capture('before-live-empty.png',1564,954):undefined;
  if(record.id!==launch.sessionId||!record.historical){
    if(record.state==='recording')await page.getByRole('button',{name:'停止录制',exact:true}).click();
    for(let i=0;i<50;i++){record=await page.evaluate(()=>window.codeleader.execution.current());if(record.state!=='recording')break;await page.waitForTimeout(100);}
    if(!await page.locator('.execution-setup').isVisible())await page.getByRole('button',{name:'接入与历史',exact:true}).click();
    const history=page.locator('.execution-setup details').first();if(!await history.evaluate(d=>d.open))await page.getByText('已有真实记录',{exact:true}).click();
    await page.locator(`[data-session-id="${launch.sessionId}"]`).click();
  }
  for(let i=0;i<50;i++){record=await page.evaluate(()=>window.codeleader.execution.current());if(record.id===launch.sessionId&&record.historical)break;await page.waitForTimeout(100);}
  if(record.id!==launch.sessionId)throw Error('Synthetic historical session did not open');
  const request=record.requests.find(r=>r.id===launch.requestId),model=buildReplay(request,record.spans,sessionOrderEvidence(record)),gateway=model.calls.find(c=>c.span?.name==='AiGateway.ask'),sql=model.calls.find(c=>c.kind==='sql');
  await page.getByLabel('本次请求',{exact:true}).selectOption(request.id);
  if(await page.getByRole('button',{name:'更新步骤',exact:true}).count())await page.getByRole('button',{name:'更新步骤',exact:true}).click();
  const go=async id=>page.locator('.execution-step-list button').nth(model.positions[id]).click();
  await go(gateway.enterId);
  const big=await capture('before-1564-selected.png',1564,954),small=await capture('before-1366-selected.png',1366,768);
  await go(gateway.returnId);await capture('before-return.png',1564,954);
  await go(sql.enterId);await capture('before-no-comparison.png',1564,954);
  await go(gateway.enterId);
  fs.writeFileSync(out+'/before.json',JSON.stringify({at:new Date().toISOString(),historical:true,sessionId:record.id,requestId:request.id,sourceVersion:record.sourceVersion,policy:record.policy,stepIds:model.steps.map(s=>s.id),big,small,liveEmpty,runtime},null,2));
  console.log('Baseline saved:',record.id);
}finally{await browser.close();}
