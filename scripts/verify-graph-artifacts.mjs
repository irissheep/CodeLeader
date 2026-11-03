import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright';
import electronPath from 'electron';
import { guard, root } from './common.mjs';
guard();
const output=path.join(root,'.tmp/verification-graph-refinement');
const before=JSON.parse(fs.readFileSync(path.join(output,'before-conditions.json'),'utf8'));
const after=JSON.parse(fs.readFileSync(path.join(output,'after-conditions.json'),'utf8'));
assert.equal(before.length,6);assert.equal(after.length,6);
const report={pairs:[],media:undefined};
for(let i=0;i<before.length;i++){
  assert.deepEqual(before[i].condition,after[i].condition);assert.deepEqual(before[i].metrics.client,after[i].metrics.client);assert.equal(before[i].hash,after[i].hash);
  const c=before[i].condition,label=`${c.width}x${c.height}-${c.scale*100}-overview`;
  const size=phase=>{const png=fs.readFileSync(path.join(output,`${phase}-${label}.png`));return[png.readUInt32BE(16),png.readUInt32BE(20)];};
  assert.deepEqual(size('before'),size('after'));report.pairs.push({label,png:size('before'),hash:before[i].hash});
}
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({executablePath:electronPath,args:[root],env});
try{
  const page=await app.firstWindow();await page.waitForSelector('.welcome');
  await app.evaluate(async({BrowserWindow},file)=>BrowserWindow.getAllWindows()[0].loadFile(file),path.join(output,'comparison.html'));
  for(const option of await page.locator('#scene option').evaluateAll(items=>items.map(el=>el.value))){await page.locator('#scene').selectOption(option);await page.waitForFunction(()=>[...document.images].every(image=>image.complete&&image.naturalWidth>0));}
  report.media=await page.locator('video').evaluate(async video=>{video.muted=true;await video.play();await new Promise(resolve=>setTimeout(resolve,250));video.pause();return{width:video.videoWidth,height:video.videoHeight,decoded:video.readyState>=2,currentTime:video.currentTime};});
  assert.equal(report.media.decoded,true);assert.ok(report.media.width>0);
}finally{await app.close();fs.writeFileSync(path.join(output,'artifacts.json'),JSON.stringify(report,null,2));}
console.log(JSON.stringify(report));
