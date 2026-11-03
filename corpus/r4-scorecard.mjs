import fs from 'node:fs/promises';
import path from 'node:path';
import {repository,records} from './acquire.mjs';
const out=path.join(repository,'.tmp/verification-generalization-baseline');
const read=async file=>JSON.parse(await fs.readFile(file,'utf8'));
const current=await read(path.join(out,'scorecard-v2.json'));
const cells=[],clean=value=>String(value).replaceAll('|',' / ').replaceAll('\n',' ');
const canonical=value=>String(value).replace(/\{[^{}]*\}/g,'{param}');
const within=(location,item)=>location.file===item.file&&location.range.start.line<=item.line-1&&location.range.end.line>=item.line-1;
function routePaths(text){
 if(text.startsWith('{[')&&text.endsWith(']}'))try{return JSON.parse(text.slice(1,-1));}catch{}
 if(text.startsWith('"'))try{return[JSON.parse(text)];}catch{}
 return[text];
}
function compare(expected,actual,kind){
 const used=new Set(),issues=[];let matched=0;
 for(const item of expected){const candidate=actual.find(row=>!used.has(row.id)&&within(row.location,item));
  if(!candidate){issues.push({kind:'missing',expected:item,reason:'该源码位置没有对应的产品字段'});continue;}
  used.add(candidate.id);
  const paths=kind==='page'?candidate.rawPaths:[candidate.url],target=kind==='page'?routePaths(item.path):[item.path];
  const correct=target.every(p=>paths.some(a=>canonical(a)===canonical(p)))&&(kind==='page'||candidate.method===item.method);
  if(correct)matched++;else issues.push({kind:'different',expected:item,actual:candidate,reason:kind==='api'&&candidate.method!==item.method?'源码中的 HTTP 方法与冻结答案不同':'路径与冻结答案不同，保留原值与出处'});
 }
 for(const item of actual)if(!used.has(item.id))issues.push({kind:'extra',actual:item,reason:'产品从源码确认的额外位置，冻结答案不变'});
 return{matched,issues};
}
for(const project of current.projects){
 const model=await read(path.join(out,project.project,'model.json')),expected=await read(path.join(records,'expected',project.project,'expected.json')),front=model.frontend;
 const pages=(front?.pages||[]).filter(p=>!p.test),api=(front?.httpCalls||[]).filter(p=>!p.test),pageComparison=compare(expected.frontend.pages.items,pages,'page'),apiComparison=compare(expected.frontend.api.items,api,'api');
 const unknown=api.filter(c=>c.addressStatus==='unknown'),transportUnknown=(front?.transports||[]).filter(c=>!c.test&&c.addressStatus==='unknown');
 const issues=[...pageComparison.issues.map(i=>({area:'pages',...i})),...apiComparison.issues.map(i=>({area:'api',...i}))];
 const grade={status:!front?'✗':issues.length||pages.length!==expected.frontend.pages.count||api.length!==expected.frontend.api.count?'△':'✓',text:`页面 ${pages.length}/${expected.frontend.pages.count} · API ${api.length}/${expected.frontend.api.count} · 未定址 ${unknown.length} · 对接未做（R5）`,metrics:{actualPages:pages.length,expectedPages:expected.frontend.pages.count,matchedPageDefinitions:pageComparison.matched,actualApi:api.length,expectedApi:expected.frontend.api.count,matchedApiDefinitions:apiComparison.matched,unknownAddresses:unknown.length,transportUnknown:transportUnknown.length,transports:front?.transports.length||0,matchedBackend:null,frontendFiles:model.frontendFiles?.length||0},reason:'E-v2 直接读取产品前端语义字段；页面/API 的冻结数量与来源不变，差额逐项保存。前后端匹配留给 R5，不计入本轮通过。'};
 project.grades.E=grade;
 cells.push({project:project.project,grade,issues,unknown,transportUnknown,pages,api,proxies:front?.proxies||[],diagnostics:front?.diagnostics||[]});
}
current.versions.E=2;
await fs.writeFile(path.join(out,'frontend-scorecard.json'),JSON.stringify({version:'E-v2',cells},null,2));
await fs.writeFile(path.join(out,'scorecard-v2.json'),JSON.stringify(current,null,2));
const md=['# 当前评分卡：A/B-v2、E-v2、G-v2；其余 v1','', 'E-v2 定义见 corpus/SCORECARD-E-V2.md。前后端匹配未做（R5）；v1 与所有冻结答案保留。','', '| 项目 | A | B | C | D | E | F | G | H |','|---|---|---|---|---|---|---|---|---|',...current.projects.map(p=>`| ${p.project} | ${[...'ABCDEFGH'].map(k=>clean(p.grades[k].status+' '+p.grades[k].text)).join(' | ')} |`),'','## E：v1 与 v2 并排','', '| 项目 | E-v1 | E-v2 | 原因 |','|---|---|---|---|',...current.projects.map(p=>`| ${p.project} | ${clean(p.afterV1.E.status+' '+p.afterV1.E.text)} | ${clean(p.grades.E.status+' '+p.grades.E.text)} | 读取新增产品字段；原答案不变；后端匹配不在本轮范围。 |`),'','## 差额逐项',''];
for(const row of cells)for(const issue of row.issues){const item=issue.actual?.location?{file:issue.actual.location.file,line:issue.actual.location.range.start.line+1}:issue.expected;md.push(`- ${row.project} / ${issue.area} / ${issue.kind}：${item.file}:${item.line}。${issue.reason}。${issue.expected?'期望 '+(issue.expected.method||'')+' '+issue.expected.path+'；':''}${issue.actual?'实际 '+(issue.actual.method||'')+' '+(issue.actual.url||issue.actual.rawPaths.join(' / ')):''}`);}
await fs.writeFile(path.join(out,'SCORECARD-V2.md'),md.join('\n')+'\n');
console.log('R4 E-v2',cells.map(p=>`${p.project} ${p.grade.status} ${p.grade.metrics.actualPages}/${p.grade.metrics.actualApi}`).join('; '));
