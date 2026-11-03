import fs from 'node:fs/promises';
import path from 'node:path';
const normal=p=>p.replace(/\\/g,'/').replace(/^\.\//,'').replace(/\/$/,'').toLowerCase();
const within=(file,root)=>!root||root==='.'||normal(file).startsWith(normal(root)+'/');
export function honestyRequirements(model){
 const apps=(model.units||[]).filter(u=>u.kind==='application'),frontends=(model.units||[]).filter(u=>u.kind==='frontend');
 const owner=(file,units)=>units.filter(u=>within(file,u.root)).sort((a,b)=>b.root.length-a.root.length)[0]?.id;
 const web=apps.filter(u=>/Django|Flask|FastAPI|Spring|Quarkus|Micronaut/i.test(u.framework)&&!(model.entries||[]).some(e=>e.kind==='http'&&owner(e.location.file,apps)===u.id)).map(u=>u.id);
 const addresses=new Map();for(const c of model.frontend?.httpCalls||[]){const link=model.frontendLinks?.calls.find(l=>l.callId===c.id);if(!(link?.addresses.length?link.addresses.some(a=>!a.known):c.addressStatus==='unknown'))continue;const unit=model.frontend.modules.find(m=>m.id===c.moduleId)?.unitId||owner(c.location.file,frontends)||owner(c.location.file,apps)||'unassigned';addresses.set(unit,(addresses.get(unit)||0)+1);}
 return{web,addresses:[...addresses].map(([id,count])=>({id,count})),partial:model.status==='partial'};
}
export async function scoreHonestyV3(v2,models,ui,notes,folder){
 const projects=[];
 for(const previous of v2.projects){
  const id=previous.project,model=models[id],row=ui.find(r=>r.project===id),fact=notes[id],required=honestyRequirements(model),failures=[];
  const screenshot=async name=>{const file=path.join(folder,id,name+'.png');const bytes=await fs.readFile(file).catch(()=>undefined);return !!bytes&&bytes.length>500&&bytes.subarray(1,4).toString()==='PNG';};
  const views=[{view:'main',...row?.main},...row?.views||[]];
  if(views.length!==3||views.some(v=>!v.nodes&&!v.empty)||(row?.errors||[]).length)failures.push('三个视图没有完整呈现');
  let web=0,address=0,partial=0;
  for(const unit of required.web){const card=row?.views?.find(v=>v.view==='guide')?.web.find(w=>w.unit===unit),detail=fact?.web.find(w=>w.unitId===unit);
   const sources=detail&&[...detail.basis,...detail.reasons.flatMap(r=>r.evidence)],hasLocation=!!card&&sources?.some(e=>card.text.includes(`${e.location.file}:${e.location.range.start.line+1}`));
   if(card&&detail&&card.text.includes(detail.framework)&&card.text.includes('没识别出接口')&&card.text.includes(`已扫描 ${detail.files.length} 个路由/视图文件`)&&card.text.includes('可能原因')&&card.text.includes('Ctrl+O')&&hasLocation&&await screenshot('guide'))web++;else failures.push('缺少接口未识别说明：'+unit);
  }
  for(const unit of required.addresses){const card=row?.main?.addresses.find(a=>a.unit===unit.id),detail=fact?.addresses.find(a=>a.unitId===unit.id);
   const positions=detail?.calls.every(c=>row.addressHover?.includes(`${c.location.file}:${c.location.range.start.line+1}`)),variables=detail?.calls.every(c=>c.variables.length&&c.variables.every(v=>row.addressHover?.includes(v.name)&&row.addressHover?.includes(v.text)));
   if(card&&detail?.count===unit.count&&card.text.includes(`${unit.count} 处调用`)&&card.text.includes('无法确定指向哪个后端')&&positions&&variables&&row.addressFocusVisible&&await screenshot('addresses'))address++;else failures.push('缺少地址未确定说明：'+unit.id);
  }
  if(required.partial){const matched=fact?.partial?.length>0&&fact.partial.length<=3&&fact.partial.every(p=>row?.partial?.text.includes(p.text)&&row.partial.text.includes(p.impact));
   if(row?.main?.badge==='部分分析'&&matched&&row.partial.rawClosed&&await screenshot('partial'))partial++;else failures.push('缺少部分分析的分类说明');
  }
  const allText=[row?.main?.text,row?.partial?.text,row?.addressHover,...(row?.views||[]).map(v=>v.text)].join('\n'),forbidden=allText.match(/\bpartial\b|\bAST\b|诊断|符号/g)||[];
  if(forbidden.length)failures.push('可见文字含内部用语：'+[...new Set(forbidden)].join('、'));
  const grades=structuredClone(previous.grades),g=grades.G,zero=g.metrics?.layerTotal===0;
  if(zero){grades.G={...g,status:'未评估',text:g.text.replace(/层级\s*0\/0/,'层级未评估（0/0）'),reason:'G-v3：没有可以比较的上下层关系，0/0 不证明分层正确。'};}
  grades.H={status:failures.length?'✗':'✓',text:`3 视图 · 接口说明 ${web}/${required.web.length} · 地址说明 ${address}/${required.addresses.length} · 状态说明 ${partial}/${Number(required.partial)}`,metrics:{web,webRequired:required.web.length,address,addressRequired:required.addresses.length,partial,partialRequired:Number(required.partial),forbidden:forbidden.length,failures},reason:'H-v3：保留三个视图可读检查，增加按实际缺项显示说明的文本、来源与截图核对。'};
  projects.push({...previous,grades});
 }
 return{schema:3,versions:{...v2.versions,G:'G-v3',H:'H-v3'},projects};
}
export function scorecardMarkdown(v2,v3){
 const cell=g=>`${g.status} ${g.text.replaceAll('|','/').replaceAll('\n',' ')}`;
 return ['# 评分卡 v2 / v3','', 'A–F 沿用同一份 v2 结果；G / H 版本并排。✓ 只表示该列检查通过，不表示接口或调用已全部识别。','', '| 项目 | A | B | C | D | E | F | G-v2 | G-v3 | H-v2 | H-v3 |','|---|---|---|---|---|---|---|---|---|---|---|',...v3.projects.map(p=>{const old=v2.projects.find(x=>x.project===p.project);return '| '+[p.project,...'ABCDEF'.split('').map(k=>cell(p.grades[k])),cell(old.grades.G),cell(p.grades.G),cell(old.grades.H),cell(p.grades.H)].join(' | ')+' |';}),''].join('\n');
}
