import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import {_electron} from 'playwright';
import electron from 'electron';
import {guard,root,run} from './common.mjs';

guard();
const output=path.join(root,'.tmp/verification-s1-start-failure'),fixture=path.join(output,'failure-fixture-'+Date.now());
await fs.mkdir(path.join(fixture,'src'),{recursive:true});
const holder=net.createServer();await new Promise((resolve,reject)=>holder.listen(0,'127.0.0.1',resolve).once('error',reject));const port=holder.address().port;
await fs.writeFile(path.join(fixture,'package.json'),JSON.stringify({name:'runtime-check-fixture',private:true,scripts:{dev:'node -e "require(\'missing-runtime-check-package\')"'},dependencies:{vue:'^3.5.0'},devDependencies:{vite:'^7.0.0'}},null,2));
await fs.writeFile(path.join(fixture,'index.html'),'<div id="app"></div><script type="module" src="/src/main.js"></script>');
await fs.writeFile(path.join(fixture,'src/main.js'),"import {createApp} from 'vue'; createApp({template:'<p>test</p>'}).mount('#app');");
await fs.writeFile(path.join(fixture,'vite.config.js'),`export default {server:{port:${port}}};`);
await run(process.execPath,[path.join(root,'scripts/build.mjs')]);
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;const missingNpm=process.argv.includes('--missing-npm');if(missingNpm)env.CODELEADER_NPM=path.join(output,'absent-tools','npm.cmd');let app,page;const results=[];
try{
 app=await _electron.launch({executablePath:electron,args:['.','--project='+fixture,'--verification-size=1564x954'],cwd:root,env});
 page=await app.firstWindow();await page.waitForFunction(()=>!!window.codeleader);
 await page.evaluate(()=>new Promise(resolve=>{const off=window.codeleader.onIndex(value=>{if(['complete','partial','failed','cancelled'].includes(value.status)){off();resolve();}});}));
 await page.getByRole('button',{name:/打开真实页面/}).first().click();const entry=page.getByRole('dialog',{name:'打开真实页面'});await entry.waitFor();await entry.getByText('已找到前端的启动方式').waitFor();await entry.getByRole('button',{name:'启动并打开',exact:true}).click();
 const setup=page.getByRole('dialog',{name:'启动方式'});await setup.waitFor();
 if(missingNpm){await new Promise(resolve=>holder.close(resolve));await setup.getByRole('button',{name:/启动所选/}).click();const panel=page.locator('.startup-failure');await panel.waitFor({timeout:30000});const text=await panel.innerText();if(!/没找到 npm/.test(text))throw Error('启动前失败原因没有显示');await page.screenshot({path:path.join(output,'setup-missing.png')});await panel.getByRole('button',{name:'重试'}).click();await page.waitForTimeout(300);if(!/没找到 npm/.test(await panel.innerText()))throw Error('启动前失败重试后没有保留原因');console.log('startup setup failure shown and retried');}
 else {
 async function start(){const previous=await page.evaluate(async()=>((await window.codeleader.execution.current())?.id));await setup.getByRole('button',{name:/启动所选/}).click();await page.waitForFunction(async previous=>{const record=await window.codeleader.execution.current();return record?.state==='failed'&&record.id!==previous&&!!record.startupFailure;},previous,{timeout:180000});await page.locator('.startup-failure').waitFor({timeout:180000});}
 async function capture(name,expected){const panel=page.locator('.startup-failure');await page.waitForFunction(pattern=>new RegExp(pattern,'i').test(document.querySelector('.startup-failure')?.textContent||''),expected.source,{timeout:10000});const text=await panel.innerText();const record=await page.evaluate(()=>window.codeleader.execution.current());if(!expected.test(text))throw Error(name+' 的提示不符合预期：'+text.slice(0,400));if(!await panel.getByRole('button',{name:'重试'}).count())throw Error(name+' 缺少重试');await page.screenshot({path:path.join(output,name+'.png')});results.push({name,failure:record?.startupFailure});await fs.writeFile(path.join(output,'failure-cases.json'),JSON.stringify(results,null,2));}
 await start();await capture('port-busy',/端口.*占用/);await page.getByRole('button',{name:'换一个端口'}).click();await setup.waitFor();await setup.getByText('修改',{exact:true}).first().click();const suggested=Number(await setup.getByLabel(/端口/).first().inputValue());if(!suggested||suggested===port)throw Error('没有生成新的端口');await setup.getByRole('button',{name:'取消'}).click();await new Promise(resolve=>holder.close(resolve));
 async function command(value){await page.getByRole('button',{name:'改命令'}).click();await setup.waitFor();await setup.getByText('修改',{exact:true}).first().click();await setup.getByLabel(/启动命令/).first().fill(value);await start();}
 await command('npm run missing-script-for-check');await capture('command-missing',/没有找到.*脚本|Missing script/i);
 await command('npm run dev');await capture('dependency-missing',/没有找到.*依赖|Cannot find module/i);
 const previous=await page.evaluate(async()=>((await window.codeleader.execution.current())?.id));await page.getByRole('button',{name:'重试'}).click();await page.waitForFunction(async old=>{const record=await window.codeleader.execution.current();return record?.state==='failed'&&record.id!==old;},previous,{timeout:180000});results.push({name:'retry',newSession:true});await fs.writeFile(path.join(output,'failure-cases.json'),JSON.stringify(results,null,2));
 }
}catch(error){if(page){await page.screenshot({path:path.join(output,'failure-test-error.png')}).catch(()=>{});await fs.writeFile(path.join(output,'failure-test-error.txt'),String(error)+'\n\n'+await page.locator('body').innerText().catch(()=>''));}throw error;}
finally{if(holder.listening)await new Promise(resolve=>holder.close(resolve));if(app)await app.close().catch(()=>{});}
console.log(JSON.stringify(results,null,2));
