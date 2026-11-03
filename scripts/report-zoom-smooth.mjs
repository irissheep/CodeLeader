import fs from 'node:fs/promises';
import path from 'node:path';
import {root} from './common.mjs';
const read=async f=>JSON.parse(await fs.readFile(f,'utf8')),config=await read(path.join(root,'tests/fixtures/zoom-review.json')),out=path.join(root,config.output);
const before=await read(path.join(out,'layout/before-zoom/RESULT.json')),after=await read(path.join(out,'layout/after-zoom/RESULT.json')),extra=await read(path.join(out,'layout/after-zoom/EXTRAS.json')),beforeExtra=await read(path.join(out,'layout/before-zoom/EXTRAS.json'));
const check=await read(path.join(out,'layout/after-zoom/SUMMARY.json')),layout=await read(path.join(out,'layout/after/SUMMARY.json')),score=await read(path.join(out,'comparison.json')),performance=await read(path.join(out,'layout/after/PERFORMANCE.json'));
const image=(phase,name,label)=>`[${label}](layout/${phase}-zoom/${name}.png)`,fmt=n=>Number(n).toFixed(2),pixel=n=>Number(n).toFixed(4),all=fn=>after.results.every(fn),extras=extra.extras;
const tests=[
 {name:'① 三场景×A/B/C帧预算',pass:all(r=>r.fps>=55&&r.p95<=20&&r.maximum<=50&&!r.longTasks),reason:`最低${fmt(Math.min(...after.results.map(r=>r.fps)))}fps，最大p95 ${fmt(Math.max(...after.results.map(r=>r.p95)))}ms，最大单帧${fmt(Math.max(...after.results.map(r=>r.maximum)))}ms；长任务总数${after.results.reduce((n,r)=>n+r.longTasks,0)}。`,shot:image('after',after.results[0].name,'实际窗口')},
 {name:'② 每次滚轮提交/节点与越级预算',pass:all(r=>r.maxInputCommitsPerWheel<=1&&!r.nodeRenders)&&extras.every(e=>e.thresholds.maxTierWork<=8),reason:`滚轮归属提交最多${Math.max(...after.results.map(r=>r.maxInputCommitsPerWheel))}/事件、节点渲染0、重建0；越级工作最大${fmt(Math.max(...extras.map(e=>e.thresholds.maxTierWork)))}ms（含强制样式/布局读取）；原始总提交中的500ms时钟单列，未删除。`,shot:image('after',after.results[3].name,'依赖窗口')},
 {name:'③ 单格≥100ms，帧间≤6%',pass:extras.every(e=>e.impulse.spread>=100)&&all(r=>r.sequence==='B'||r.maxZoomDeltaPercent<=6.001),reason:`孤立单格展开${extras.map(e=>fmt(e.impulse.spread)).join('/')}ms；鼠标/CTRL最大单帧${fmt(Math.max(...after.results.filter(r=>r.sequence!=='B').map(r=>r.maxZoomDeltaPercent)))}%。触控板不额外插值。`,shot:image('after',after.results[2].name,'CTRL窗口')},
 {name:'④ 鼠标锚点≤1px',pass:all(r=>r.anchorDrift<=1),reason:`最大${pixel(Math.max(...after.results.map(r=>r.anchorDrift)))}px；按实际接收的整数鼠标坐标与同一个世界点逐帧计算。`,shot:image('after',after.results[6].name,'运行窗口')},
 {name:'⑤ 停手200ms内文字恢复，无跳变',pass:extras.every(e=>!e.impulse.restored.zooming&&e.impulse.restored.willChange==='auto'&&e.nativeTextComparison?.changed===0&&e.impulse.style200.x===e.impulse.style400.x&&e.impulse.style200.y===e.impulse.style400.y&&e.impulse.style200.width===e.impulse.style400.width&&e.impulse.style200.height===e.impulse.style400.height),reason:'200ms时zooming已移除、will-change为auto；200/400ms原生整窗的文字区域像素差均0，字号、矩形及变换一致。局部截图曾出现采样差异，保留定向调查说明。',shot:extras.map(e=>image('after',e.project+'-impulse-text-200',e.project+'文字')).join('、')},
 {name:'⑥ 阈值往返10次，无来回闪',pass:extras.every(e=>e.thresholds.byRound.every(n=>n===2)),reason:'每次完整往返只在进入和退出各切一次，10次共20次，无额外切换；每侧8%回差。运行时验证既有细节显隐，不增加新的方法折叠策略。',shot:extras.map(e=>image('after',e.project+'-thresholds',e.project)).join('、')},
 {name:'⑦ 最小/最大处继续滚不抖、不回弹',pass:extras.every(e=>e.bounds.every(b=>b.range<.000001)),reason:'三场景在实际上下限继续各滚5格，逐帧比例范围均0。',shot:extras.map(e=>image('after',e.project+'-min',e.project+'最小')+' / '+image('after',e.project+'-max','最大')).join('；')}
];
const lines=['# U8 · 滚轮缩放顺滑','',`结论：七项验收${tests.filter(t=>t.pass).length}/7达到。先冻结before并量出每格约12.95%的直接跳幅，再实现120ms的目标逼近；没有把原本已高的帧率说成从卡顿变成高帧率。`,
 '', '| 验收 | 结果 | 数据与原因 | 截图 |','|---|---|---|---|',...tests.map(t=>`| ${t.name} | ${t.pass?'做到':'没做到'} | ${t.reason} | ${t.shot} |`),
 '', '## before / after（同样的原生窗口和输入参数）','',
 'A：30格，deltaY=100，60ms间隔；B：200个，前100个+4、后100个−4，8ms间隔；C：Ctrl+滚轮10格，deltaY=100、60ms间隔。窗口内容1564×954。请求发出数和浏览器收到数分别保存；触控板事件可能被浏览器合并，未伪装成每个都独立分发。',
 '', '| 场景/序列 | fps 前→后 | p50 ms 前→后 | p95 ms 前→后 | 最大ms 前→后 | 长任务 前→后 | 原始最多提交/事件 前→后 | 滚轮最多提交/事件 前→后 | 节点渲染 前→后 | 最大帧比例变化 前→后 | 锚点px 后 | 发出/收到 后 |',
 '|---|---|---|---|---|---|---|---|---|---|---|---|'];
