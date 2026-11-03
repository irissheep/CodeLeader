import fs from 'node:fs/promises';
import path from 'node:path';
import {repository} from './acquire.mjs';

const output=path.join(repository,'.tmp/verification-generalization-baseline');
const report=path.join(repository,'.tmp/verification-f1-discovery/WORKSPACE-I.json');
const result=JSON.parse(await fs.readFile(report,'utf8'));
const rows=new Map(result.trials.map(item=>[item.project,item]));
const projects=new Set(JSON.parse(await fs.readFile(path.join(repository,'corpus/manifest.json'),'utf8')).projects.map(item=>item.id));
const file=path.join(output,'SCORECARD.md');
const original=await fs.readFile(file,'utf8');
await fs.writeFile(path.join(output,'SCORECARD-before-workspace.md'),original);
let inTable=false;
const lines=original.split('\n').map(line=>{
 if(line.startsWith('| 项目 | A 项目单元 |')){inTable=true;return line.replace(/\|\s*$/,'| I 目录发现 |');}
 if(inTable&&!line.startsWith('|'))inTable=false;
 if(!inTable)return line;
 if(/^\|\s*---\s*\|/.test(line)&&line.split('|').length===11)return line.replace(/\|\s*$/,'| --- |');
 const id=/^\|\s*([^|]+?)\s*\|/.exec(line)?.[1];if(!projects.has(id))return line;const item=rows.get(id);
 const text=!item?'✗ 未完成 · 查看发现日志':item.ok?'△ 发现 3/3 · 结构一致 · 完整评分未核对':`✗ 发现 ${item.found.filter(Boolean).length}/3 · ${item.error||'结构不一致'}`;
 return line.replace(/\|\s*$/,`| ${text} |`);
});
lines.push('','I 列从父目录实际发现并分析三个项目；该检查比较接口、业务模块和前端对接事实，不等同于完整 A–H 评分哈希。完整评分未核对时不能判为通过。');
await fs.writeFile(file,lines.join('\n'));
