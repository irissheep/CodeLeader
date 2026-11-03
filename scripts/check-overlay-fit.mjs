import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {build} from 'vite';
import electron from 'electron';
import {chromium} from 'playwright';
import {guard,root} from './common.mjs';

for(const [key,value] of Object.entries({TEMP:'.tmp',TMP:'.tmp',TMPDIR:'.tmp',ELECTRON_CACHE:'.cache/electron',npm_config_cache:'.cache/npm'}))process.env[key]=path.join(root,value);
guard();
const out=path.join(root,'.tmp/verification-u9d-overlays');await fs.mkdir(out,{recursive:true});
const registry=JSON.parse(await fs.readFile(path.join(root,'scripts/overlay-registry.json'),'utf8'));
const files=(await fs.readdir(path.join(root,'src/renderer'))).filter(name=>name.endsWith('.tsx'));
const discovered=[];for(const file of files){const source=await fs.readFile(path.join(root,'src/renderer',file),'utf8');for(const match of source.matchAll(/<OverlayShell\s+id="([^"]+)"/g))discovered.push({id:match[1],file});if(file!=='OverlayShell.tsx'&&/role="dialog"/.test(source))discovered.push({id:'unregistered-dialog',file});}
const unregistered=discovered.filter(item=>!registry.modal.includes(item.id));
await build({configFile:false,root:path.join(root,'tests/fixtures/overlay-fit'),base:'./',build:{outDir:path.join(out,'fixture'),emptyOutDir:true}});
const socket=net.createServer();await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));
const env={...process.env,CODELEADER_OVERLAY_PORT:String(port)};delete env.ELECTRON_RUN_AS_NODE;
const log=await fs.open(path.join(out,'overlay-window.log'),'w'),child=spawn(electron,[path.join(root,'scripts/overlay-fit-window.cjs')],{cwd:root,env,windowsHide:true,stdio:['ignore',log.fd,log.fd]});
let browser,page,cssSupports;const cases=[],errors=[];const covered=['runtime-entry','startup-setup','workspace','backend-choice'];
try{
 for(let i=0;i<100;i++){try{browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`,{timeout:1000});break;}catch{await new Promise(resolve=>setTimeout(resolve,100));}}if(!browser)throw Error('无法启动检查窗口');
 page=browser.contexts()[0].pages()[0];page.on('pageerror',error=>errors.push(String(error)));await page.waitForSelector('#trigger-entry');cssSupports=await page.evaluate(()=>({pretty:CSS.supports('text-wrap','pretty'),balance:CSS.supports('text-wrap','balance'),keepAll:CSS.supports('word-break','keep-all'),userAgent:navigator.userAgent}));
 for(const height of [480,600,768,900,1080])for(const zoom of [1,1.25,1.5])for(const [id,trigger] of [['runtime-entry','entry'],['startup-setup','startup'],['workspace','workspace'],['backend-choice','backend']]){
  await page.evaluate(height=>window.overlaySize(1200,height),height);await page.evaluate(value=>window.overlayZoom(value),zoom);await page.waitForTimeout(80);
  const opener=page.locator('#trigger-'+trigger+(trigger==='backend'?' button':''));await opener.click();const dialog=page.locator(`[data-overlay-id="${id}"]`);await dialog.waitFor();
  if(id==='startup-setup'&&height===480&&zoom===1){const selected=dialog.locator('.startup-unit input[type=checkbox]').first();await selected.uncheck();if(!await dialog.getByRole('button',{name:'启动所选（2）'}).count())errors.push('取消选择服务后数量没有更新');await selected.check();if(!await dialog.getByRole('button',{name:'启动所选（3）'}).count())errors.push('重新选择服务后数量没有更新');}
  if(id==='startup-setup')for(const summary of await dialog.locator('.startup-unit > .startup-unit-row > details > summary').all())await summary.click();
  const geometry=await dialog.evaluate(element=>{const rect=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};const d=rect(element),footer=element.querySelector('.overlay-footer'),primary=footer?.querySelector('.overlay-primary'),body=element.querySelector('.overlay-body'),items=[...body.querySelectorAll('button:not(:disabled),input:not(:disabled),summary')].filter(e=>e.getClientRects().length);body.scrollTop=body.scrollHeight;return{dialog:d,viewport:{width:innerWidth,height:innerHeight},footer:footer&&rect(footer),primary:primary&&rect(primary),last:items.length&&rect(items.at(-1)),buttons:[...element.querySelectorAll('.overlay-footer button')].map(button=>({height:rect(button).height,whiteSpace:getComputedStyle(button).whiteSpace,scrollWidth:button.scrollWidth,clientWidth:button.clientWidth})),focused:element.contains(document.activeElement),bodyScroll:body.scrollHeight>body.clientHeight,backdrop:!!element.closest('.overlay-shade')};});
  const within=(r,v)=>!r||r.x>=-1&&r.y>=-1&&r.right<=v.width+1&&r.bottom<=v.height+1;
  const fit=within(geometry.dialog,geometry.viewport)&&within(geometry.footer,geometry.viewport)&&within(geometry.primary,geometry.viewport)&&within(geometry.last,geometry.viewport)&&(!geometry.last||!geometry.footer||geometry.last.bottom<=geometry.footer.y+1);
  const focusables=dialog.locator('button:not(:disabled),input:not(:disabled),summary');await focusables.first().focus();await page.keyboard.press('Shift+Tab');const backCycle=await dialog.evaluate(e=>{const items=[...e.querySelectorAll('button:not(:disabled),input:not(:disabled),summary')].filter(item=>item.getClientRects().length);return document.activeElement===items.at(-1);});await page.keyboard.press('Tab');const forwardCycle=await dialog.evaluate(e=>document.activeElement===e.querySelector('button:not(:disabled),input:not(:disabled),summary'));const cycle=backCycle&&forwardCycle;
  if(height===900&&zoom===1&&id==='runtime-entry')await page.screenshot({path:path.join(out,'entry-fixture.png')});
  if(height===900&&zoom===1&&id==='startup-setup')await page.screenshot({path:path.join(out,'startup-fixture.png')});
  if(height===600&&zoom===1&&id==='startup-setup')await page.screenshot({path:path.join(out,'startup-600-fixture.png')});
  await page.keyboard.press('Escape');const closed=await dialog.count()===0,restored=await opener.evaluate(element=>document.activeElement===element);
  const secondary=geometry.buttons.slice(geometry.primary?1:0),buttons=geometry.buttons.every(button=>button.whiteSpace==='nowrap'&&button.scrollWidth<=button.clientWidth+1)&&(!geometry.primary||Math.abs(geometry.buttons[0].height-36)<1)&&secondary.every(button=>Math.abs(button.height-32)<1&&Math.abs(button.clientWidth-secondary[0].clientWidth)<2);
  const result={id,height,zoom,fit,cycle,closed,restored,buttons,geometry};cases.push(result);console.log(JSON.stringify({id,height,zoom,fit,cycle,closed,restored,buttons,focused:geometry.focused,backdrop:geometry.backdrop}));
 }
}catch(error){errors.push(String(error));}finally{await page?.close().catch(()=>{});await browser?.close().catch(()=>{});child.kill();await log.close();}
const uncovered=registry.modal.filter(id=>!covered.includes(id));const result={cases,discovered,unregistered,uncovered,docked:registry.docked,popover:registry.popover,cssSupports,errors};await fs.writeFile(path.join(out,'OVERLAY-FIT.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify({cases:cases.length,failed:cases.filter(item=>!item.fit||!item.cycle||!item.closed||!item.restored||!item.buttons).length,unregistered,uncovered,docked:registry.docked,popover:registry.popover,errors}));
if(errors.length||unregistered.length||uncovered.length||registry.docked.length||registry.popover.length||cases.length!==60||cases.some(item=>!item.fit||!item.cycle||!item.closed||!item.restored||!item.buttons||!item.geometry.focused||!item.geometry.backdrop))process.exitCode=1;