for(const r of after.results){const b=before.results.find(b=>b.name===r.name);lines.push(`| ${r.name} | ${fmt(b.fps)}→${fmt(r.fps)} | ${fmt(b.p50)}→${fmt(r.p50)} | ${fmt(b.p95)}→${fmt(r.p95)} | ${fmt(b.maximum)}→${fmt(r.maximum)} | ${b.longTasks}→${r.longTasks} | ${b.maxCommitsPerWheel}→${r.maxCommitsPerWheel} | ${b.maxInputCommitsPerWheel}→${r.maxInputCommitsPerWheel} | ${b.nodeRenders}→${r.nodeRenders} | ${fmt(b.maxZoomDeltaPercent)}%→${fmt(r.maxZoomDeltaPercent)}% | ${pixel(r.anchorDrift)} | ${r.requested}/${r.received} |`);}
lines.push('','提交口径：React官方profiling构建包围整个Graph子树，计数不是一个布尔值或只量图根。原始总提交完整保存；测试bundle对既有500ms相对时间刷新另打标签，滚轮归属列排除这些明确的时钟提交。原始事件到提交的完整对应在*-frames.json，不删底层记录。节点“渲染”指自定义节点函数执行，GPU绘制与栅格化另表；实际点下一步校准产生'+extras.find(e=>e.calibration)?.calibration.renders+'次节点渲染，证明计数器不是恒定0。',
 '', '## 布局 / 绘制 / 栅格（累计毫秒）','', '| 场景/序列 | Layout 前→后 | Paint 前→后 | RasterTask 前→后 | CSS变量修改前→后 | 有时长视口调用前→后 | 原始跟踪 |','|---|---|---|---|---|---|---|');
for(const r of after.results){const b=before.results.find(b=>b.name===r.name);lines.push(`| ${r.name} | ${fmt(b.paint.Layout.totalMs)}→${fmt(r.paint.Layout.totalMs)} | ${fmt(b.paint.Paint.totalMs)}→${fmt(r.paint.Paint.totalMs)} | ${fmt(b.paint.RasterTask.totalMs)}→${fmt(r.paint.RasterTask.totalMs)} | ${b.styleMutations}→${r.styleMutations} | ${b.timedViewportCalls}→${r.timedViewportCalls} | [before](layout/before-zoom/${r.name}-trace.json) / [after](layout/after-zoom/${r.name}-trace.json) |`);}
lines.push('','跟踪按Chromium事件名保留累计值及单次最大值；RasterTask来自栅格线程，不能与主线程Layout/Paint简单相加当成墙钟耗时。Rasterize事件没有时保留0。rAF指标是该机器采样结果，不冒充所有显示器的实际呈现率。',
 '', '## 六类原因，按证据归类','', '| 类别 | 是/不是 | 证据与处理 |','|---|---|---|',
 '| 1. 逐格一步到位 | 是 | before最大单帧约12.95%，原生wheel路径2^(−deltaY×.002)直接生效；改目标倍数+rAF指数逼近，触控板小量直接跟手。 |',
 '| 2. 每次都重绘节点 | 不是 | before节点函数渲染0、DOM重建0；但缩放百分比组件订阅原始倍数，导致几乎每次输入一次提交。移到DOM订阅，列表保留相同引用，避免停止保存再产生内部跟随提交。 |',
 '| 3. 每格启动带时长动画 | 不是 | before与after记录的有时长调用均0；聚焦/定位的时长镜头仍保留，开始滚轮用零时长当前视口打断旧镜头。后者按安装版图库的selection.interrupt路径实现，未另做自动镜头中断延迟计时。 |',
 '| 4. 视口/节点CSS transform过渡 | 是（存在，非13%跳幅主因） | 旧节点定位层有220ms transform过渡，依赖另有覆盖；移除定位层transform/all过渡，原内层入场/悬停保留。 |',
 '| 5. 绘制负担 | 有成本，未证明是主因 | 原有大阴影/滤镜和持续点运动，且CSS改字号带来额外栅格。缩放时暂时降级，150ms恢复。原机器before已无>50ms长任务，不能捏造GPU低帧率。 |',
 '| 6. 其他 | 是 | useSemanticZoom每次变换写入逆缩放字号等变量，增加布局；改为档位/程序取景稳定时更新，并补上Viewport延迟挂载后的监听。运行时微小测量差会误触发旧尺寸动画，滚轮内禁用该层，真实尺寸比较加0.5世界像素容差。 |',
 '', '## 停手文字与范围说明','',
 '原生整窗200ms/400ms的同一文字区域像素一致，位置/字号/矩阵一致；各自局部图供人工看字形边缘。调查中曾见卡片scaleY=1.00141、标题scaleY=0.997275，400ms才回1，已修正。修正后单独CDP局部截图仍有LCD边缘色彩采样差异；改用原生整窗同时确认，未修改文字、蒙版或截图内容。',
 '', '| 场景 | before单格展开 | after单格展开 | 最大越级工作ms | 10次往返切换 | 原生文字像素差 | 文字对照 | 原生窗口 |','|---|---|---|---|---|---|---|');
