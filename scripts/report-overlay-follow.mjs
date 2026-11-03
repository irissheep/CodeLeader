import fs from 'node:fs/promises';
import path from 'node:path';
import {root} from './common.mjs';
const read=async f=>JSON.parse(await fs.readFile(f,'utf8')),config=await read(path.join(root,'tests/fixtures/overlay-review.json')),out=path.join(root,config.output);
const before=await read(path.join(out,'layout/before-overlay/RESULT.json')),after=await read(path.join(out,'layout/after-overlay/RESULT.json')),layout=await read(path.join(out,'layout/after/SUMMARY.json')),playback=await read(path.join(out,'layout/after/PERFORMANCE.json')),comparison=await read(path.join(out,'comparison.json'));
const oldZoom=await read(path.join(root,config.previous,'layout/after-zoom/RESULT.json')),currentZoom=await read(path.join(out,'layout/after-zoom/RESULT.json')),repeat=await read(path.join(out,'layout/after-zoom-runtime-recheck/RESULT.json'));
const zoom=currentZoom.results.map(row=>repeat.results.find(r=>r.name===row.name)||row),currentExtras=await read(path.join(out,'layout/after-zoom/EXTRAS.json')),repeatExtras=await read(path.join(out,'layout/after-zoom-runtime-recheck/EXTRAS.json'));
const extras=currentExtras.extras.map(row=>repeatExtras.extras.find(r=>r.project===row.project)||row),n=(v,d=3)=>Number(v).toFixed(d),maxError=list=>Math.max(...list.map(r=>Math.max(r.startError,r.endError))),headingCount=r=>r.tooltips.filter(t=>t.headingIntersections.length).length;
const termsLog=await fs.readFile(path.join(out,'terms.log'),'utf8'),scanned=termsLog.match(/Scanned (\d+) files/)?.[1]||'（见日志）';
const zoomTable=['|场景/输入|FPS before → after|p95 ms|最大 ms|输入提交/事件|节点重绘|锚点偏差 px|','|---|---|---|---|---|---|---|'];
for(const row of zoom){const old=oldZoom.results.find(r=>r.name===row.name);zoomTable.push(`|${row.name}|${n(old.fps,2)} → ${n(row.fps,2)}|${n(old.p95,2)} → ${n(row.p95,2)}|${n(old.maximum,2)} → ${n(row.maximum,2)}|${row.maxInputCommitsPerWheel}|${row.nodeRenders}|${n(row.anchorDrift,5)}|`);}
const budgets=zoom.every(r=>r.fps>=55&&r.p95<=20&&r.maximum<=50&&!r.longTasks&&r.maxInputCommitsPerWheel<=1&&!r.nodeRenders&&r.anchorDrift<=1);
await fs.writeFile(path.join(out,'ZOOM-COMPARISON.json'),JSON.stringify({beforeSource:config.previous+'/layout/after-zoom/RESULT.json',afterSource:'layout/after-zoom/RESULT.json',recheckSource:'layout/after-zoom-runtime-recheck/RESULT.json',cases:zoom,budgets,extras,rawNumbersAllNondecreasing:false},null,2));
const endpoints=['|倍率|平移|起点误差 before → after px|终点误差 before → after px|','|---|---|---|---|'];
for(let i=0;i<after.cases.length;i++){const a=before.cases[i],b=after.cases[i];endpoints.push(`|${n(b.zoom,1)}|${b.translation.join(',')}|${n(a.startError)} → ${n(b.startError,6)}|${n(a.endError)} → ${n(b.endError,6)}|`);}
const rawIntersections=after.hovers.reduce((n,c)=>n+c.rawTextIntersections.length,0),visibleIntersections=after.hovers.reduce((n,c)=>n+c.visibleTextIntersections.length,0);
const paint=['|场景/输入|Layout 总ms before → after|Paint 总ms|Raster 总ms|','|---|---|---|---|'];
for(const r of zoom){const old=oldZoom.results.find(p=>p.name===r.name),pair=k=>`${n(old.paint[k].totalMs)} → ${n(r.paint[k].totalMs)}`;paint.push(`|${r.name}|${pair('Layout')}|${pair('Paint')}|${pair('RasterTask')}|`);}
const lines=[
'# U8b 悬停叠加层跟随：交付报告','',
`结论：坐标层目标达到。六条实施项做到；六条验收中5项做到，U8项按原预算通过，但严格“每个原始统计数字都不下降”没做到，下面逐值列明。端点十组最大误差 ${n(maxError(after.cases),6)}px，连续十帧 ${n(maxError(after.frames),6)}px；${after.hovers.length}个有调用模块的悬停检查可见穿字${visibleIntersections}，${after.tooltips.length}次提示检查盖标题${headingCount(after)}。`,
'',
'## 按规定顺序实施','',
'|要求|做到 / 没做到|原因及证据|','|---|---|---|',
'|1 先复现量化|做到|先冻结未修改源码，再用真实1564×954窗口、page.mouse.wheel、mouse.down/move/up；未调用视口设置接口。before端点与截图在layout/before-overlay。|',
'|2 全部叠加元素分A/B|做到|AUDIT.md逐项列出坐标层和来源；图内容A，屏幕提示/跨原生页面回声B。|',
'|3 图内容共用流坐标|做到|亮线、终点和运动点放入ReactFlow现有EdgeLabelRenderer，和节点共享同一viewport transform。滚轮不重算端点、不setState；只有悬停、真实内容尺寸变化、模块抬起/落下结束才更新几何。|',
'|3 线与点补偿比例|做到|局部倒数缩放只改变线宽/半径，不向节点传倍数。细线1.5–4px，最大测量4.00001px是小数序列化；点半径约2.60000px。原有暗色关系带保留。|',
'|3 屏幕提示及时重判|做到|移动起点立即隐藏；最后视口变化120ms后elementFromPoint重新选块；不沿用旧坐标。移动中的十帧提示可见次数0，停稳后对象不一致0。地址提示显隐不再引起React提交。|',
'|4 亮线不盖块文字|做到|采用块下层的等效遮挡：遮罩与亮线都用流坐标。可见相交为0；原始路径穿过被遮住区域的几何相交仍报告，未删路径或用隐藏全部亮线过关。|',
'|5 提示不盖标题|做到|容器/分组标题与块都作为避让矩形；上方碰标题时先试下方，放不下就不压内容。35次检查0相交。|',
'|6 同类问题跨视图核查|做到|接口选中描边、依赖32条关系及运行步骤圈/标记在同一viewport内；旧屏幕关系菜单与后端选择框在移动时关闭。运行光点代码本来位于viewport，保留；暂停截图未出现光点，不假称测了它的端点。|','',
'## 端点 before / after','',...endpoints,'',
'每条JSON同时保留屏幕端点、两锚点矩形及实际视口变换；平移由实际拖拽产生。0.3/0.6时既有远景模式把模块收成药丸/圆点，亮线/模块隐藏状态在表中保留；这两档检验的是保留几何，不冒充可见模块截图。1/1.5/2.5的可见亮线与22个模块悬停另行核对。完整表见layout/before-overlay/ENDPOINTS.md、layout/after-overlay/ENDPOINTS.md。','',
'## 验收逐条','',
'|验收|做到 / 没做到|结果|截图/数据|','|---|---|---|---|',
`|① check:overlay-follow，5档×2平移≤2px|做到|10/10，最大${n(maxError(after.cases),6)}px|layout/after-overlay/scale-1-0.png；scale-1-1.png；RESULT.json|`,
`|② 平滑缩放连续10帧≤2px|做到|修复前${n(maxError(before.frames))}px → ${n(maxError(after.frames),6)}px|layout/after-overlay/smooth-wheel.png；RESULT.json的frames|`,
`|③ 亮线与文字、提示与标题相交0|做到|${after.hovers.length}模块可见相交0；${after.tooltips.length}提示检查0。原始被遮挡几何相交${rawIntersections}，两种数不混用|layout/after-overlay/hover-4.png；hover-16.png；tooltip.png|`,
'|④ 控制台无错、提示对应鼠标下的块|做到|控制台错误0；显示对象不一致0；移动中的提示已隐藏|layout/after-overlay/RESULT.json|',
'|⑤ U8手感指标不得变差|没做到（严格逐值）；做到（原预算）|九组有效输入均通过原U8预算；原始FPS/最大帧时长并非逐项不下降。例如小项目触控板最大5.20→10.00ms、FPS200.00→199.48。不把预算通过写成每个数字都更好|下表及ZOOM-COMPARISON.json；layout/after-zoom与runtime-recheck|',
`|⑥ 产品不写项目词/端口/路径|做到|check:no-project-terms扫描${scanned}文件、113专属词、0命中。语料选择只在测试固件；未加项目特判|terms.log；SOURCE-AUDIT.json|`,'',
'## U8原结果并排','',
'机器：AMD Ryzen 5 9600X，12逻辑线程、32GB；原生1564×954窗口，显示器200Hz。before使用上一轮U8最终交付结果，不把其最初跳格版本当本轮基线。下表为实测，计数预算不变。','',...zoomTable,'',
'长任务均0，输入引起的提交≤1/事件，节点重绘/重建均0；原始总提交仍包含旧的500ms时钟，不能当作滚轮刷新。单格约120ms，10次阈值往返每次两次切换，越级最大5.4ms；上下限继续滚比例波动0。CDP文字裁剪200/400ms差0；运行历史原生裁剪8/10071像素差，不能声称逐像素完全一致。','',
'原九组测试收到一次额外输入：运行历史A在1433–1484ms出现脚本未发送的三次−100事件（请求30、实际33），锚点因此不能用作固定鼠标输入验收。这次原始记录保留在layout/after-zoom，不删事件。只重跑该场景A及补充检查，实际30/30、预算通过，单独保存在layout/after-zoom-runtime-recheck，未重跑其余有效组挑数据。','',...paint,'',
'这些绘制累计耗时也有升降，保留追踪文件供核对；不以一次采样推断统计显著变化，也不宣称零额外绘制开销。','',
'## 回归与限制','',
`- check:layout：${layout.cases}场景，${layout.violations}违规，${layout.waivers}豁免；三视图、两窗口、已保存回放及开合状态。`,
`- 17步历史回放：${n(playback.fps,2)}fps，长任务${playback.longTasks.length}，公共节点重建${playback.recreated}，异常帧${playback.abnormalFrames.length}，每步图提交最多${playback.maxCommitsPerStep}。`,
`- corpus前后均实际运行：11项目×8项=${comparison.cells}格，显示与原始评分对象均零差异。SCORECARD.md保留旧G/H口径及其已知限制，不改变expected。`,
'- 类型检查、开发构建、项目词与用词守卫通过。183个受保护分析/采集/数据/回放等文件及1091个已分析源码哈希不变；main/operation-echo仅改旧跨窗口目标轨迹的显隐，例外单列在SOURCE-AUDIT.json。没有改布局、采集协议、原值或播放状态机。',
'- 跨原生页面的回声不能直接放进图视口。本轮镜头开始移动时撤下旧的目标轨迹；不重新显示旧坐标。没有启动目标服务，未做真实页面跨进程延迟逐帧验收，不声称已测。',
'- 初测脚本有两处测量修正（光标重载、SVG mask资源没有绘制矩形），AUDIT.md与INITIAL/MASK-PROBE-INITIAL记录保留；未调整端点、相交和性能验收阈值。',
'- 最新开发版已用当前构建打开主干，latest-window.json记录实际项目、尺寸、运行会话；目标应用未启动，未打包。','',
'## 复跑','',
'按docs/overlay-check.md运行npm run check:overlay-follow；U8检查加--review-config=tests/fixtures/overlay-review.json。默认完整检查含三视图，--layers-only仅作定向排查。所有报告、截图、轨迹和窗口数据均在本目录。',''
];
await fs.writeFile(path.join(out,'REPORT.md'),lines.join('\n'));
console.log(JSON.stringify({overlay:after.violations.length,zoomBudgets:budgets,strictU8RawNonregression:false,layout:layout.violations,scoreChanges:comparison.rawChanges.length}));
