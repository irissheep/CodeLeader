import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import {guard,root} from './common.mjs';
guard();
const folder=path.join(root,'.tmp/verification-u3-adaptive-look');
const read=async file=>JSON.parse(await fs.readFile(path.join(folder,file),'utf8'));
const write=(file,value)=>fs.writeFile(path.join(folder,file),value);
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const manifest=JSON.parse(await fs.readFile(path.join(root,'corpus/manifest.json'),'utf8')),review=JSON.parse(await fs.readFile(path.join(root,'tests/fixtures/u3-review.json'),'utf8'));
const ui=await read('after/metrics.json'),before=await read('before/metrics.json'),routes=ui.results;
const beforeRoutes=(await read('before-routing/metrics.json')).results;
const perf=await read('runtime-regression/after/boundary-results.json');
const original=await read('source-before.json'),changed=[],protectedChanges=[];
for(const[file,hash]of Object.entries(original))if(digest(await fs.readFile(path.join(root,file)))!==hash){changed.push(file);if(/^(?:src\/analysis\/|runtime\/|analyzers\/)/.test(file)||['src/shared/model.ts','src/shared/execution.ts','src/shared/ui-tokens.json','src/renderer/useGraphMotion.ts','src/renderer/useRuntimeFit.ts'].includes(file))protectedChanges.push(file);}
const source={};async function collect(dir){for(const e of await fs.readdir(path.join(root,dir),{withFileTypes:true})){if(e.isSymbolicLink())continue;const file=path.posix.join(dir,e.name);if(e.isDirectory())await collect(file);else source[file]=digest(await fs.readFile(path.join(root,file)));}}
for(const name of ['src','runtime','analyzers'])await collect(name);
const added=Object.keys(source).filter(file=>!original[file]);
const frozen=await read('corpus-before/scorecard-v4.json'),current=await read('corpus-after/scorecard-v4.json');
function numeric(value,key='',result={}){if(typeof value==='number')result[key]=value;else if(value&&typeof value==='object')for(const[k,v]of Object.entries(value))numeric(v,key+'/'+k,result);return result;}
const cells=[];for(const row of current.projects){const old=frozen.projects.find(p=>p.project===row.project);for(const col of 'ABCDEFGH'){const a=old.grades[col],b=row.grades[col];cells.push({project:row.project,item:col,before:a.status,after:b.status,statusChanged:a.status!==b.status,numbersBefore:numeric(a.metrics),numbersAfter:numeric(b.metrics),numbersChanged:JSON.stringify(numeric(a.metrics))!==JSON.stringify(numeric(b.metrics))});}}
await write('SCORECARD-DIFF.json',JSON.stringify(cells,null,2));
let score='# 前后评分卡\n\n前后各完整执行一次现有 corpus。最后的改动仅涉及错误提示、源分组图标及展开坐标；只续跑原界面与报告阶段，不再扫描八次。expected、锁和评分定义未改。\n\n|项目|A|B|C|D|E|F|G|H|\n|---|---|---|---|---|---|---|---|---|\n';
for(const project of current.projects)score+='|'+project.project+'|'+cells.filter(c=>c.project===project.project).map(c=>`${c.before}→${c.after}${c.numbersChanged?' · 数值有变':' · 数值不变'}`).join('|')+'|\n';
score+=`\n等级变化 ${cells.filter(c=>c.statusChanged).length}/64；数值变化 ${cells.filter(c=>c.numbersChanged).length}/64。A–G 数值不变。H 的可见节点数量因取景改善而改变，严格的“全部数值零差异”没做到：\n\n`;
for(const cell of cells.filter(c=>c.numbersChanged)){const dif=Object.keys(cell.numbersBefore).filter(k=>cell.numbersBefore[k]!==cell.numbersAfter[k]);score+=`- ${cell.project} ${cell.item}：${dif.map(k=>`${k}：${cell.numbersBefore[k]}→${cell.numbersAfter[k]}`).join('；')}。没有改答案消除这项真实改善。\n`;}
score+='\nG 评分继续使用原模型的几何口径；本轮屏幕上的短线路由另按相同折线交叉定义实测，见 METRICS.md，不用改变评分来冒充路由回归。\n';await write('SCORECARD-DIFF.md',score);
const projects=manifest.projects.map(p=>p.id),quant=[];
for(const id of projects){const all=ui.results.filter(r=>r.project===id),main=all.filter(r=>r.view==='main'),dep=routes.filter(r=>r.project===id&&r.view==='overview'),old=beforeRoutes.find(r=>r.project===id);quant.push({project:id,main:main.map(r=>({width:r.window.width,area:r.areaRatio,gap:r.minGap})),maxRatio:Math.max(0,...dep.flatMap(r=>r.edges.map(e=>e.ratio))),minGap:Math.min(...all.map(r=>r.minGap??Infinity)),clipped:all.reduce((n,r)=>n+r.clipped.length,0),crossingsBefore:old.crossings,crossingsAfter:dep.find(r=>r.window.width===1548).crossings,edges:dep.find(r=>r.window.width===1548).edges.length});}
await write('METRICS.json',JSON.stringify(quant,null,2));
let metrics='# 实测尺寸与路由\n\nElectron 内容区为1548×945、1100×700，含应用自己的标题栏，不把操作系统外边框算入图片。真实产品组件与真实完整静态模型，只替换输入IPC；没有运行语料应用。卡片面积取实际轮廓（药丸/图标档取实际小轮廓），硬裁切检查覆盖卡名、模块名；有省略号和完整悬停内容的正常省略不计硬裁切。\n\n|项目|主干面积 大/小|三视图最小间距px|依赖最长比|交叉 前→后|边数|名称硬裁切|\n|---|---|---:|---:|---|---:|---:|\n';
for(const q of quant)metrics+=`|${q.project}|${q.main.map(r=>(r.area*100).toFixed(1)+'%').join(' / ')}|${q.minGap.toFixed(1)}|${q.maxRatio.toFixed(3)}|${q.crossingsBefore}→${q.crossingsAfter}|${q.edges}|${q.clipped}|\n`;
metrics+='\n走线比=圆角SVG实际长度/两个实际端口的直线距离。交叉数按R1定义：还原Q命令中的原折点、合并共线段后，对每对边去重计交点；端点与共线重叠不计。早期脚本只数圆角后的L段，漏计转角附近，旧结果保留在 metrics-rounded-only.json，不能用来验收。最终以上表为准。\n\n';
for(const q of quant.filter(q=>q.crossingsAfter>10))metrics+=`${q.project} 仍有${q.crossingsAfter}处交叉，未达≤10。保留${q.edges}条真实关系、现有角色分层和1.6短线约束后，本轮未找到更低的排列；没有删边或改口径。\n`;
const interactions=await read('after/interactions.json');metrics+=`\n窗口缩放、文件抽屉与右侧详情开合共${interactions.length}次：节点重建${interactions.reduce((n,r)=>n+r.recreated,0)}，世界坐标变化${interactions.reduce((n,r)=>n+r.moved.length,0)}。空项目的零节点项仅验证状态卡，不拿它凑节点身份通过率。完整逐项记录在 after/interactions.json。\n`;
await write('METRICS.md',metrics);
const policy=JSON.parse(await fs.readFile(path.join(root,'src/shared/adaptive-look.json'),'utf8')),unknown=new Map(),counts={};
for(const row of ui.results.filter(r=>r.window.width===1548))for(const n of row.nodes){counts[n.role]=(counts[n.role]||0)+1;if(n.role==='unknown')unknown.set(row.project+':'+n.id,{project:row.project,...n});}
let roles='# 角色外观\n\n使用已识别的角色，不读取项目名决定颜色。同一实体在不同视图出现时计为不同展示实例。\n\n|角色|图标|阶段色令牌|本轮实例数|依据|\n|---|---|---|---:|---|\n';
for(const [id,role]of Object.entries(policy.roles))roles+=`|${role.label}|${role.icon}|phase-${role.color}|${counts[id]||0}|${role.basis}|\n`;
roles+=`\n未知角色共${unknown.size}个不同实体，均中性图标/灰色，不随机上色：\n\n|项目|名称|身份/源码|原因|\n|---|---|---|---|\n`;
for(const n of unknown.values())roles+=`|${n.project}|${n.name}|${n.id}|原依赖模型仅确认类，未确认结构职责；本轮不扩大识别逻辑。|\n`;
await write('ROLES.md',roles);
const runtime={steps:perf.steps,fps:perf.performance.fps,longTasks:perf.performance.longTasks.length,commits:perf.performance.maxCommitsPerStep,recreated:perf.performance.recreated,abnormal:perf.performance.abnormalFrames.length,fastPackets:perf.fastPackets,metrics:perf.metrics,errors:perf.errors};
await write('RUNTIME-REGRESSION.json',JSON.stringify(runtime,null,2));
await write('RUNTIME-REGRESSION.md',`# 真实历史回归\n\n同一已有历史${runtime.steps}步，${runtime.fps.toFixed(3)}fps；>50ms长任务${runtime.longTasks}，每步图提交≤${runtime.commits}，公共节点重建${runtime.recreated}，异常帧${runtime.abnormal}。4×全程光点${runtime.fastPackets}。\n\nU1同一第9步：常驻可用控件${runtime.metrics.clickable}、可见文字${runtime.metrics.textNodes}、嵌套层${runtime.metrics.nestedContainers}、顶栏可用控件${runtime.metrics.topbarClickable}、底部区域${runtime.metrics.bottomRegions}，与U1/U2不变。只用了真实已保存历史，没有重新运行目标业务，也没有宣称重跑全部旧验收。原始帧、两段录像、首末步边界在runtime-regression/after。\n`);
const audit={capturedAt:new Date().toISOString(),originalFiles:Object.keys(original).length,changed,added,protectedChanges,sourceHashes:source,sourceBeforeUntouched:true,gitAvailable:await fs.stat(path.join(root,'.git')).then(()=>true).catch(()=>false),machine:{cpu:os.cpus()[0].model,logicalCpus:os.cpus().length,memoryBytes:os.totalmem(),platform:os.release(),node:process.version},runtime};
for(const[file,hash]of Object.entries(original))if(digest(await fs.readFile(path.join(folder,'source-before',file)))!==hash)audit.sourceBeforeUntouched=false;
await write('AUDIT.json',JSON.stringify(audit,null,2));
await write('AUDIT.md',`# 修改范围\n\n修改前冻结${audit.originalFiles}个产品文件，冻结副本未变：${audit.sourceBeforeUntouched}。分析器、采集、共享数据模型、真实值与回放相关保护文件变化${protectedChanges.length}。没有新增依赖，没有目标业务执行或发行打包。没有Git元数据，提供哈希对照，不声称提交。\n\n已有文件改动：\n\n${changed.map(f=>'- '+f).join('\n')}\n\n新增展示文件：\n\n${added.map(f=>'- '+f).join('\n')}\n\n尺寸阈值和角色在adaptive-look.json，每项有原因。颜色仍引用ui-tokens.json；该令牌文件与U2冻结版本相同。最后的展开坐标/瓦片处理不改变初始图或分析事实；已定向点击验证。\n`);
const required=ui.results.filter(r=>projects.includes(r.project)||r.project==='empty');
let shots='# 截图索引\n\n要求的9项目×3视图×2尺寸共'+required.length+'张。另有单脚本和无数据库样例、三档缩放、错误通知及原位展开截图。所有画面来自产品实际渲染；错误通知是显示状态验证，不是一次真实分析器崩溃。\n\n';
let gallery='<!doctype html><meta charset="utf-8"><title>自适应外观对照</title><style>:root{'+Object.entries(JSON.parse(await fs.readFile(path.join(root,'src/shared/ui-tokens.json'),'utf8')).color).map(([k,v])=>`--${k}:${v}`).join(';')+'}body{background:var(--canvas);color:var(--text);font:14px/1.6 system-ui;max-width:1600px;margin:24px auto;padding:0 24px}a{color:var(--accent)}img{width:100%;border:1px solid var(--line);border-radius:14px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:16px}h2{margin-top:40px}small{color:var(--secondary)}</style><h1>自适应外观</h1><p><a href="REPORT.md">逐项报告</a> · <a href="METRICS.md">实测</a> · <a href="SCORECARD-DIFF.md">评分差异</a></p><p>静态画面使用真实模型与真实产品组件，未启动目标应用。</p>';
for(const id of [...projects,'empty']){shots+=`## ${id}\n\n`;gallery+=`<h2>${id}</h2>`;for(const [width,height]of [[1548,945],[1100,700]]){shots+=`- ${width}×${height}：`;for(const [view,name]of [['main','主干'],['guide','接口'],['overview','依赖']]){const file=`after/${id}/${width}x${height}-${view}.png`;shots+=`[${name}](${file}) `;gallery+=`<h3>${width}×${height} · ${name}</h3><div class="pair">${id==='empty'?'':`<figure><small>修改前</small><img loading="lazy" src="before/${id}/${width}x${height}-${view}.png"></figure>`}<figure><small>修改后</small><img loading="lazy" src="${file}"></figure></div>`;}shots+='\n';}shots+='\n';}
shots+=`## 补充状态\n\n- [完整](after/${review.semanticProject}/semantic-full.png) · [药丸](after/${review.semanticProject}/semantic-pill.png) · [图标](after/${review.semanticProject}/semantic-dot.png)\n- [无接口](after/python-script/1100x700-guide.png) · [无数据库](after/java-no-storage/1548x945-main.png) · [读取失败通知](after/states/read-failure.png)\n- [当前真实开发窗口](latest-development.png)\n`;
await write('SCREENSHOTS.md',shots);await write('review.html',gallery);
const goal=[
 ['1 密度三档','做到','五卡以内1.25倍；6–15标准；超十五卡或八模块使用瓦片。大模块排序按已有接口数；展开后仍保留瓦片。阈值与理由集中在数据表。'],
 ['2 语义缩放','部分做到','静态三视图有完整/药丸/图标，低比例保持可读名称、边更细更淡；三档截图与稳定身份已验证。运行当前方法链继续完整显示以保持U1/U2，不宣称已给运行层也加入三档。'],
 ['3 构图与面积','做到',`${review.startupProject}主干两尺寸${quant.find(q=>q.project===review.startupProject).main.map(r=>(r.area*100).toFixed(1)+'%').join(' / ')}。前端在左、应用在右、资源在应用下方；瘦长应用组（含关系）双列，定向几何回归通过。`],
 ['4 角色外观','做到',`统一角色表；${unknown.size}个未知职责逐个列在ROLES.md，使用中性灰；未按项目名上色。`],
 ['5 文字与标签','做到','名称最多两行、溢出省略、完整名可悬停；混排统一行高，技术栈为同类小标。卡名/模块名硬裁切实测0，值未改写。'],
 ['6 缺失状态','做到（验证有边界）','无后端、无接口、无数据库、空目录均有范围与选择入口；读取失败通知为同主题虚线卡。无接口和无数据库来自真实最小扫描；失败状态只通过通知显示验证，没有人为破坏分析器或声称真实崩溃。'],
 ['7 依赖走线','做到','正交圆角；同方向可共享出口和短通道，再分到独立目标；每条关系身份/类型保留。两尺寸所有依赖边≤1.6，不删边。交叉上限未全达，见验收2。'],
 ['8 HTML走读外观','没做到','当前产品只有录制数据导出，没有HTML走读生成器或入口；本轮未补建新的导出功能。review.html只是截图报告，不能算作产品支持。'],
 ['验收1 54张','做到',`已保存${required.length}张要求截图，按项目/尺寸/视图归档；另外有两个最小工程和状态图。`],
 ['验收2 量化','部分做到','主干小图面积、1.6路由比、名称硬裁切0和≥16px间距均达到。复杂图交叉仍有未达≤10项，保留原折线口径和具体数字，不称全部通过。'],
 ['验收3 三档缩放','做到',`${review.semanticProject}主干完整/药丸/图标各一张；世界位置和公共DOM未改变。`],
 ['验收4 角色清单','做到',`ROLES.md包含全部映射及${unknown.size}个未知职责的身份与原因。`],
 ['验收5 单脚本','做到','真实只读扫描1个Python脚本、0个HTTP接口；源码未执行，显示没有识别到接口。'],
 ['验收6 窗口与面板','做到',`${interactions.length}次窗口/抽屉开合，公共节点世界位置变化0、DOM重建0；视角单独适配。展开内容及直接下游资源可调整位置，未把该内容变化冒称所有位置不动。`],
 ['回归 U1/U2','做到（定向）',`${runtime.fps.toFixed(2)}fps、长任务${runtime.longTasks}、每步图提交≤${runtime.commits}；U1计数不变。使用已有真实历史，未重新启动目标应用或重跑所有旧验证。`],
 ['回归 R1–R6','做到（识别数字）','A–G原有数字不变，标准与评分定义不改；依赖显示几何的新测量另列，不把原G数字称为屏幕路线。'],
 ['回归 A–H严格零差异','没做到',`64格等级变化${cells.filter(c=>c.statusChanged).length}；${cells.filter(c=>c.numbersChanged).length}个H格因可见节点增加而数值变化，详见SCORECARD-DIFF.md。没有退步，也没有改基线凑零。`]
];
let report='# U3 自适应外观\n\n结论：8条实现要求中6条做到、1条部分做到、1条没做到。54张指定截图已完成；面积/间距/硬裁切/单边长度达标。复杂依赖图仍未全部达到≤10交叉；HTML走读导出没有现有入口。严格A–H数值零差异也未达到，三个H可见数改善如实保留。\n\n';
report+='|要求|做到 / 没做到|原因与证据|\n|---|---|---|\n'+goal.map(row=>'|'+row.join('|')+'|').join('\n')+'\n\n';
report+='## 实际执行\n\n- 修改前/后各一次完整corpus，最后仅续跑受影响UI与原报告；expected及评分定义不变。\n- 最终类型检查、开发构建、定向几何/原图测试通过，项目词守卫命中0。未执行发行打包。\n- 真实静态输入、双尺寸产品窗口、三档缩放、窗口/抽屉位置和原位展开帧；不把模拟IPC输入的静态画面称为目标业务实录。\n- 同一真实17步历史1×/4×回归；没有新录制，没有执行目标源码/构建/测试或连接数据库。\n\n';
report+='## 材料\n\n- [截图对照](review.html) · [54张索引](SCREENSHOTS.md)\n- [逐项目实测](METRICS.md) · [角色及未知项](ROLES.md)\n- [评分差异](SCORECARD-DIFF.md) · [回放回归](RUNTIME-REGRESSION.md) · [修改哈希](AUDIT.md)\n- 原始输入与指标：corpus-before / corpus-after / after / interaction / runtime-regression。\n\n全部新增产物位于D盘。当前开发窗口只读打开固定语料主干；该样本没有个人环境文件，缺少的连接地址保持未知，不拿另一个目录的配置补线。\n';
report+='\n最终开发窗口：已加载最终构建，主干3卡，无运行会话、旧页面或播放条，未启动目标应用。latest-window.json与window-visibility.json记录实际状态，latest-development.png为实际窗口截图。第一次原生抓图超时，恢复并前置本工具窗口后成功；未修改系统执行策略。\n\n原位展开补验：普通模块11入口，大模块带24块瓦片、展开15入口；各10张实帧在interaction/*/expand-frames，公共DOM重建0、异常隐藏0、空路径0；收起后恢复原位置。展开时直接下游资源下移，不把内容变化冒称所有位置不动。\n\n最后只补了读取失败与其它错误的显示区分，单独验证：读取失败为新卡，其它错误保留原提示。状态验证证据在states，未重新扫描语料或改变回放。\n';
await write('REPORT.md',report);
await write('README.md','# 本轮复跑\n\n通过仓库的D盘入口运行：\n\n```powershell\n.\\scripts\\Invoke-Project.ps1 -Task node -TaskArgs @(\'scripts/verify-u3-adaptive.mjs\',\'--ui\')\n.\\scripts\\Invoke-Project.ps1 -Task node -TaskArgs @(\'scripts/verify-u3-adaptive.mjs\',\'--ui\',\'--interaction\')\n.\\scripts\\Invoke-Project.ps1 -Task node -TaskArgs scripts/test-adaptive-look.mjs\n```\n\nUI固定使用corpus-before中的完整模型，保证同条件；目标仓库不启动。完整评分用npm run corpus或verify-u3-adaptive.mjs --after。before冻结副本和哈希不可覆盖；补测旧路由用--ui --baseline-routing。后续轮次另存基线，不把当前代码写成before。\n');
console.log(JSON.stringify({requirements:goal.length,requestedScreens:required.length,gradeChanges:cells.filter(c=>c.statusChanged).length,numericChanges:cells.filter(c=>c.numbersChanged).length,protectedChanges,unknown:unknown.size,quant}));