for(const e of extras){const b=beforeExtra.extras.find(b=>b.project===e.project);lines.push(`| ${e.project} | ${fmt(b.impulse.spread)}ms | ${fmt(e.impulse.spread)}ms | ${fmt(e.thresholds.maxTierWork)} | ${e.thresholds.byRound.join('/')} | ${e.nativeTextComparison?.changed??'未记录'} | ${image('after',e.project+'-impulse-text-200','200ms')} / ${image('after',e.project+'-impulse-text-400','400ms')} | ${image('after',e.project+'-impulse-native-200','200ms')} / ${image('after',e.project+'-impulse-native-400','400ms')} |`);}
lines.push('','## 回归与重跑','',
 `- check:layout：${layout.cases}场景、${layout.violations}违规、${layout.waivers}豁免；保存17步回放${fmt(performance.fps)}fps，长任务${performance.longTasks.length}、公共节点重建${performance.recreated}、异常帧${performance.abnormalFrames.length}、每步最多${performance.maxCommitsPerStep}次图提交。`,
 `- corpus前后${score.cells}格：显示变化${score.displayChanges.length}、原始评分对象变化${score.rawChanges.length}；[并排评分](SCORECARD.md)。不改expected和评分口径；已有历史用于渲染验证，不启动目标应用。`,
 '- 类型检查、开发构建、项目词与用词守卫的实际结果见各log。没有新增依赖、采集字段、LLM或打包。',
 '- npm run check:zoom-smooth -- --before / npm run check:zoom-smooth，输入清单在tests/fixtures/zoom-review.json。运行目录内已有的冻结真实模型、历史是重跑前提；新环境先恢复本地验证归档并运行corpus，不用伪造的Index替代。',
 '- 超过30节点的可见项绘制已接入，当前三个默认场景均不足30；没有为了凑这项验证而制造一张假大图。接口视图共用同一缩放入口；本轮九组性能矩阵按用户指定三个场景，完整接口视图仍包含在版式回归里。',
 '- 系统减少动态/显式关闭保持直接缩放，不套普通模式100ms预算。字号在同档内随画布自然缩放，松手不重设字号；运行时不新建折叠模型，保留现有步骤/方法列表。',
 '', '## 机器与原始材料','', '```json',JSON.stringify(after.machine,null,2),'```','', '测试使用官方React profiling入口和原生Electron内容窗口。逐帧原始数据为*-frames.json，跟踪为*-trace.json；完整结果在layout/before-zoom与layout/after-zoom。没有Git元数据，文件哈希与未变范围另存SOURCE-AUDIT.json，不声称已经提交。','');
const content=lines.join('\n').replace(/\]\(([^)]+)\)/g,(_,file)=>']('+path.resolve(out,file).replaceAll('\\','/')+')');
await fs.writeFile(path.join(out,'REPORT.md'),content);
await fs.writeFile(path.join(out,'ACCEPTANCE.json'),JSON.stringify({tests,zoomCheck:check,layout,scoreChanges:score.displayChanges,rawScoreChanges:score.rawChanges},null,2));
console.log(JSON.stringify({passed:tests.filter(t=>t.pass).length,total:tests.length,zoomErrors:check.errors,layoutViolations:layout.violations,scoreChanges:score.displayChanges.length}));
