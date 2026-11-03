import {validationInput,requireValidationInputs} from './verification-input.mjs';
requireValidationInputs();
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { _electron as electron } from 'playwright';
import electronPath from 'electron';
import { guard, root } from './common.mjs';
guard();
const output=path.join(root,'.tmp/verification-graph-refinement');fs.mkdirSync(output,{recursive:true});
await build({stdin:{contents:"export {graphFor} from './src/renderer/graph-model'; export {segmentHits} from './src/renderer/graph-geometry';",resolveDir:root},outfile:path.join(output,'geometry.cjs'),bundle:true,platform:'node',format:'cjs'});
const {graphFor,segmentHits}=createRequire(import.meta.url)(path.join(output,'geometry.cjs'));
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({executablePath:electronPath,args:[root],env});const report={checks:[],layouts:[]};
const page=await app.firstWindow();page.setDefaultTimeout(30000);
let recording;const frames=[];
const startRecording=async()=>{
  try{recording=await page.context().newCDPSession(page);recording.on('Page.screencastFrame',event=>{if(!frames.length||event.metadata.timestamp-frames.at(-1).time>0.1)frames.push({data:event.data,time:event.metadata.timestamp});void recording.send('Page.screencastFrameAck',{sessionId:event.sessionId});});await recording.send('Page.startScreencast',{format:'jpeg',quality:70,maxWidth:1200,maxHeight:750,everyNthFrame:1});}catch(e){report.videoUnavailable=String(e);}
};
const stopRecording=async()=>{if(recording)await recording.send('Page.stopScreencast');};
const encodeRecording=async()=>{
  if(frames.length<2)return;
  const data=await page.evaluate(async frames=>{
    const bitmap=async data=>createImageBitmap(new Blob([Uint8Array.from(atob(data),c=>c.charCodeAt(0))],{type:'image/jpeg'}));
    const first=await bitmap(frames[0].data),canvas=document.createElement('canvas');canvas.width=first.width;canvas.height=first.height;
    const ctx=canvas.getContext('2d'),stream=canvas.captureStream(12),chunks=[];
    const type=MediaRecorder.isTypeSupported('video/webm;codecs=vp9')?'video/webm;codecs=vp9':'video/webm';
    const recorder=new MediaRecorder(stream,{mimeType:type,videoBitsPerSecond:1800000});
    const done=new Promise(resolve=>{recorder.ondataavailable=e=>chunks.push(e.data);recorder.onstop=()=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.readAsDataURL(new Blob(chunks,{type}));};});
    const total=(frames.at(-1).time-frames[0].time)*1000,speed=Math.min(1,12000/total);ctx.drawImage(first,0,0);first.close();recorder.start();const start=performance.now();
    for(const frame of frames){const target=(frame.time-frames[0].time)*1000*speed;await new Promise(resolve=>setTimeout(resolve,Math.max(0,target-(performance.now()-start))));const image=await bitmap(frame.data);ctx.drawImage(image,0,0);image.close();}
    await new Promise(resolve=>setTimeout(resolve,180));recorder.stop();const result=await done;stream.getTracks().forEach(t=>t.stop());return result;
  },frames);
  fs.writeFileSync(path.join(output,'interaction.webm'),Buffer.from(data,'base64'));
  report.video={file:'interaction.webm',frames:frames.length,sourceDurationMs:Math.round((frames.at(-1).time-frames[0].time)*1000),maximumPlaybackMs:12180};
};
const capture=async name=>{const data=await app.evaluate(async({BrowserWindow})=>(await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));fs.writeFileSync(path.join(output,name+'.png'),Buffer.from(data,'base64'));};
const stable=async()=>{await page.waitForFunction(()=>document.querySelector('.graph-canvas')?.dataset.layoutBusy==='false');assert.equal(await page.locator('.graph-budget[role=alert]').count(),0);await page.waitForTimeout(260);};
const geometry=async label=>{
  await stable();const snapshot=await page.evaluate(()=>window._snapshot);assert.ok(snapshot);
  for(const edge of snapshot.edges){
    const source=snapshot.nodes.find(n=>n.ports.some(p=>p.id===edge.sourcePort)),target=snapshot.nodes.find(n=>n.ports.some(p=>p.id===edge.targetPort));
    const a=source.ports.find(p=>p.id===edge.sourcePort),b=target.ports.find(p=>p.id===edge.targetPort);
    assert.deepEqual(edge.points[0],{x:source.x+a.x,y:source.y+a.y});assert.deepEqual(edge.points.at(-1),{x:target.x+b.x,y:target.y+b.y});
    for(let i=1;i<edge.points.length;i++){
      const a=edge.points[i-1],b=edge.points[i];assert.ok(a.x===b.x||a.y===b.y);
      for(const node of snapshot.nodes.filter(n=>n.id!==source.id&&n.id!==target.id))assert.ok(!segmentHits(a,b,node),`${label}: ${edge.id} 穿过 ${node.id}`);
    }
  }
  const handles=await page.evaluate(()=>{const host=document.querySelector('.graph-canvas').getBoundingClientRect(),m=new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.react-flow__viewport')).transform);return [...document.querySelectorAll('.react-flow__handle')].map(h=>{const r=h.getBoundingClientRect();return{id:h.dataset.handleid,x:(r.left+r.width/2-host.left-m.e)/m.a,y:(r.top+r.height/2-host.top-m.f)/m.d};});});
  let error=0;for(const node of snapshot.nodes)for(const port of node.ports){const handle=handles.find(h=>h.id===port.id);assert.ok(handle,port.id);error=Math.max(error,Math.abs(node.x+port.x-handle.x),Math.abs(node.y+port.y-handle.y));}
  assert.ok(error<0.6,`实际 Handle 偏差 ${error}`);
  report.layouts.push({label,nodes:snapshot.nodes.length,edges:snapshot.edges.length,maxHandleError:error});return snapshot;
};
try{
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1564,951));
  await page.waitForSelector('.welcome');
  await page.evaluate(()=>{window._index=undefined;window.codeleader.onIndex(index=>window._index=index);const Native=window.Worker;window.Worker=class extends Native{constructor(...args){super(...args);this.addEventListener('message',e=>{if(e.data.snapshot)window._snapshot=e.data.snapshot;});}};});
  await page.evaluate(()=>window.codeleader.analyze(validationInput(import.meta.url,'v0')));
  await page.waitForFunction(()=>window._index?.status==='partial'||window._index?.status==='complete');
  const first=await geometry('真实 12 模块总览');
  const index=await page.evaluate(()=>window._index),base={level:'overview',expanded:[],positions:{},viewport:{x:0,y:0,zoom:1},filter:'all',query:''},model=graphFor(index,base);
  assert.equal(first.nodes.length,12);assert.equal(first.edges.length,model.links.length);
  fs.writeFileSync(path.join(output,'overview-snapshot.json'),JSON.stringify(first,null,2));
  // Evaluate the same data with only forceNodeModelOrder changed, using the real browser Worker.
  const workerName=fs.readdirSync(path.join(root,'dist/renderer/assets')).find(n=>/^layout.worker-.*\.js$/.test(n));
  const orderResults=await page.evaluate(async({model,workerName})=>{
    const run=forceOrder=>new Promise((resolve,reject)=>{const w=new Worker(new URL(`./assets/${workerName}`,location.href),{type:'module'});w.onmessage=e=>{w.terminate();e.data.error?reject(new Error(e.data.error)):resolve(e.data.snapshot);};w.postMessage({id:1,...model,positions:{},level:'overview',forceOrder});});
    return [await run(true),await run(false),await run(false)];
  },{model,workerName});
  const metric=snapshot=>{let length=0,bends=0,crossings=0;const segments=[];for(const e of snapshot.edges){bends+=e.points.length-2;for(let i=1;i<e.points.length;i++){const a=e.points[i-1],b=e.points[i];length+=Math.abs(a.x-b.x)+Math.abs(a.y-b.y);segments.push({edge:e.id,a,b});}}for(let i=0;i<segments.length;i++)for(let j=i+1;j<segments.length;j++){const p=segments[i],q=segments[j];if(p.edge===q.edge)continue;const h=p.a.y===p.b.y?p:q,v=p.a.y===p.b.y?q:p;if(h.a.y===h.b.y&&v.a.x===v.b.x&&v.a.x>Math.min(h.a.x,h.b.x)&&v.a.x<Math.max(h.a.x,h.b.x)&&h.a.y>Math.min(v.a.y,v.b.y)&&h.a.y<Math.max(v.a.y,v.b.y))crossings++;}return{length,bends,crossings};};
  assert.deepEqual(orderResults[1],orderResults[2],'布局必须可重复');report.orderComparison={forced:metric(orderResults[0]),free:metric(orderResults[1]),repeatable:true};
  await page.getByRole('button',{name:'分析状态',exact:false}).click();await page.waitForSelector('.gap-summary');assert.ok((await page.locator('.gap-summary').innerText()).includes('范围限制'));await capture('after-analysis-categories');await page.locator('.evidence-title button').click();
  await page.getByRole('textbox',{name:'搜索文件与符号'}).fill('authenticationOwnershipCrudAndStatsWorkTogether');await page.locator('.symbol-item').first().click();
  const compact=await geometry('高度数函数默认聚合');const focused=page.locator('.graph-card.is-focus');const before=await focused.boundingBox();
  await startRecording();
  await page.getByRole('button',{name:'展开聚合符号',exact:true}).click();const expanded=await geometry('高度数函数展开');assert.ok(expanded.nodes.length>compact.nodes.length);
  const after=await focused.boundingBox();assert.ok(Math.abs(before.x-after.x)<1&&Math.abs(before.y-after.y)<1,'展开时焦点锚定');await capture('after-expanded');
  await page.waitForTimeout(450);
  await page.getByRole('button',{name:'收起扩展',exact:true}).click();await geometry('高度数函数收起');
  const node=page.locator('.graph-card').filter({hasText:'ApiClient'}).first(),rect=await node.boundingBox();assert.ok(rect);
  await page.mouse.move(rect.x+80,rect.y+55);await page.mouse.down();await page.mouse.move(rect.x+126,rect.y+93,{steps:8});await page.mouse.up();
  const dragged=await geometry('拖动释放后重新路由');await capture('after-drag');
  await page.locator('.edge-label').first().click();await page.waitForSelector('.relation-row');assert.ok(await page.locator('.source-panel').isVisible());await page.locator('.source-link').first().click();await page.waitForSelector('.source-evidence');await capture('after-evidence');
  await page.waitForTimeout(650);
  await page.locator('.evidence-title button').click();
  await page.getByRole('button',{name:'关闭源码侧栏',exact:true}).click();await page.waitForTimeout(150);const closed=await focused.boundingBox();
  await focused.click();await page.waitForSelector('.source-panel');await page.waitForTimeout(150);const reopened=await focused.boundingBox();assert.ok(Math.abs((reopened.x+reopened.width/2)-(closed.x+closed.width/2)+(await page.locator('.source-panel').boundingBox()).width/2)<2,'侧栏变化保留图中焦点');
  await page.getByTitle('只查看调用者',{exact:true}).first().click();const callers=await geometry('仅调用者');assert.ok(callers.edges.every(e=>e.id.includes('|CALLS|')));assert.ok(await page.locator('.direction-tabs .active').innerText()==='调用者');
  await page.getByRole('button',{name:'后退',exact:true}).click();const restored=await geometry('历史恢复拖动后的布局');assert.deepEqual(restored.nodes.map(n=>[n.id,n.x,n.y]),dragged.nodes.map(n=>[n.id,n.x,n.y]));
  await page.waitForTimeout(450);
  await stopRecording();
  // Rapid A -> B -> A and back/forward must settle on the current focus, not a late Worker result.
  await page.getByRole('button',{name:'被调用者',exact:true}).click();await page.getByRole('button',{name:'后退',exact:true}).click();await page.getByRole('button',{name:'前进',exact:true}).click();await geometry('快速切换与前进');assert.equal(await page.locator('.direction-tabs .active').innerText(),'被调用者');
  await page.getByRole('button',{name:'设置与分析边界',exact:true}).click();await page.getByRole('checkbox').uncheck();await page.locator('.modal-heading button').click();assert.ok(await page.locator('.app.reduce-motion').count());
  await page.getByRole('button',{name:'双向',exact:true}).click();await geometry('关闭动画后双向导航');assert.equal(await page.locator('.react-flow__nodes').evaluate(el=>getComputedStyle(el).animationName),'none');await capture('after-motion-disabled');
  report.checks.push('真实总览聚合及分类','实际 Handle 对齐、正交与节点避障','展开 / 收起焦点保持','拖动后按最终位置路由','证据与只读源码','侧栏开关焦点保持','方向导航、返回与前进','快速连续切换','关闭动画');
  try{await encodeRecording();}catch(e){report.videoUnavailable=String(e);}
}catch(error){await capture('interaction-failure');throw error;}finally{await app.close();fs.writeFileSync(path.join(output,'interactions.json'),JSON.stringify(report,null,2));}
console.log(JSON.stringify(report));
