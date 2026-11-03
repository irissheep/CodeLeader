import fs from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';
import {root,guard} from './common.mjs';
guard();
const out=path.join(root,'.tmp/verification-r8-honest-states'),read=async f=>JSON.parse(await fs.readFile(f,'utf8'));
const info=await read(path.join(out,'latest-development.json')),review=await read(path.join(root,'tests/fixtures/r8-review.json')),browser=await chromium.connectOverCDP('http://127.0.0.1:'+info.port);
const result={targetApplicationsStarted:false};
try{
 const page=browser.contexts()[0].pages().find(p=>p.url().includes('/renderer/index.html'));
 const current=await page.evaluate(()=>window.codeleader.execution.current());if(current&&['recording','connecting'].includes(current.state))throw Error('Active recording retained');
 const web=await read(path.join(out,'corpus-after',review.webExampleProject,'model.json'));
 await page.evaluate(root=>window.codeleader.analyze(root),web.root);await page.waitForFunction(()=>!!document.querySelector('[data-analysis-status=partial]'),undefined,{timeout:45000});
 await page.locator('[data-view=guide]').click();await page.waitForSelector('.web-explanation');await page.bringToFront();await page.locator('.web-explanation .button').click();
 await page.waitForFunction(()=>document.querySelector('.web-explanation .button')?.textContent==='已复制'||document.querySelector('.web-explanation [role=status]'),undefined,{timeout:5000});
 result.copy=await page.locator('.web-explanation .button').innerText();result.copyFailure=await page.locator('.web-explanation [role=status]').allTextContents();
 try{await page.screenshot({path:path.join(out,'native-django-copy.png'),timeout:5000});}catch{result.screenshotUnavailable=true;}
 const startup=await read(path.join(out,'corpus-after',review.startupProject,'model.json'));await page.evaluate(root=>window.codeleader.analyze(root),startup.root);await page.waitForSelector('[data-address-explanation]',{timeout:45000});
 await page.bringToFront();const trigger=page.locator('[data-address-explanation]');await trigger.focus();
 result.focused=await page.evaluate(()=>document.hasFocus());result.keyboardPopup=await page.locator('.address-examples').isVisible();
 await trigger.press('Escape');result.escapeClosed=await page.locator('.address-examples').count()===0;
 result.main=await page.evaluate(async()=>({project:document.querySelector('.command-project')?.textContent,record:(await window.codeleader.execution.current())?.id||null,view:document.querySelector('[data-view][aria-pressed=true]')?.getAttribute('data-view')}));
 await fs.writeFile(path.join(out,'native-actions.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser.close();}
