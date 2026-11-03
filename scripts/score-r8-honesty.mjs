import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {root,guard} from './common.mjs';
import {scoreHonestyV3,scorecardMarkdown} from '../corpus/honesty-v3.mjs';
guard();
const out=path.join(root,'.tmp/verification-r8-honest-states'),read=async file=>JSON.parse(await fs.readFile(file,'utf8')),hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const v2=await read(path.join(out,'frozen-v2.json')),models={},notes={},beforeNotes={};
for(const p of v2.projects){models[p.project]=await read(path.join(out,'corpus-after',p.project,'model.json'));notes[p.project]=await read(path.join(out,'after',p.project,'notes.json'));beforeNotes[p.project]=await read(path.join(out,'before',p.project,'notes.json'));}
const ui=await read(path.join(out,'after/ui.json')),beforeUI=await read(path.join(out,'before/ui.json'));
const v3=await scoreHonestyV3(v2,models,ui,notes,path.join(out,'after')),v3Before=await scoreHonestyV3(v2,models,beforeUI,beforeNotes,path.join(out,'before'));
const differences=[];for(const row of v3.projects){const old=v2.projects.find(p=>p.project===row.project);for(const key of 'ABCDEFGH')if(JSON.stringify(old.grades[key])!==JSON.stringify(row.grades[key]))differences.push({project:row.project,column:key,before:old.grades[key].status,after:row.grades[key].status,reason:row.grades[key].reason});}
if(differences.some(d=>!'GH'.includes(d.column)))throw Error('v2/v3 changed A–F');
const before=await read(path.join(out,'corpus-before/scorecard-v4.json')),after=await read(path.join(out,'corpus-after/scorecard-v4.json')),regressions=[];
for(const p of before.projects){const current=after.projects.find(r=>r.project===p.project);for(const k of 'ABCDEFGH')if(JSON.stringify(p.grades[k])!==JSON.stringify(current.grades[k]))regressions.push({project:p.project,column:k,before:p.grades[k],after:current.grades[k]});}
const frozen=await read(path.join(out,'source-before.json')),changed=[];for(const[file,old]of Object.entries(frozen))if(hash(await fs.readFile(path.join(root,file)))!==old)changed.push(file);
const prohibited=changed.filter(f=>f.startsWith('analyzers/')||f.startsWith('runtime/')||f.startsWith('src/analysis/')||f==='src/shared/frontend-model.ts'||f==='src/shared/frontend-links.ts'||f==='src/renderer/flow-model.ts'||f==='src/runtime/replay.ts');
if(prohibited.length)throw Error('Recognition/playback implementation changed: '+prohibited.join(', '));
const immutable=[];for(const file of ['corpus/expected.lock.json','corpus/baseline.json','.tmp/verification-blind-test/expected.lock.json'])immutable.push({file,sha256:hash(await fs.readFile(path.join(root,file)))});
await fs.writeFile(path.join(out,'scorecard-v2.json'),JSON.stringify(v2,null,2));await fs.writeFile(path.join(out,'scorecard-v3.json'),JSON.stringify(v3,null,2));await fs.writeFile(path.join(out,'scorecard-v3-before.json'),JSON.stringify(v3Before,null,2));
await fs.writeFile(path.join(out,'scorecard-v2-v3.json'),JSON.stringify({v2,v3},null,2));await fs.writeFile(path.join(out,'SCORECARD-V2-V3.md'),scorecardMarkdown(v2,v3));
await fs.writeFile(path.join(out,'comparison.json'),JSON.stringify({differences,regressions,changedProductFiles:changed,prohibitedProductChanges:prohibited,immutable,HBefore:v3Before.projects.filter(p=>p.grades.H.status==='✓').length,HAfter:v3.projects.filter(p=>p.grades.H.status==='✓').length},null,2));
console.log('R8 H-v3',v3.projects.filter(p=>p.grades.H.status==='✓').length+'/11','v2/v3 non-GH differences 0','original-score differences',regressions.length);
if(v3.projects.some(p=>p.grades.H.status!=='✓')){console.log(JSON.stringify(v3.projects.filter(p=>p.grades.H.status!=='✓').map(p=>({project:p.project,failures:p.grades.H.metrics.failures})),null,2));process.exitCode=1;}
