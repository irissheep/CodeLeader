import {validationInput,requireValidationInputs} from './verification-input.mjs';
requireValidationInputs();
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {root,guard} from './common.mjs';
import {managedPath} from './managed-path.mjs';
guard();const out=managedPath(root+'/.tmp/verification-runtime-flow'),read=name=>JSON.parse(fs.readFileSync(out+'/'+name,'utf8'));
const core=read('core-verification.json'),behavior=read('behavior-comparison.json'),build=read('build-provenance.json'),baseline=JSON.parse(fs.readFileSync(root+'/.tmp/verification-readable-interactions/current-index.json','utf8'));
const hashes={...build.hashes,...Object.fromEntries([...baseline.files,...baseline.inputs].map(f=>[f.path,f.hash]))};
const changed=[];for(const [file,hash] of Object.entries(hashes)){const bytes=fs.readFileSync(path.join(build.projectRoot,file));if(crypto.createHash('sha256').update(bytes).digest('hex')!==hash)changed.push(file);}if(changed.length)throw Error('Original target changed: '+changed.join(', '));
const launch=read('acceptance-launch.json'),environment=JSON.parse(fs.readFileSync(root+'/.tools/runtime/environments/'+baseline.id+'/environment.json','utf8'));
const directories=[root+'/.appdata',root+'/.appdata/config',root+'/.appdata/session',root+'/.appdata/temp',root+'/.appdata/executions/'+launch.sessionId,root+'/.tools/runtime/python',environment.copy,environment.copy+'/backend/target',environment.pythonEnv.CHROMA_DIR,path.dirname(environment.copy)+'/mysql',root+'/.cache/maven',root+'/.cache/pip',root+'/.cache/runtime',root+'/.cache/browsers',out];
const audit={at:new Date().toISOString(),originalHashesChecked:Object.keys(hashes).length,originalFilesUnchanged:true,files:hashes,controlledDirectories:directories.map(p=>({requested:p,checked:managedPath(p),exists:fs.existsSync(p)})),scope:'Controlled directories and existing source/build hashes only. No machine-wide C-drive write claim; no process-level C-write trace was performed.'};
fs.writeFileSync(out+'/scope-audit.json',JSON.stringify(audit,null,2));
for(const [source,dest] of [['runtime-setup.log','setup.log'],['runtime-python-install.log','python-install.log'],['runtime-java-build.log','java-build-early.log'],['runtime-check.log','typecheck-early.log'],['runtime-build.log','build-early.log'],['runtime-npm.log','npm-install.log'],['verification-runtime-flow-prepare.log','prepare.log']]){const file=path.join(root,'.tmp',source);if(fs.existsSync(file))fs.renameSync(file,managedPath(out+'/'+dest));}
const deps=JSON.parse(fs.readFileSync(root+'/runtime/dependencies.json','utf8'));
const report=`# 真实页面与执行实录：首版验收

日期：${new Date().toISOString()}${validationInput(import.meta.url,'v0')}${behavior.baseline.medianMs.toFixed(2)} ms，采集中位数 ${behavior.instrumented.medianMs.toFixed(2)} ms，差值 ${behavior.medianDifferenceMs.toFixed(2)}${validationInput(import.meta.url,'v1')}${environment.copy}。Java JAR SHA-256：${environment.jarHash}。已复核 ${Object.keys(hashes).length} 个既有来源哈希未变，覆盖代码、前端、构建清单及已索引配置；不解析或展示真实 .env 值。数据库、向量、编译、下载、缓存、日志、报告均在已核查的 D 盘受控目录。没有使用 Docker，因此未引入容器镜像层写盘问题。

专用本机端口：前端 15174，Java 18084，Python 18004，MySQL 13316；本机 Collector 每会话随机端口。数据库是本轮新初始化的专用目录，未连接原 3306 实例，也未停止未知服务。当前验收 PID / 时间见 acceptance-launch.json。停止录制不停止服务；停止开发环境或退出工具清理本工具拥有的实例。

只核查受控真实路径、参数、数据目录与本次产物；未使用进程级 C 盘成功写操作追踪，不能宣称全机零 C 写入。调用已有 C / E 盘 PowerShell、JDK、Python 或 MySQL 工具不等于向这些盘写入项目文件；未改全局 HOME / USERPROFILE 等环境。

## 锁定依赖

| 组件 | 版本 / 许可 | 下载或依据 |
| --- | --- | --- |
| Java Agent / 扩展 API | 2.27.0 / 2.27.0-alpha，Apache-2.0；OTel API 1.61.0 | ${deps.javaAgent.url} |
| Collector Windows contrib | 0.163.1，Apache-2.0 | ${deps.collector.url}${validationInput(import.meta.url,'v2')}`;
fs.writeFileSync(out+'/REPORT.md',report);
fs.writeFileSync(out+'/comparison.html',`<!doctype html><meta charset="utf-8"><title>运行体验验收</title><style>body{background:#0d1624;color:#dce7f8;font:15px/1.7 system-ui;margin:30px auto;max-width:1500px;padding:0 25px}a{color:#adadff}img,video{width:100%;border:1px solid #35455e;border-radius:12px}section{margin:30px 0}h1{font-size:24px}</style><h1>真实页面与执行实录</h1><p><a href="REPORT.md">报告</a> · <a href="behavior-comparison.json">行为与开销</a> · <a href="scope-audit.json">受控目录</a> · <a href="acceptance-launch.json">当前验收窗口</a></p><section><h2>真实操作录屏（18 秒）</h2><video controls preload="metadata" src="real-operation.webm"></video></section><section><h2>1564×954 · 最新实时记录</h2><img src="1564x954-real-runtime.png"></section><section><h2>1366×768 · 相同真实场景</h2><img src="1366x768-real-runtime.png"></section><section><h2>源码联动</h2><img src="04-runtime-source.png"></section><section><h2>空白名单反例</h2><img src="05-empty-whitelist.png"></section><section><h2>操作前 / 首次实际提问</h2><img src="01-before-operation.png"><img src="02-real-java-python-ask.png"></section>`);
console.log(JSON.stringify({report:out+'/REPORT.md',originalHashesChecked:Object.keys(hashes).length,unchanged:true}));
