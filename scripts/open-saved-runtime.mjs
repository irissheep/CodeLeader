/** Enter the saved-history workspace without connecting or starting a target application. */
export async function openSavedRuntime(page){
 const legacy=page.getByRole('button',{name:'录制',exact:true});
 if(await legacy.count())await legacy.click();
 else{const entry=page.locator('.orientation-slots .runtime-entry');const legacySetup=entry.getByRole('button',{name:'去填写 ›'});if(await legacySetup.count())await legacySetup.click();else{await entry.locator('button').first().click();await page.getByRole('button',{name:'查看已有记录'}).click();}const close=page.getByLabel('关闭接入');if(await close.isVisible())await close.click();}
 await page.waitForSelector('.replay-dock');
}
