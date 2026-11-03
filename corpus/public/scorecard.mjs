import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export async function writeScorecard(inputFile,outputFile,workspace) {
const manifest = JSON.parse(await fs.readFile(path.join(root, 'corpus/public/manifest.json'), 'utf8'));
const input = inputFile ? path.resolve(inputFile) : path.join(root, '.tmp/verification-generalization-baseline/scorecard-hg-v3.json');
const output = outputFile ? path.resolve(outputFile) : path.join(root, '.tmp/verification-generalization-baseline/PUBLIC-PRIVATE-SCORECARD.md');
const saved = await fs.readFile(input, 'utf8').then(JSON.parse).catch(error => {
  if (error.code === 'ENOENT') return null;
  throw error;
});
if (saved && !Array.isArray(saved.projects)) throw Error('Invalid scorecard: projects must be an array');
const rows = saved?.projects ?? [];
const publicIds = new Set(manifest.projects.map(project => project.id));
const privateSaved = await fs.readFile(path.join(root,'corpus/private/scorecard.json'),'utf8').then(JSON.parse).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
if(privateSaved&&!Array.isArray(privateSaved.projects))throw Error('Invalid private scorecard: projects must be an array');
const privateRows = [...rows.filter(row => !publicIds.has(row.project)),...(privateSaved?.projects||[])];
const privateManifest = await fs.stat(path.join(root,'corpus/private/manifest.json')).then(()=>true,error=>error.code==='ENOENT'?false:Promise.reject(error));
const escape = value => String(value).replaceAll('|', ' / ').replaceAll('\n', ' ');
const lines = [
  '# 公开与私有语料评分', '',
  '本表整理指定的评分结果；若单独提供私有结果，它仅是已有结果，不代表本次重新分析。', '',
  '| 类别 | 项目 | A | B | C | D | E | F | G | H | I |',
  '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
];
for (const project of manifest.projects) {
  const row = rows.find(item => item.project === project.id);
  const skipped=project.license==='未知'?'已跳过（许可证未核实）':'未评估（没有当前结果）';
  const grades = [...'ABCDEFGH'].map(key => row?.grades?.[key] ? escape(`${row.grades[key].status} ${row.grades[key].text}`) : skipped);
  const trial=workspace?.trials?.find(item=>item.project===project.id);
  const discovery=!trial?skipped:trial.ok?'△ 发现 3/3 · 结构一致 · 完整评分未核对':`✗ 发现 ${(trial.found||[]).filter(Boolean).length}/3`;
  lines.push(`| 公开 | ${escape(project.id)} | ${grades.join(' | ')} | ${discovery} |`);
}
const totals = [...'ABCDEFGH'].map(key => {
  if (!privateRows.length) return privateManifest?'未启用（私有评分未运行）':'已跳过（未找到私有语料）';
  const counts = {pass: 0, partial: 0, fail: 0, other: 0};
  for (const row of privateRows) {
    const status = row.grades?.[key]?.status;
    counts[status === '✓' ? 'pass' : status === '△' ? 'partial' : status === '✗' ? 'fail' : 'other']++;
  }
  return `✓ ${counts.pass} · △ ${counts.partial} · ✗ ${counts.fail} · 未评估 ${counts.other}`;
});
lines.push(`| 私有 | 仅汇总 ${privateRows.length} 项 | ${totals.join(' | ')} | 未评估 |`, '');
await fs.mkdir(path.dirname(output), {recursive: true});
await fs.writeFile(output, lines.join('\n'), 'utf8');
console.log(`公开 ${manifest.projects.length} 项；私有 ${privateRows.length} 项（仅汇总）。`);
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)await writeScorecard(process.argv[2],process.argv[3]);
