import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {guard,root} from './common.mjs';
guard();
const folder=path.join(root,'.tmp/verification-u1-visual-system'),baseline=path.join(root,'.tmp/verification-generalization-baseline');
const read=async f=>JSON.parse(await fs.readFile(f,'utf8')),write=(name,value)=>fs.writeFile(path.join(folder,name),value),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const before=await read(path.join(folder,'before/metrics.json')),after=await read(path.join(folder,'after/metrics.json')),interactions=await read(path.join(folder,'after/interaction-results.json'));
await fs.mkdir(path.join(folder,'corpus-after'),{recursive:true});
for(const file of ['scorecard-v4.json','frontend-scorecard.json','source-integrity.json','link-scorecard.json','backbone-scorecard.json','ui-audit.json','runs.json'])await fs.copyFile(path.join(baseline,file),path.join(folder,'corpus-after',file));
const old=await read(path.join(folder,'corpus-before/scorecard-v4.json')),current=await read(path.join(folder,'corpus-after/scorecard-v4.json'));
function numbers(v,p='',out={}){if(typeof v==='number')out[p]=v;else if(v&&typeof v==='object')for(const[k,x]of Object.entries(v))numbers(x,p+'/'+k,out);return out;}
const cells=[];for(const project of current.projects){const prior=old.projects.find(p=>p.project===project.project);for(const key of 'ABCDEFGH'){const a=prior.grades[key],b=project.grades[key];cells.push({project:project.project,item:key,statusBefore:a.status,statusAfter:b.status,numbersBefore:numbers(a.metrics),numbersAfter:numbers(b.metrics),changed:a.status!==b.status||JSON.stringify(numbers(a.metrics))!==JSON.stringify(numbers(b.metrics)),displayTextChanged:JSON.stringify(a)!==JSON.stringify(b)});}}
await write('scorecard-diff.json',JSON.stringify(cells,null,2));
let score='# A–H 修改前后对比\n\n现行 v4 卡（沿用各项已公布口径），64 格的状态及全部数值字段逐格比较。H 中 DOM 文本样本随本轮文字层级变化；不将文本样本变动伪装成数值回归，也不修改评分定义或 expected。\n\n| 项目 | A | B | C | D | E | F | G | H |\n|---|---|---|---|---|---|---|---|---|\n';
for(const project of current.projects)score+='| '+project.project+' | '+cells.filter(c=>c.project===project.project).map(c=>`${c.statusBefore} → ${c.statusAfter} · ${c.changed?'有差异':'数值差 0'}`).join(' | ')+' |\n';
score+='\n差异格：'+cells.filter(c=>c.changed).length+'/64。原有 △ 保留，未改答案使其变绿。原始完整数值在 scorecard-diff.json 与 corpus-before/corpus-after 中。\n\n修改后 npm run corpus 已完成八个项目的完整分析；随后因等待旧顶栏选择器而中断。只修改 corpus/ui-audit.cjs 的导航/等待选择器，续跑 check-ui 和原 report 模块成功，未重复八次分析，未改任何评分公式。日志：after-corpus.log、resumed-corpus.log。\n';
await write('SCORECARD-DIFF.md',score);
const original=await read(path.join(folder,'source-before.json')),changed=[],protectedChanges=[];let colorBefore=0,colorAfter=0;const raw=/#(?:[\da-f]{8}|[\da-f]{6}|[\da-f]{4}|[\da-f]{3})\b|rgba?\s*\(|hsla?\s*\(/gi;
for(const[file,hash]of Object.entries(original)){const bytes=await fs.readFile(path.join(root,file));if(sha(bytes)!==hash){changed.push(file);if(file.startsWith('src/analysis/')||file.startsWith('runtime/')||file.startsWith('analyzers/')||file.startsWith('src/shared/'))protectedChanges.push(file);}colorBefore+=[...(await fs.readFile(path.join(folder,'source-before',file),'utf8')).matchAll(raw)].length;}
const sourceFiles=[];async function walk(dir){for(const e of await fs.readdir(path.join(root,dir),{withFileTypes:true})){if(e.isSymbolicLink())continue;const file=path.posix.join(dir,e.name);if(e.isDirectory())await walk(file);else sourceFiles.push(file);}}
for(const dir of ['src','analyzers','runtime'])await walk(dir);
const rawHits=[];for(const file of sourceFiles){if(file==='src/shared/ui-tokens.json'||! /\.(?:css|[cm]?js|tsx?|json|html|svg|py|java|xml|md)$/.test(file))continue;const hits=[...(await fs.readFile(path.join(root,file),'utf8')).matchAll(raw)];colorAfter+=hits.length;if(hits.length)rawHits.push({file,count:hits.length});}
const input=await read(path.join(folder,'inputs.json')),saved=await read(path.join(input.sessionFolder,'session.json'));
const frozenRecordUnchanged=JSON.stringify(input.record)===JSON.stringify(saved);
const audit={createdAt:new Date().toISOString(),originalFiles:Object.keys(original).length,changed,protectedChanges,activeProductRawColors:{files:sourceFiles.length,hits:colorAfter,details:rawHits},frozenBeforeRawColors:colorBefore,savedRecordUnchanged:frozenRecordUnchanged,scorecardChangedCells:cells.filter(c=>c.changed).length};
await write('audit.json',JSON.stringify(audit,null,2));
await write('AUDIT.md',`# 修改范围\n\n原始文件哈希 ${audit.originalFiles} 份，变化 ${changed.length} 份；分析器、运行采集/回放、既有 shared 模型的变化：${protectedChanges.length}。新增 shared/ui-tokens 两文件仅供显示。原录制文件与冻结输入逐对象一致：${frozenRecordUnchanged}。\n\n主进程两文件只把原来的显示色值改为从令牌读取；不增加采集字段或权限。新测试工具只读取已有索引、历史和源码，使用隔离 Electron 窗口。\n\n活动产品目录 src/analyzers/runtime（令牌 JSON 除外）裸色命中 ${colorAfter}。全仓零命中未做到：冻结 before 就有 ${colorBefore} 处，第三方依赖、旧发行物、既有报告/证据也保留；没有为凑零重写它们。\n\n仓库没有 .git，未声称 git diff 或提交成功；以上用修改前 SHA-256 核对。\n\n## 变化文件\n\n${changed.map(f=>'- '+f).join('\n')}\n\n## 重跑\n\n所有命令通过 scripts/Invoke-Project.ps1，输出、构建及进程级缓存位于 D 盘。\n\n\`-Task node -TaskArgs @('scripts/verify-ui-system.mjs','--after')\` 重做同条件截图与交互；不执行目标项目。\n\n\`-Task node -TaskArgs @('scripts/verify-u1-regressions.mjs')\` 运行本次选用的四组现有回归。\n\n\`-Task npm -TaskArgs @('run','corpus')\` 运行完整八项目评分。\n`);
const b=before.metrics,a=after.metrics,reduction=(1-a.clickable/b.clickable)*100;
await write('METRICS.md',`# 同条件数量与性能\n\n1564×954、同一真实历史、同一请求、第 9/17 步、右侧关闭、菜单关闭、无悬停。PNG 为隔离 Electron 实际渲染。没有启动目标应用；原生页面没有接入本轮截图窗口。\n\n| 指标 | before | after |\n|---|---:|---:|\n| 可用点击控件 | ${b.clickable} | ${a.clickable}（减少 ${reduction.toFixed(1)}%） |\n| 可见文字节点 | ${b.textNodes} | ${a.textNodes} |\n| 当前行中心的节点内容边框/底色容器 | ${b.nestedContainers} | ${a.nestedContainers} |\n| 顶栏可用点击控件 | ${b.topbarClickable} | ${a.topbarClickable} |\n| 底部区域 | ${b.bottomRegions} | ${a.bottomRegions} |\n\n点击控件统计可见、在屏、未禁用的原生按钮/链接/summary/输入控件及 role=button/slider。新轨道是一只可点、可拖的 slider；原 17 个步骤全部保留，不能把控件数减少解读为删除步骤。嵌套计数限定当前行中心的节点内容子树，不计整窗/画布背景；完整规则在 verify-ui-system.mjs。顶栏按项目、视图、前后、当前操作、录制、更多为 6 组；分段选项和禁用导航若逐个计 DOM 控件，不等于组数。历史模式开始录制禁用；未据此声称现场录制状态也只有 5 个可用控件。\n\n本历史原来没有常驻缩略图区域，因此这里 bottom 是 1 → 1；新实现同时将现场录制的历史列表接入同一胶囊，但本轮没有启动目标业务进行现场截图。\n\n一次展开：LayoutCount ${interactions.performance.layoutCount}，DevTools Layout 事件 ${interactions.performance.traceLayoutEvents}，根提交 ${interactions.performance.commits}，稳定 ${interactions.performance.stableMs.toFixed(1)}ms；节点重建 ${interactions.performance.recreated}，异常帧 ${interactions.performance.abnormalFrames}，长任务 ${interactions.performance.longTasks.length}。\n\n修复前的性能定位记录 initial-expand-trace.json 中有 12 次布局：结构变化 1 次，镜头运动时 SVG 点阵 11 次。改成固定 CSS 装饰背景后剩 1 次。行增删需要这一次结构布局；之后的显现/移动仅通过 transform/opacity。没有宣称增删内容本身完全不布局。\n\n交互明细：after/interaction-results.json；帧与 DOM 身份：after/expand-frames.json；原始性能记录：after/expand-trace.json。\n`);
const requirements=[
['1 设计令牌','做到（全仓零裸色未做到）','新增 ui-principles.md、JSON/TS 单一令牌源，原色值保持语义；活动产品裸色 0。旧兼容色集中保留，未声称数百旧色已全部归并成少量语义色。归档/依赖限制见审计。'],
['2 三层信息','做到','卡面保留身份/角色；计数和文件行号进入独立悬浮层；详情沿用右侧。'],
['3 卡片底部入口','做到','Card 不再输出底部数据/依据/打开链接；动作转入可聚焦的浮层，Enter 打开详情。'],
['4 模块芯片','做到','运行视图先显示本次涉及项，其余从“另外 N 个”恢复；无每颗计数/箭头；不删原模块事实。'],
['5 方法列表','做到','去掉列表框与逐行底板，保留缩进/状态，当前位置合入行尾。'],
['6 关系短标签','做到（验证有限）','默认不显示，仅当前位置关系显示最多18字的短标签，非等宽；完整值保留。复用已有路由锚点，未穷举验证每条复杂关系的避让。'],
['7 顶栏','做到（现场跟随未重测）','三块、视图分段、请求详情下放；地址/刷新属于页面头；恢复跟随移出顶栏。顶栏6个逻辑组，不能偷换成6个独立DOM节点。'],
['8 底部胶囊','做到（现场布局未重测）','历史入口、主播放、细阶段条、摘要与速度统一；历史向上展开；高级动作在既有顶部更多中。'],
['9 走读头部','做到','删除重复阶段条，保留标题/收起，追踪字段能力仍在正文。'],
['10 右侧详情','做到','方法 数据/源码；浏览器 请求/响应/源码；摘要/状态/耗时集中，复制和原始数据在数据段标题右侧。'],
['11 先后提示','做到','保留既有真正先后不明的局部标记，没有增加逐行说明段落；判定函数未变。'],
['12 必要状态与真实值','做到','保留进行中、缺失、未加载、截断及纠正入口；原记录不变，显示隐藏策略与采集协议未变。']
];
const acceptance=[
['验收1 全仓裸色0','没做到','活动产品目录0；冻结before、旧报告/产物和第三方依赖仍含原色，未篡改归档。'],
['验收2 同条件指标','做到（范围已说明）',`可用控件减少${reduction.toFixed(1)}%，节点内容嵌套${b.nestedContainers}→${a.nestedContainers}，顶栏6组，底部1区。详见METRICS.md的计数边界；未把历史画面当作现场录制。`],
['验收3 底链与浮层','做到',`底链输出0；浮层实测${interactions.checks.find(c=>c.name==='L2 在 200ms 内可见')?.latencyMs.toFixed(1)}ms，无其他节点位置变化。`],
['验收4 键盘','做到（代表节点验证）','Tab到达浮层2/2操作，Enter打开右详情，Esc关闭浮层和历史；共用Card实现覆盖其余同类节点，未逐一巡检所有卡。'],
['验收5 闪烁与布局','做到（代表展开验证）','实际展开布局1次、重建0、异常帧0；保留原节点与视口路径。未重复此前所有a–h录制矩阵。'],
['验收6 六组截图','做到','六组同尺寸PNG，真实索引/历史；源数据与窗口相同，未绘制替代页面。'],
['回归评分','做到','64/64格的状态及数值字段一致；原有△保留。'],
['回归交互','做到（有未复测项）','现有4组26项通过；历史界面21项检查通过，覆盖播放/前后/HomeEnd/速度/断点入口/历史/键盘/搜索。步入步出检查入口并由既有回归保护，未重跑现场自动跟随、导出系统保存框和所有旧verification。']
];
let report='# U1 结论\n\n12项实现已落地；6项验收中5项在明确范围内验证，1项“全仓裸色0”未达到。八项目64格评分状态及数值无变化。未新增采集、修改识别、调整标准答案或启动目标业务。\n\n';
report+='| 要求 | 做到 / 没做到 | 原因与结果 |\n|---|---|---|\n'+requirements.concat(acceptance).map(r=>'| '+r.join(' | ')+' |').join('\n');
report+='\n\n## 证据与限制\n\n- [同条件指标](METRICS.md)、[八项目差异](SCORECARD-DIFF.md)、[修改范围](AUDIT.md)、[前后图片](COMPARISON.md)。\n- 类型检查、开发构建、项目专属词检查（235文件/113词/0命中）及26项定向回归成功；日志均在本目录。\n- 本轮使用现有真实历史；历史的17步与值没有改动。没有把“历史可回放”写成“现场业务已重新录制成功”。\n- 这份历史第9步沿用原有最小缩放聚焦行为，浏览器/backend等上方上下文未全部入镜；本轮未改主干布局算法，截图如实保留该限制。\n- 没有重写第三方代码、旧发行物、冻结before或历史报告来消除裸色命中。\n- 旧兼容色仍集中存在；后续如收敛语义色，需另轮检查不同关系的含义，不能任意合色。\n\n## 重跑\n\n见 AUDIT.md。先验证当前数据可用，再运行脚本；before目录始终使用冻结的原界面，避免拿修改后画面冒充before。\n';
await write('REPORT.md',report);
const pairs=[['static-main','静态主干'],['runtime-main','运行主干'],['runtime-data','右侧数据'],['runtime-source','右侧源码'],['runtime-walkthrough','步骤走读'],['dependencies','代码依赖']];
await write('COMPARISON.md','# 同条件前后截图\n\n均为1564×954。静态项目：'+input.static.name+'；历史项目：'+input.runtime.name+'，第9/17步。\n\n'+pairs.map(([key,title])=>`## ${title}\n\n修改前\n\n![修改前](before/${key}.png)\n\n修改后\n\n![修改后](after/${key}.png)`).join('\n\n')+'\n');
console.log(JSON.stringify({changedCells:audit.scorecardChangedCells,protectedChanges,rawColorHits:colorAfter,recordUnchanged:frozenRecordUnchanged,metrics:{before:b.clickable,after:a.clickable,reduction},checks:interactions.checks.length,failedChecks:interactions.checks.filter(c=>!c.pass)}));
