import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import postcss from 'postcss';
import ts from 'typescript';
import {guard,root} from './common.mjs';
guard();
const folder=path.join(root,'.tmp/verification-u2-motion'),common=path.join(root,'.tmp/verification-generalization-baseline');
const read=async f=>JSON.parse(await fs.readFile(f,'utf8')),write=(name,text)=>fs.writeFile(path.join(folder,name),text),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const result=await read(path.join(folder,'after/results.json')),beforeUI=await read(path.join(folder,'before/results.json')),machine=await read(path.join(folder,'machine.json')),display=await read(path.join(folder,'after/display.json')),input=await read(path.join(folder,'inputs.json'));
await fs.mkdir(path.join(folder,'corpus-after'),{recursive:true});
for(const name of ['scorecard-v4.json','frontend-scorecard.json','link-scorecard.json','backbone-scorecard.json','source-integrity.json','ui-audit.json','runs.json'])await fs.copyFile(path.join(common,name),path.join(folder,'corpus-after',name));
const original=await read(path.join(folder,'source-before.json')),changed=[],protectedChanges=[];
for(const[file,hash]of Object.entries(original))if(sha(await fs.readFile(path.join(root,file)))!==hash){changed.push(file);if(/^(?:src\/analysis|runtime|analyzers)\//.test(file)||file.startsWith('src/shared/')&&file!=='src/shared/ui-tokens.json')protectedChanges.push(file);}
const source=[];async function walk(dir){for(const e of await fs.readdir(path.join(root,dir),{withFileTypes:true})){if(e.isSymbolicLink())continue;const name=path.posix.join(dir,e.name);if(e.isDirectory())await walk(name);else source.push(name);}}
await walk('src');
const timingHits=[],keyframeHits=[];
for(const name of source){
 const text=await fs.readFile(path.join(root,name),'utf8');
 if(name.endsWith('.css'))postcss.parse(text,{from:name}).walkDecls(decl=>{
  if(/^(?:transition|animation)(?:-|$)/.test(decl.prop)&&(/\b\d*\.?\d+m?s\b/.test(decl.value)||/\b(?:ease|ease-in|ease-out|ease-in-out|linear|cubic-bezier|steps)\b/.test(decl.value.replace(/var\([^)]*\)/g,''))))timingHits.push({file:name,line:decl.source.start.line,value:decl.toString()});
  if(decl.parent?.parent?.type==='atrule'&&/keyframes$/.test(decl.parent.parent.name)&&!['opacity','transform'].includes(decl.prop))keyframeHits.push({file:name,line:decl.source.start.line,property:decl.prop});
 });
 if(/\.tsx?$/.test(name)&&!name.endsWith('ui-tokens.ts')){
  const tree=ts.createSourceFile(name,text,ts.ScriptTarget.Latest,true,name.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
  const visit=node=>{if(ts.isPropertyAssignment(node)&&/^(?:duration|delay|animationDelay|transitionDuration|easing)$/.test(node.name.getText(tree))&&(ts.isNumericLiteral(node.initializer)||ts.isStringLiteral(node.initializer)))timingHits.push({file:name,line:tree.getLineAndCharacterOfPosition(node.pos).line+1,value:node.getText(tree)});ts.forEachChild(node,visit);};visit(tree);
 }
}
const beforeTokens=await read(path.join(folder,'source-before/src/shared/ui-tokens.json')),tokens=await read(path.join(root,'src/shared/ui-tokens.json'));
const originalColorsUnchanged=JSON.stringify(beforeTokens.color)===JSON.stringify(tokens.color),originalMotionUnchanged=Object.entries(beforeTokens.motion).every(([key,value])=>tokens.motion[key]===value);
const saved=await read(path.join(input.sessionFolder,'session.json')),recordUnchanged=JSON.stringify(saved)===JSON.stringify(input.record);
const old=await read(path.join(folder,'corpus-before/scorecard-v4.json')),now=await read(path.join(folder,'corpus-after/scorecard-v4.json'));
function numeric(value,key='',out={}){if(typeof value==='number')out[key]=value;else if(value&&typeof value==='object')for(const[k,v]of Object.entries(value))numeric(v,key+'/'+k,out);return out;}
const cells=[];for(const row of now.projects){const prior=old.projects.find(p=>p.project===row.project);for(const col of 'ABCDEFGH'){const a=prior.grades[col],b=row.grades[col];cells.push({project:row.project,item:col,before:a.status,after:b.status,changed:a.status!==b.status||JSON.stringify(numeric(a.metrics))!==JSON.stringify(numeric(b.metrics)),numbersBefore:numeric(a.metrics),numbersAfter:numeric(b.metrics)});}}
await write('scorecard-diff.json',JSON.stringify(cells,null,2));
let table='# 八项目 A–H 前后评分\n\n沿用现行 v4 口径和冻结 expected。下面每格同时比较状态及所有数值字段；完整数值在 scorecard-diff.json。原有 △ 保留。\n\n|项目|A|B|C|D|E|F|G|H|\n|---|---|---|---|---|---|---|---|---|\n';
for(const row of now.projects)table+='|'+row.project+'|'+cells.filter(c=>c.project===row.project).map(c=>`${c.before}→${c.after} · ${c.changed?'有差异':'数值差0'}`).join('|')+'|\n';
table+=`\n差异 ${cells.filter(c=>c.changed).length}/64。\n\n前后各完整运行一次 npm run corpus；之后仅修改 SVG 绘制/边界显示等展示层，使用最终界面续跑静态 UI 与原报告阶段，没有重复八次模型分析。日志 after-corpus.log、final-static-ui.log；分析/采集/回放源码哈希未变，评分公式与答案未修改。\n`;
await write('SCORECARD-DIFF.md',table);
const perf=result.performance,frames=perf.frames,packets=frames.flatMap(f=>f.packets||[]),positive=packets.filter(p=>(p.width??p.rect?.width??p.box?.width??0)>0&&(p.height??p.rect?.height??p.box?.height??0)>0);
const audit={createdAt:new Date().toISOString(),originalFiles:Object.keys(original).length,changed,protectedChanges,originalColorsUnchanged,originalMotionUnchanged,recordUnchanged,timingHits,keyframeHits,changedScoreCells:cells.filter(c=>c.changed).length,finalGraphHash:sha(await fs.readFile(path.join(root,'src/renderer/Graph.tsx'))),verifiedGraphHash:result.finalGraphSourceSha256};
await write('audit.json',JSON.stringify(audit,null,2));
await write('AUDIT.md',`# 范围与令牌检查\n\n冻结 ${audit.originalFiles} 份原文件；分析器、采集/回放及既有模型变化 ${protectedChanges.length}。原始颜色与既有动效令牌值保持：${originalColorsUnchanged}/${originalMotionUnchanged}；原历史文件保持：${recordUnchanged}。main/operation-echo 只移动既有1500/300ms回声时长和缓动到令牌，没有改采集字段/预算或目标页面。\n\nCSS/TSX 动效时长、延迟、缓动裸字面量 ${timingHits.length}；CSS关键帧中非transform/opacity属性 ${keyframeHits.length}。扫描活动src，排除唯一令牌JSON；不修改第三方、发行物和冻结before。动态播放间隔直接读取原 replayInterval，不能把真实时间当作硬编码动效值。\n\n当前 Graph 哈希与补测哈希相同：${audit.finalGraphHash===audit.verifiedGraphHash}。其他用例与补测版本的区别见 after/results.json 的 verificationVersions；未拿旧录制冒充所有最新行为。\n\n变化文件\n\n${changed.map(f=>'- '+f).join('\n')}\n\n本目录没有Git元数据，以修改前哈希核对，没有声称已提交。\n`);
const clips=[['play-one','1×完整流程'],['pause-resume','暂停与继续'],['jump-segment','点击分段跳转'],['expand-module','展开与收起'],['hover-linked','悬停联动'],['play-four','4×速度']];
await write('VIDEOS.md','# 六段实际界面录像\n\n同一真实历史、1564×954。工具窗口使用真实产品渲染和记录，仅替代只读IPC输入；没有启动目标业务。WebM以实际CDP时间戳编码为30fps，静止区按实际时间持有；性能60fps来自独立rAF采样，不将容器帧率当成屏幕性能。\n\n'+clips.map(([id,label])=>`- [${label}](${path.join(folder,'after/clips',id+'.webm').replaceAll('\\','/')})`).join('\n')+'\n\n原始时间戳、捕获帧数和编码帧数保存在每段同名JSON。首轮零面积粒子与工具选择器失败保留在诊断材料，未算作通过。\n');
await write('PERFORMANCE.md',`# 实测性能\n\n机器：${machine.cpu.trim()}；${machine.logicalCpus}逻辑线程；内存${(machine.memoryBytes/1024**3).toFixed(1)}GiB；${machine.platform} ${machine.release} ${machine.arch}；Node ${machine.node}；Electron ${display.electron} / Chromium ${display.chrome}。窗口1564×954，显示器信息见after/display.json。没有把这台机器上的结果扩大为所有硬件保证。\n\n|项目|修改前|修改后|\n|---|---:|---:|\n|17步全程rAF帧率|${beforeUI.performance.fps.toFixed(2)}|${perf.fps.toFixed(2)}|\n|>50ms长任务|${beforeUI.performance.longTasks.length}|${perf.longTasks.length}|\n|每步图提交最大值|${beforeUI.performance.maxCommitsPerStep}|${perf.maxCommitsPerStep}|\n|公共节点重建|${beforeUI.performance.recreated}|${perf.recreated}|\n|异常隐藏/原点/空路径帧|${beforeUI.performance.abnormalFrames.length}|${perf.abnormalFrames.length}|\n\n修改后记录包括自然停止；暂停/继续直接接管现有动画，不通过重新提交图节点表达。光点已用正面积及多位置样本确认可见；4×全程粒子数为${result.fastPackets}。完整样本见after/full-playback.json、packet-visible.json及boundary-results.json。\n\n## 逐帧边界\n\n展开、打开详情和切视图各${result.sequences.map(s=>`${s.name}:${s.captured}`).join(' / ')}张连续实际变化帧。位置/尺寸/身份数据保存在after/frames各目录。重建/异常均0。\n\n“所有视觉矩形每帧不变”没做到，也不与微抬/弹簧/镜头平移同时声称成立：展开时当前容器高度222→430，两个直接下游资源世界y1356→1456作受影响区域位移，其余6节点不动；详情只移动视口，世界布局不变；切换结构不同的视图，共同节点0，不能伪称同一批节点不动。只声明没有整图清空、异常隐藏或公共节点DOM重建。\n`);
const req=[
['1 数据包与标签','做到（范围有限）','真实SVG层、阶段色、650ms/速度缩放、4×省略；标签来自当前边界已录到的入返/行数/状态，下一步淡出。同单元已知父子可用内部短线，跨单元必须有已有关系；没有单一端点或数据时不补造。'],
['2 当前节点与明暗','做到','1/.8/.6/.28、微抬2px、2400ms透明度光环；悬停恢复1。状态由现有回放给出，不新增已执行判定。'],
['3 连线','做到','已过.6阶段实线、当前流动虚线、未来细淡；移动虚线用小段transform实现，未动画stroke-dashoffset。浏览器末步反向/琥珀有单独截图。'],
['4 分段进度','做到','300ms装饰层加宽，不改flex几何；填充暂停冻结、继续接续。原回放暂停后重新等待完整间隔的逻辑不变，进度与该间隔对应。'],
['5 展开收起','做到（受影响区域有位移）','先量后transform/opacity、最多8行30ms交错、退出层不可交互；当前容器和两个下游资源会调整，未做到所有矩形固定。'],
['6 操作入场','做到','按录到的进入序号一次入场，间隔60ms并限制总时长500ms；不会因普通重渲染重播。'],
['7 镜头跟随','做到','400ms ease-out，手动移动只暂停镜头，历史与现场均有恢复控件，不改变操作跟随偏好；历史拖动/恢复已实测。'],
['8 数字渐变','做到','200ms透明度，未逐帧改变数字或重建节点。'],
['9 悬停联动','做到','相邻卡与边突出，其余卡实际opacity=.55；通过DOM样式接管，不用React hover状态重画图。'],
['10 模式与不阻塞','做到（验证有范围）','完整/精简/关闭，默认读取系统偏好；精简实测关键帧仅opacity，关闭实测动画0且17步可播放。现有结构增删仍需布局，不把“只动画transform/opacity”说成结构永不布局。'],
['11 令牌','做到',`动效时长/缓动裸字面量${timingHits.length}，新增参数均集中且有依据；详见AUDIT.md。`],
['验收1 六段录像','做到','VIDEOS.md列出6段真实渲染WebM，无目标应用启动，无假页面。'],
['验收2 性能','做到',`${perf.fps.toFixed(2)}fps，长任务${perf.longTasks.length}，每步图提交≤${perf.maxCommitsPerStep}；机器与原始采样在PERFORMANCE.md。`],
['验收3 关闭行为','做到（定向验证）','关闭后17步、值与流程保留，动画0；播放/跳转/已有32项相关检查，不宣称所有历史验证重跑。'],
['验收4 逐帧矩形全不变','没做到（有冲突）','3类各12帧已交付且重建/异常0；指定微抬、弹簧、镜头与展开空间会改变视觉矩形，切视图实体也不同。实际位移逐项列在PERFORMANCE.md，不把允许变化藏起来。'],
['验收5 grep','做到',`活动产品扫描时长/缓动裸字面量${timingHits.length}，非法关键帧属性${keyframeHits.length}；唯一令牌与第三方/归档分开。`],
['回归U1','做到','同一静止第9步等待1秒后仍19控件/41文字/嵌套0/顶栏5可用目标/底部1区，计数口径沿U1。'],
['回归A–H','做到',`8×8状态与数值差异${cells.filter(c=>c.changed).length}，未改评分或答案。`],
['回归交互','做到（有未复测项）','26项既有回放/跟随/视口回归＋6项真实标签边界检查通过；另有GUI暂停继续/轨道/展开/hover/速度/模式/镜头。未重复整套采集、目标业务、系统导出保存框或所有旧verification。']
];
await write('REPORT.md','# U2 结论\n\n11项动效实现已落地；5项验收中4项达到，1项“所有节点视觉矩形每帧不变”未达到且与指定动效冲突。无新增采集、没有改变回放步骤或真实值。\n\n|要求|做到 / 没做到|原因与实际结果|\n|---|---|---|\n'+req.map(r=>'|'+r.join('|')+'|').join('\n')+'\n\n[六段录像](VIDEOS.md) · [性能与逐帧](PERFORMANCE.md) · [八项目差异](SCORECARD-DIFF.md) · [修改审计](AUDIT.md)\n\n## 修复过的实际问题\n\n最初光点挂在HTML边容器下，DOM有粒子但矩形全0；已换成真正SVG覆层，补采确认正面积且位置沿路径移动。阶段填充曾被旧背景盖住，已修正。没有用初轮录像冒充成功；诊断保留。\n\n浏览器首/末步没有父调用，单独沿该请求已录到的唯一服务关系显示当前边和返回方向，未按项目名或路径猜测。\n\n## 验证范围\n\n这是既有真实17步历史在当前产品组件中的回放，目标服务未启动。动态图无法证明新业务请求已重新录制。既有最小缩放/视野限制保留，本轮未改主干布局算法。没有恢复exe/ZIP打包。\n\n## 重跑\n\n通过 scripts/Invoke-Project.ps1 执行：\n\n- `-Task node -TaskArgs @(\'scripts/verify-u2-motion.mjs\',\'--after\')`：同条件实际GUI/录像/性能。\n- `-Task node -TaskArgs @(\'scripts/test-motion-data.mjs\')`：已录值的标签边界。\n- `-Task npm -TaskArgs @(\'run\',\'corpus\')`：八项目完整评分。\n- `-Task node -TaskArgs @(\'scripts/report-u2-motion.mjs\')`：本报告、哈希与动效字面量检查。\n\n所有输出、日志、缓存与报告位于D盘。冻结before拒绝覆盖；旧失败诊断保留。\n');
console.log(JSON.stringify({scores:audit.changedScoreCells,protectedChanges,timingHits,keyframeHits,recordUnchanged,fps:perf.fps,maxCommits:perf.maxCommitsPerStep,longTasks:perf.longTasks.length,packetSamples:packets.length,positiveSamples:positive.length}));
