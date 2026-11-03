import fs from 'node:fs/promises';
import path from 'node:path';
import {repository as root} from './acquire.mjs';
import {verifyHonestUI} from '../scripts/verify-r8-ui.mjs';
import {scoreHonestyV3,scorecardMarkdown} from './honesty-v3.mjs';
import {run} from '../scripts/common.mjs';
const output=path.join(root,'.tmp/verification-generalization-baseline'),folder=path.join(output,'honesty-v3');
const read=async file=>JSON.parse(await fs.readFile(file,'utf8'));
await fs.mkdir(folder,{recursive:true});const projects=(await read(path.join(output,'active-manifest.json'))).projects.map(p=>({id:p.id}));
await fs.writeFile(path.join(folder,'projects.json'),JSON.stringify(projects,null,2));
await verifyHonestUI(root,folder,'after',{models:output});
const v2=await read(path.join(output,'scorecard-v4.json')),ui=await read(path.join(folder,'after/ui.json')),models={},notes={};
for(const p of projects){models[p.id]=await read(path.join(output,p.id,'model.json'));notes[p.id]=await read(path.join(folder,'after',p.id,'notes.json'));}
const v3=await scoreHonestyV3(v2,models,ui,notes,path.join(folder,'after'));
await fs.writeFile(path.join(output,'scorecard-hg-v3-legacy.json'),JSON.stringify(v3,null,2));
const revisedFolder=path.join(output,'honesty-v3-u9c'),resultPath=path.join(revisedFolder,'H-V3-U9C.json'),started=Date.now();
try{await run(process.execPath,[path.join(root,'scripts/check-u9c-honesty.mjs')],{env:{...process.env,CODELEADER_U9C_OUTPUT:revisedFolder,CODELEADER_U9C_MODELS:output}});}catch(error){console.error('H-v3 revised check:',String(error));}
const resultStat=await fs.stat(resultPath).catch(()=>undefined);if(!resultStat||resultStat.mtimeMs<started-1000)throw Error('H-v3 revised check did not produce a current result');
const results=await read(resultPath),byProject=new Map(results.map(result=>[result.project,result]));
const revised=structuredClone(v3);revised.versions.H='H-v3-u9c';
for(const project of revised.projects){const result=byProject.get(project.project);if(!result){project.grades.H={status:'✗',text:'未完成实际界面检查',metrics:{failures:['缺少项目检查结果']},reason:'H-v3 修订版：不得复用过期结果。'};continue;}project.grades.H={status:result.score.status,text:`三视图 · 问题与明细 ${result.observed.views.filter(v=>v.issueCount===v.rows).length}/3 · 说明 ${result.score.failures.length?'有缺项':'已检查'}`,metrics:{...result.score.requirements,failures:result.score.failures},reason:'H-v3 修订版：保留来源、缺项说明和真实截图检查，按视图核对按钮与逐条明细。'};}
await fs.writeFile(path.join(output,'scorecard-hg-v3.json'),JSON.stringify(revised,null,2));
await fs.writeFile(path.join(output,'scorecard-v2-v3.json'),JSON.stringify({v2,v3:revised,legacyV3:v3},null,2));
await fs.writeFile(path.join(output,'SCORECARD-HG-V3.md'),scorecardMarkdown(v2,revised)+'\n旧 H-v3 结果保存在 scorecard-hg-v3-legacy.json；修订版逐视图证据在 honesty-v3-u9c/H-V3-U9C.json。\n');
console.log('H-v3 revised',revised.projects.filter(p=>p.grades.H.status==='✓').length+'/'+revised.projects.length,'legacy',v3.projects.filter(p=>p.grades.H.status==='✓').length+'/'+v3.projects.length,'G unevaluated',revised.projects.filter(p=>p.grades.G.status==='未评估').length);
