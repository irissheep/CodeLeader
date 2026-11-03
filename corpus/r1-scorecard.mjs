import fs from 'node:fs/promises';
import path from 'node:path';
import {repository,records} from './acquire.mjs';
const read=async file=>JSON.parse(await fs.readFile(file,'utf8'));
const current=path.join(repository,'.tmp/verification-generalization-baseline');
const previous=await read(path.join(records,'baseline-subset.json')),v1=await read(path.join(current,'scorecard.json'));
const projects=[];
function grade(m){
 const status=!m.nodes||m.silentOmissions!==0||m.missingRelations.length||m.roleOrClassCards<m.nodes||m.placeholder||!m.layerAssessed||m.layerCorrect<m.layerTotal||m.crossings===null||m.crossings>10?'✗':'✓';
 return{status,text:`层级 ${m.layerAssessed?m.layerCorrect+'/'+m.layerTotal:'无法评估（旧卡没有角色）'} · 交叉 ${m.crossings??'无法评估'} · 角色/类数 ${m.roleOrClassCards}/${m.nodes} · 静默截去 ${m.silentOmissions??'无法评估（旧图未保留范围全集）'} · 折叠 ${m.explicitlyFolded??'无法评估'}`,metrics:m,reason:'G-v2 使用实际默认接口链路；按声明角色核对层级，公共卡在侧边，不要求它低于全部业务类；类卡和包卡均按实际可见角色/类数计；明确折叠不算静默截去，全部原始关系须保留。交叉仍使用 R0 正交段交点定义，要求 ≤10。'};
}
for(const project of v1.projects){
 const old=previous.projects.find(p=>p.project===project.project),graphs=await read(path.join(current,project.project,'graphs.json'));
 const beforeDefault=null; // Historical default-layout snapshots are not part of the public corpus.
 projects.push({project:project.project,beforeV1:old.grades,afterV1:project.grades,beforeV2:{...old.grades,G:beforeDefault?grade(beforeDefault.metrics):{status:'✗',text:'无法评估：未重建旧默认视图'}},afterV2:{...project.grades,G:grade(graphs.dependencyMetricsV2)},definitionChange:'仅 G：全项目包卡→默认接口类链，显式折叠与静默截断分开；D/F 保持既有 v1，R00 未完成内容没有并入本轮。'});
}
const destination=process.argv.includes('--report')?root:current;
await fs.mkdir(destination,{recursive:true});await fs.writeFile(path.join(destination,'scorecard-v1-v2.json'),JSON.stringify({versions:['v1','G-v2'],projects},null,2));
const clean=text=>String(text).replaceAll('|',' / ');
const lines=['# R1 前后评分卡与口径','', 'expected、expected.lock 和 baseline 不变。v1 保留原全项目/包名角色匹配口径；G-v2 单列默认接口链路，其他 A–F/H 不换口径。TS/JS 依赖视图仍是 R4 范围，空图明确判失败。','', '| 项目 | A | B | C | D | E | F | G-v1 前→后 | H |','|---|---|---|---|---|---|---|---|---|',...projects.map(p=>`| ${p.project} | ${[...'ABCDEFGH'].map(k=>clean(`${p.beforeV1[k].status} ${p.beforeV1[k].text} → ${p.afterV1[k].status} ${p.afterV1[k].text}`)).join(' | ')} |`),'','## G-v1 / G-v2 并排','', '| 项目 | 修复前 v1 | 修复后 v1 | 修复前 G-v2 默认 | 修复后 G-v2 默认 | 口径变化原因 |','|---|---|---|---|---|---|',...projects.map(p=>`| ${p.project} | ${clean(p.beforeV1.G.status+' '+p.beforeV1.G.text)} | ${clean(p.afterV1.G.status+' '+p.afterV1.G.text)} | ${clean(p.beforeV2.G.status+' '+p.beforeV2.G.text)} | ${clean(p.afterV2.G.status+' '+p.afterV2.G.text)} | ${p.definitionChange} |`),'','## 逐格差异',''];
for(const p of projects)for(const k of 'ABCDEFGH'){const a=p.beforeV1[k],b=p.afterV1[k];if(a.status!==b.status||a.text!==b.text)lines.push(`- ${p.project} ${k}：${a.status} ${a.text} → ${b.status} ${b.text}。${k==='G'?'视图变更；旧计分方法保留，实际默认效果看 G-v2。':k==='H'?'真实窗口的节点数随依赖范围改变；空态与主干/接口结果另行核对。':'非目标差异，必须在 REPORT 中解释，不修改答案消除。'}`);}
await fs.writeFile(path.join(destination,process.argv.includes('--report')?'SCORECARD.md':'SCORECARD-G-V2.md'),lines.join('\n')+'\n');console.log(`R1 scorecard: immutable v1 + G-v2, ${projects.length} projects`);
