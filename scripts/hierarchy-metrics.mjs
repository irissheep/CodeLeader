import {scanLayout} from './layout-probe.mjs';
export function hierarchyMetrics(){
 const root=document.querySelector('.graph-canvas'),area=root.querySelector('.react-flow').getBoundingClientRect(),nodes=[...root.querySelectorAll('.react-flow__node')].map(n=>n.getBoundingClientRect()),blocks=[...root.querySelectorAll('[data-module-block]')];
 const bounds=nodes.length?{left:Math.min(...nodes.map(r=>r.left)),right:Math.max(...nodes.map(r=>r.right)),top:Math.min(...nodes.map(r=>r.top)),bottom:Math.max(...nodes.map(r=>r.bottom))}:null;
 const values=blocks.map(b=>({id:b.dataset.moduleBlock,name:b.dataset.moduleName,count:Number(b.dataset.entryCount),widthTier:Number(b.dataset.moduleWidth),scale:Number(b.dataset.moduleScale),renderedWidth:b.getBoundingClientRect().width,frontend:Number(b.dataset.frontendCount),selected:b.getAttribute('aria-pressed')==='true'}));
 return {nodeCount:nodes.length,widthFraction:bounds?(bounds.right-bounds.left)/area.width:0,croppedNodes:nodes.filter(r=>r.left<area.left-1||r.top<area.top-1||r.right>area.right+1||r.bottom>area.bottom+1).length,blocks:values,widthTiers:[...new Set(values.map(b=>b.widthTier))],numericNames:values.filter(b=>/^\d+$/.test(b.name)),legends:[...root.querySelectorAll('.module-legend')].map(e=>e.textContent),emptyLegends:[...root.querySelectorAll('.module-legend')].filter(e=>!e.textContent.trim()||!e.closest('.module-groups')?.querySelector('[data-frontend-count]:not([data-frontend-count="0"])')).length,emptyCards:[...root.querySelectorAll('.react-flow__node')].filter(e=>!e.textContent.trim()).length};
}
export async function verifyHierarchy(page,index,policy,tokens,{name,capture,interactions=false}){
 const metrics=await page.evaluate(hierarchyMetrics),issues=[];
 for(const block of metrics.blocks){
  const domain=index.entities?.find(e=>e.kind==='domain'&&e.id===block.id),members=domain?index.entries.filter(e=>e.kind==='http'&&domain.entryIds.includes(e.id)):index.entries.filter(e=>'entry-group:'+e.group===block.id&&e.kind==='http');
  const width=tokens.moduleWidths.find(t=>members.length>=t.minimum).width;
  if(members.length!==block.count||width!==block.widthTier)issues.push({kind:'width-tier',id:block.id,count:block.count,expectedCount:members.length,width:block.widthTier,expectedWidth:width});
 }
 const hovered=[];
 for(const [i,block]of metrics.blocks.entries()){
  const button=page.locator(`[data-module-block="${block.id.replaceAll('\\','\\\\').replaceAll('"','\\"')}"]`);await button.hover();await page.waitForTimeout(160);
  const result=await page.evaluate(()=>{
   const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width&&r.height&&s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity)>0;};
   const popups=[...document.querySelectorAll('[role=tooltip]')].filter(visible),popup=document.querySelector('.module-tooltip'),rect=popup?.getBoundingClientRect(),blocks=[...document.querySelectorAll('[data-module-block]')];
   return{count:popups.length,placed:popup&&visible(popup),text:popup?.textContent,overlaps:rect?blocks.flatMap(b=>{const r=b.getBoundingClientRect(),width=Math.max(0,Math.min(rect.right,r.right)-Math.max(rect.left,r.left)),height=Math.max(0,Math.min(rect.bottom,r.bottom)-Math.max(rect.top,r.top));return width*height?[{id:b.dataset.moduleBlock,area:width*height}]:[];}):[],nodePositions:[...document.querySelectorAll('.react-flow__node')].map(e=>({id:e.dataset.id,transform:e.style.transform})),focusBand:getComputedStyle(document.querySelector('.hierarchy-focus-band')||document.body).opacity};
  });
  const layout=await page.evaluate(scanLayout,policy);hovered.push({id:block.id,...result,violations:layout.violations});
  if(result.count!==1||!result.placed||result.overlaps.length||/按 Enter 打开|\.(?:java|py|vue|tsx?)[:\s]/.test(result.text||''))issues.push({kind:'tooltip',id:block.id,...result});
  if(layout.violations.length)issues.push({kind:'tooltip-layout',id:block.id,violations:layout.violations});
  if(i===0)await capture(name+'/hover');
 }
 await page.mouse.move(5,50);
 if(metrics.numericNames.length||metrics.emptyLegends||metrics.emptyCards)issues.push({kind:'content',numeric:metrics.numericNames,emptyLegends:metrics.emptyLegends,emptyCards:metrics.emptyCards});
 const checks={};
 if(interactions&&name.includes('/guide/')&&metrics.blocks.length){
  const selected=metrics.blocks.find(b=>b.selected),last=metrics.blocks.at(-1),button=page.locator(`[data-module-block="${last.id.replaceAll('\\','\\\\').replaceAll('"','\\"')}"]`);
  const before=await page.evaluate(()=>{window.__u5Nodes=[...document.querySelectorAll('.react-flow__node')];return window.__u5Nodes.map(e=>({id:e.dataset.id,transform:e.style.transform}));});
  await button.click();await page.waitForTimeout(250);
  checks.selection=await page.evaluate(()=>({selected:document.querySelector('[data-module-block][aria-pressed=true]')?.dataset.moduleBlock,rows:document.querySelectorAll('.hierarchy-interface-item').length,recreated:window.__u5Nodes.filter(e=>!e.isConnected).length,positions:[...document.querySelectorAll('.react-flow__node')].map(e=>({id:e.dataset.id,transform:e.style.transform}))}));
  if(checks.selection.selected!==last.id||checks.selection.rows!==last.count||checks.selection.recreated||JSON.stringify(before)!==JSON.stringify(checks.selection.positions))issues.push({kind:'module-selection',...checks.selection});
  const links=index.frontendLinks?.calls||[],candidate=index.frontend?.httpCalls.find(c=>c.pageIds.length===1&&links.some(l=>l.callId===c.id&&l.targets.length===1&&metrics.blocks.some(b=>index.entities?.find(e=>e.id===b.id)?.entryIds?.includes(l.targets[0].entryId))));
  if(candidate){
   const link=links.find(l=>l.callId===candidate.id),entry=index.entries.find(e=>e.id===link.targets[0].entryId),domain=index.entities.find(e=>e.kind==='domain'&&e.entryIds?.includes(entry.id));
   await page.locator('[data-module-block]').evaluateAll((nodes,id)=>nodes.find(e=>e.dataset.moduleBlock===id).click(),domain.id);await page.waitForTimeout(200);
   const path=entry.pathEvidence?.path||entry.name.split(' · ')[0].split(' ')[1],pageInfo=index.frontend.pages.find(p=>p.id===candidate.pageIds[0]),component=index.frontend.modules.find(m=>pageInfo.componentModuleIds.includes(m.id)),expected=(component?.location||pageInfo.location).file;
   const badge=page.locator('.hierarchy-page-count').filter({hasText:/前端 [1-9]/});const wanted=await badge.evaluateAll((nodes,path)=>nodes.findIndex(e=>e.getAttribute('aria-label')?.endsWith(' · '+path)),path);
   if(wanted>=0){await badge.nth(wanted).click();await page.waitForSelector('.inspector .source-path');const actual=await page.locator('.inspector .source-path').textContent();checks.pageJump={expected,actual,passed:actual===expected};if(actual!==expected)issues.push({kind:'page-jump',expected,actual});await capture(name+'/page-source');await page.getByTitle('关闭检查面板',{exact:true}).click();}
  }else checks.pageJump={available:false,reason:'本模块对应的前端调用没有已关联的单一页面；保留已有调用位置。'};
  if(selected)await page.locator('[data-module-block]').evaluateAll((nodes,id)=>nodes.find(e=>e.dataset.moduleBlock===id).click(),selected.id);await page.mouse.move(5,50);await page.evaluate(()=>document.activeElement?.blur());
 }
 if(interactions&&name.includes('/main/')){
  checks.resources=[];
  const resources=await page.locator('.graph-card.kind-resource').all();
  for(const card of resources.slice(0,2)){
   const label=await card.locator('.card-summary').textContent();await card.click();await page.waitForSelector('.inspector');const conclusion=await page.locator('.inspector .relation-conclusion').textContent();checks.resources.push({label,conclusion,passed:label===conclusion});if(label!==conclusion)issues.push({kind:'resource-wording',label,conclusion});await capture(name+'/resource-'+checks.resources.length);await page.getByTitle('关闭检查面板',{exact:true}).click();await page.waitForTimeout(250);
  }
  if(resources.length){await page.locator('.react-flow__pane').click({position:{x:5,y:5},force:true});await page.waitForTimeout(200);}
 }
 return{...metrics,hovered,checks,issues};
}
