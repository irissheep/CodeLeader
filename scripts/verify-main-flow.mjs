import {validationInput,requireValidationInputs} from './verification-input.mjs';
requireValidationInputs();
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright';
import electronPath from 'electron';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { managedPath } from './managed-path.mjs';
import { guard, root } from './common.mjs';
guard();
const output=managedPath(path.join(root,'.tmp/verification-main-flow'));fs.mkdirSync(output,{recursive:true});
const before=process.argv.includes('--before'),phase=before?'before':'after';
if(before&&fs.existsSync(path.join(output,'baseline-index.json')))throw new Error('禁止覆盖已有基线。');
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;const reports=[];
await build({stdin:{resolveDir:root,contents:"export {segmentHits} from './src/renderer/graph-geometry';"},outfile:output+'/geometry.cjs',bundle:true,platform:'node',format:'cjs'});const {segmentHits}=createRequire(import.meta.url)(output+'/geometry.cjs');
for(const [width,height] of [[1564,954],[1366,768]]){
 const app=await electron.launch({executablePath:electronPath,args:[root],env});
 try{
  const page=await app.firstWindow();page.setDefaultTimeout(25000);
  await app.evaluate(({BrowserWindow},size)=>BrowserWindow.getAllWindows()[0].setSize(...size),[width,height]);
  await page.waitForSelector('.welcome');
  const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.evaluate(()=>{window._index=undefined;window.codeleader.onIndex(index=>window._index=index);const Native=window.Worker;window.Worker=class extends Native{constructor(...args){super(...args);this.addEventListener('message',e=>{if(e.data.snapshot)window._layout=e.data.snapshot;});}postMessage(data,...rest){if(data.cards)window._layoutRequest=data;return super.postMessage(data,...rest);}};});
  await page.evaluate(()=>window.codeleader.analyze(validationInput(import.meta.url,'v0')));
  await page.waitForFunction(()=>window._index&&['partial','complete'].includes(window._index.status));
  const index=await page.evaluate(()=>window._index);
  const layouts=[],captures=[];
  const stable=async()=>{await page.waitForFunction(()=>document.querySelector('.graph-canvas')?.dataset.layoutBusy==='false');await page.waitForTimeout(320);assert.equal(await page.locator('.graph-budget[role=alert]').count(),0,await page.locator('.graph-budget[role=alert]').allTextContents());};
  const shot=async task=>{await stable();if(!before)await page.waitForFunction(()=>!document.querySelector('.reading-edge'));const data=await app.evaluate(async({BrowserWindow})=>(await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));fs.writeFileSync(managedPath(path.join(output,`${phase}-${width}x${height}-${task}.png`)),Buffer.from(data,'base64'));captures.push({task,viewport:await page.locator('.react-flow__viewport').getAttribute('style')});};
  const geometry=async label=>{await stable();const snapshot=await page.evaluate(()=>window._layout);for(const edge of snapshot.edges){const from=snapshot.nodes.find(n=>n.ports.some(p=>p.id===edge.sourcePort)),to=snapshot.nodes.find(n=>n.ports.some(p=>p.id===edge.targetPort)),a=from.ports.find(p=>p.id===edge.sourcePort),b=to.ports.find(p=>p.id===edge.targetPort);assert.deepEqual(edge.points[0],{x:from.x+a.x,y:from.y+a.y});assert.deepEqual(edge.points.at(-1),{x:to.x+b.x,y:to.y+b.y});for(let i=1;i<edge.points.length;i++){const p=edge.points[i-1],q=edge.points[i];assert.ok(p.x===q.x||p.y===q.y);for(const node of snapshot.nodes.filter(n=>n.id!==from.id&&n.id!==to.id))assert.ok(!segmentHits(p,q,node),label+': '+edge.id+' intersects '+node.id);}}
   const handles=await page.evaluate(()=>{const host=document.querySelector('.graph-canvas').getBoundingClientRect(),m=new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.react-flow__viewport')).transform);return [...document.querySelectorAll('.react-flow__handle')].map(el=>{const r=el.getBoundingClientRect();return{id:el.dataset.handleid,x:(r.left+r.width/2-host.left-m.e)/m.a,y:(r.top+r.height/2-host.top-m.f)/m.d};});});let delta=0;for(const n of snapshot.nodes)for(const p of n.ports){const h=handles.find(h=>h.id===p.id);assert.ok(h);delta=Math.max(delta,Math.abs(h.x-n.x-p.x),Math.abs(h.y-n.y-p.y));}assert.ok(delta<.6,'Handle mismatch '+delta);layouts.push({label,nodes:snapshot.nodes.length,edges:snapshot.edges.length,maxHandleError:delta});return snapshot;
  };
  await shot('main');
  if(before){
   fs.writeFileSync(path.join(output,'baseline-index.json'),JSON.stringify(index,null,2));await shot('interfaces');
   await page.getByRole('button',{name:'代码依赖',exact:true}).click();await shot('dependencies');
   for(const [task,name,parent] of [['ask','ask','AiController'],['query','query','create_app'],['task','create','TaskController'],['health','health','create_app']]){
    const s=index.symbols.find(s=>s.name===name&&index.symbols.find(p=>p.id===s.parent)?.name===parent);assert.ok(s);
    await page.keyboard.press('Control+k');await page.getByRole('textbox',{name:'搜索文件与符号'}).fill(name);await page.locator('.symbol-item').and(page.getByTitle(s.qualifiedName,{exact:true})).click();await shot(task);
   }
  }else{
   const baseline=JSON.parse(fs.readFileSync(output+'/baseline-index.json','utf8'));assert.deepEqual(index.files.map(f=>[f.path,f.hash]).sort(),baseline.files.map(f=>[f.path,f.hash]).sort());fs.writeFileSync(output+'/current-index.json',JSON.stringify(index,null,2));
   assert.equal(index.schema,2);assert.ok(index.entities.filter(e=>e.kind==='service').length>=2);assert.equal(await page.locator('.topbar,.sidebar,.metrics-strip,.statusbar').count(),0);
   const main=await geometry('项目主干');assert.ok(main.nodes.every(n=>index.entities.some(e=>e.id===n.id)),'主干只展示有身份的服务与资源，不按数量预算验收');assert.ok(main.edges.length);assert.ok((await page.locator('.view-switch .active').innerText()).includes('项目主干'));
   const card=id=>page.locator('.react-flow__node').and(page.locator(`[data-id="${id}"]`));
   const menu=async()=>{if(!await page.locator('.command-more').evaluate(el=>el.open))await page.getByTitle('更多操作',{exact:true}).click();};const closeMenu=async()=>{if(await page.locator('.command-more').evaluate(el=>el.open))await page.getByTitle('更多操作',{exact:true}).click();};
   const entry=(method,route)=>index.entries.find(e=>e.name.split(' · ')[0]===method+' '+route);
   const pick=async e=>{assert.ok(e);const symbol=index.symbols.find(s=>s.id===e.symbolId);await page.keyboard.press('Control+k');await page.getByRole('textbox',{name:'搜索文件与符号'}).fill(e.name.split(' · ')[0].split(' ').slice(1).join(' '));await page.locator('.symbol-item').and(page.getByTitle(symbol.qualifiedName,{exact:true})).click();await stable();};
   const ask=entry('POST','/api/ai/ask'),query=entry('POST','/internal/query'),task=entry('POST','/api/tasks');
   assert.ok(main.nodes.some(n=>n.id===index.entities.find(e=>e.kind==='domain'&&e.entryIds.includes(task.id))?.id),'主干应能直接选择真实任务创建能力');
   const aiDomain=index.entities.find(e=>e.kind==='domain'&&e.entryIds.includes(ask.id));await card(aiDomain.id).locator('.card-name').click();await geometry('业务域接口分支');await shot('domain');assert.ok(await page.locator('.card-route').filter({hasText:'/api/ai/ask'}).count());
   await page.getByRole('button',{name:'接口导览',exact:true}).click();await geometry('完整接口导览');await shot('interfaces');assert.ok(await page.locator('.entry-previews button').filter({hasText:'/internal/query'}).count());
   await pick(ask);const askLayout=await geometry('AI 问答自动主线');await shot('ask');
   const bounds=await page.locator('.graph-canvas').boundingBox();for(const n of askLayout.nodes){const box=await card(n.id).boundingBox();assert.ok(box.x>=bounds.x&&box.x+box.width<=bounds.x+bounds.width&&box.y>=bounds.y+64&&box.y+box.height<=bounds.y+bounds.height,'默认主线应保持阅读字号并完整位于客户区：'+n.id);}
   for(const name of ['AiGateway.ask','KnowledgeAgent.answer','NoteVectorStore.retrieve'])assert.ok((await page.locator('.card-name').allTextContents()).some(n=>n===name),name);
   assert.ok((await page.locator('.kind-resource .card-name').allTextContents()).includes('Chroma'));assert.ok((await page.locator('.kind-resource .card-name').allTextContents()).includes('knowledge_note'));assert.equal(await page.locator('.kind-resource').filter({hasText:'ChatOpenAI'}).count(),0);
   const retrieve=index.symbols.find(s=>s.qualifiedName.endsWith('NoteVectorStore.retrieve'));await card(retrieve.id).getByRole('button',{name:/^继续/}).click();const grown=await geometry('恢复辅助支线');for(const n of askLayout.nodes){const now=grown.nodes.find(m=>m.id===n.id);assert.deepEqual([now.x,now.y],[n.x,n.y]);}await menu();await page.getByRole('button',{name:'收起扩展',exact:true}).click();await closeMenu();const folded=await geometry('收起辅助支线');assert.deepEqual(folded.nodes.map(n=>[n.id,n.x,n.y]),askLayout.nodes.map(n=>[n.id,n.x,n.y]));
   await page.locator('.edge-label').filter({hasText:/HTTP/}).first().click();await page.waitForSelector('.relation-row[data-relation-type=HTTP]');await shot('http-evidence');
   await page.locator('.relation-row[data-relation-type=HTTP] [data-evidence-kind=config]').filter({hasText:'所选 Compose 环境覆盖'}).click();await page.waitForSelector('.source-evidence');await shot('config-source');assert.ok((await page.locator('.source-path').innerText()).includes('compose.yml'));
   await page.getByRole('tab',{name:'依据',exact:true}).click();await page.locator('.relation-row[data-relation-type=HTTP] [data-evidence-kind=definition]').first().click();await page.waitForSelector('.source-evidence');await shot('cross-source');
   assert.ok((await page.locator('.source-path').innerText()).includes('app/main.py'));await page.locator('.monaco-editor textarea').first().focus();await page.keyboard.press('Control+Enter');await geometry('跨语言源码定位');await page.getByTitle('后退',{exact:true}).click();const restored=await geometry('源码返回位置');assert.deepEqual(restored.nodes.map(n=>[n.id,n.x,n.y]),askLayout.nodes.map(n=>[n.id,n.x,n.y]));await page.keyboard.press('Escape');
   await pick(query);await geometry('Python query 检索落点');await shot('query');assert.ok((await page.locator('.card-name').allTextContents()).includes('Chroma'));
   for(const route of ['/internal/index','/internal/delete']){await pick(entry('POST',route));await geometry(route+' 状态与存储');await shot(route.endsWith('index')?'index':'delete');assert.ok((await page.locator('.card-name').allTextContents()).includes('Chroma'));}
   await pick(task);await geometry('任务创建数据表');await shot('task');assert.ok((await page.locator('.card-name').allTextContents()).includes('learning_task'));
   const write=index.relations.find(r=>r.type==='WRITES'&&r.data?.table==='learning_task');assert.ok(write?.rule&&write.data.sql.includes('INSERT'));
   await pick(entry('GET','/health'));const health=await geometry('健康入口正常叶节点');assert.equal(health.nodes.length,1);assert.equal(health.edges.length,0);assert.ok(await page.getByRole('button',{name:'返回接口列表',exact:true}).count());await shot('health');
   await page.getByRole('button',{name:'项目主干',exact:true}).click();await page.keyboard.press('Control+b');await geometry('抽屉打开');await shot('drawer');await page.keyboard.press('Escape');await geometry('抽屉关闭');
   await page.getByRole('button',{name:'代码依赖',exact:true}).click();await geometry('当前域结构依赖');await shot('dependencies');await menu();await page.getByRole('checkbox',{name:'完整依赖',exact:true}).check();await closeMenu();const collapsed=await geometry('SCC 收敛全依赖');await shot('dependencies-full');
   if(await page.locator('.kind-group').count()){await page.locator('.kind-group').first().getByTitle('展开聚合符号',{exact:true}).click();const expanded=await geometry('SCC 展开回路');for(const n of collapsed.nodes.filter(n=>expanded.nodes.some(m=>m.id===n.id)))assert.deepEqual(expanded.nodes.find(m=>m.id===n.id).x,n.x);await shot('dependencies-expanded');}
   await page.getByTitle('查看分析状态与范围',{exact:true}).click();await shot('analysis');await page.keyboard.press('Escape');
   await page.locator('.command-configuration').click();await shot('settings');assert.ok(await page.getByRole('combobox',{name:'静态配置参照',exact:true}).count());await page.getByRole('checkbox',{name:'界面动画'}).uncheck();
   if(width===1564){await page.getByRole('combobox',{name:'静态配置参照',exact:true}).selectOption('defaults');await page.waitForFunction(()=>window._index?.configurationId==='defaults'&&['partial','complete'].includes(window._index.status));const defaultIndex=await page.evaluate(()=>window._index);assert.notEqual(defaultIndex.createdAt,index.createdAt);assert.ok(!defaultIndex.relations.some(r=>r.type==='HTTP'&&r.http?.path==='/internal/query'&&defaultIndex.symbols.some(s=>s.id===r.to)),'默认 localhost 端口不能被当作 Compose 服务身份');
    await page.getByRole('combobox',{name:'静态配置参照',exact:true}).selectOption(index.configurationId);await page.waitForFunction(id=>window._index?.configurationId===id&&['partial','complete'].includes(window._index.status),index.configurationId);assert.notEqual((await page.evaluate(()=>window._index)).createdAt,defaultIndex.createdAt);assert.ok(await page.getByTitle('后退',{exact:true}).isDisabled());
   }await page.keyboard.press('Escape');assert.ok(await page.locator('.app.reduce-motion').count());await geometry('配置 / 动效切换后');
   if(width===1564){
    await page.evaluate(root=>window.codeleader.analyze(root),path.join(root,'tests/fixtures/main-flow'));await page.waitForFunction(()=>window._index?.root.replaceAll('\\','/').endsWith('/tests/fixtures/main-flow')&&['partial','complete'].includes(window._index.status));
    const fixture=await page.evaluate(()=>window._index);for(const [name,kind] of [['Derived','EXTENDS'],['First','IMPLEMENTS'],['Specialized','EXTENDS']]){const target=fixture.symbols.find(s=>s.name===name);await page.keyboard.press('Control+k');await page.getByRole('textbox',{name:'搜索文件与符号'}).fill(name);await page.locator('.symbol-item').and(page.getByTitle(target.qualifiedName,{exact:true})).click();await menu();await page.getByRole('combobox',{name:'关系类型',exact:true}).selectOption('types');await closeMenu();await geometry('源码 fixture 类型线型 '+name);const edge=page.locator('.relation-'+kind+' .react-flow__edge-path').first();assert.ok((await edge.getAttribute('marker-end')).includes('type-triangle'));const dash=await edge.evaluate(el=>getComputedStyle(el).strokeDasharray);assert.equal(dash==='none',kind==='EXTENDS');await shot('types-'+name.toLowerCase());}
   }
  }
  if(!before)for(const file of index.files){const crypto=await import('node:crypto');assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(index.root,file.path))).digest('hex'),file.hash);}
  const runtime=await page.evaluate(()=>window.codeleader.runtime()),realPaths={};for(const [key,p] of Object.entries(runtime.managedPaths)){managedPath(p);realPaths[key]=fs.realpathSync.native(p);}reports.push({width,height,client:await page.evaluate(()=>[innerWidth,innerHeight,devicePixelRatio]),runtime,realPaths,layouts,captures,errors});assert.deepEqual(errors,[]);
 }catch(error){const page=await app.firstWindow();fs.writeFileSync(path.join(output,`${phase}-${width}x${height}-failure.json`),JSON.stringify(await page.evaluate(()=>({request:window._layoutRequest,layout:window._layout})),null,2));const data=await app.evaluate(async({BrowserWindow})=>(await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));fs.writeFileSync(path.join(output,`${phase}-${width}x${height}-failure.png`),Buffer.from(data,'base64'));throw error;}finally{await app.close();}
}
fs.writeFileSync(path.join(output,`${phase}-conditions.json`),JSON.stringify(reports,null,2));console.log(JSON.stringify({phase,windows:reports.length}));
