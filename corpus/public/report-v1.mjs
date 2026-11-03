// Adapted public-only v1 scorer; source SHA-256: 199382ef5237b5742f2149dacb162804bf2de464afc962e5e9542c02ac309fcf
import fs from 'node:fs/promises';
import path from 'node:path';
import {repository,records,corpusRoot} from '../acquire.mjs';
import {inventory,sha} from '../reference.mjs';
const output=path.join(repository,'.tmp/verification-generalization-baseline'),read=async file=>JSON.parse(await fs.readFile(file,'utf8'));
const manifest=await read(path.join(output,'active-manifest.json')),runs=await read(path.join(output,'runs.json'));
const ui=await read(path.join(output,'ui-audit.json')).catch(()=>null);
const cell=value=>String(value).replaceAll('|',' / ').replaceAll('\n',' ');
const canonical=value=>String(value).toLowerCase().replace(/[^a-z0-9]/g,'');
const engine=name=>{const value=canonical(name);return value.startsWith('sqlite')?'SQLite':value==='mysql'?'MySQL':['postgres','postgresql'].includes(value)?'PostgreSQL':value==='redis'?'Redis':value==='chroma'?'Chroma':value==='h2'?'H2':value==='rq'?'RQ':value.includes('elasticsearch')?'Elasticsearch':undefined;};
const normRoot=value=>value.replaceAll('\\','/').replace(/\/$/,'')||'.';
const normPath=value=>value.replace(/\{value\}/g,'{}').replace(/\{[^}]+\}|:[\w]+|<[^>]+>/g,'{}').replace(/\/$/,'')||'/';
const entryPath=entry=>{const match=entry.name.match(/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|ANY)\s+(\S+)/);return match&&{method:match[1],path:match[2]};};
const table=[],details=[];
for(const p of manifest.projects){
 const expected=await read(path.join(records,'expected',p.id,'expected.json')),run=runs.find(r=>r.id===p.id),model=await read(path.join(output,p.id,'model.json')).catch(()=>null),graphs=await read(path.join(output,p.id,'graphs.json')).catch(()=>null);
 const grades={};const grade=(key,status,text,metrics,reason)=>grades[key]={status,text,metrics,reason};
 if(!model||!graphs){for(const key of 'ABCDEFGH')grade(key,'✗',`无法评估：${run?.error||'没有最终模型'}`,{},'没有完整评估结果');}
 else{
  const actual={backend:[...new Set((model.components||[]).filter(c=>c.kind==='java').map(c=>normRoot(c.root)))],frontend:[...new Set((model.components||[]).filter(c=>c.kind==='frontend').map(c=>normRoot(c.root)))],python:[...new Set((model.entities||[]).filter(e=>e.kind==='service'&&e.sourceRoots?.some(root=>model.files.some(f=>f.language==='python'&&f.path.startsWith(root+'/')))).flatMap(e=>e.sourceRoots).map(normRoot))]};
  const locations={};let allUnits=true;
  for(const kind of ['backend','frontend','python']){const targets=expected.units[kind].items.map(i=>normRoot(i.root));const hits=targets.filter(root=>actual[kind].some(found=>found===root||kind==='python'&&found.startsWith(root+'/')));locations[kind]={actual:actual[kind],expected:targets,matched:hits.length};if(actual[kind].length!==targets.length||hits.length!==targets.length)allUnits=false;}
  grade('A',allUnits?'✓':'✗',`后 ${actual.backend.length}/${expected.units.backend.count} · 前 ${actual.frontend.length}/${expected.units.frontend.count} · Py ${actual.python.length}/${expected.units.python.count}`,locations,'Java 项目声明按根去重，但模型未区分库与应用；Python 只承认实际带 Python 源码根的服务实体，不凭存在 .py 自行补服务。');
  const resources=model.entities.filter(e=>e.kind==='resource'&&e.resourceKind!=='table'),engines=[...new Set(resources.map(e=>engine(e.name)).filter(Boolean))],targets=expected.infrastructure.items.map(i=>i.name),matched=targets.filter(e=>engines.includes(e)),missing=targets.filter(e=>!engines.includes(e)),extra=engines.filter(e=>!targets.includes(e));
  const kindMatches=expected.infrastructure.items.filter(target=>resources.some(r=>engine(r.name)===target.name&&r.resourceKind===target.kind)).length;
  grade('B',!missing.length&&!extra.length&&kindMatches===targets.length?'✓':matched.length?'△':'✗',`匹配 ${matched.length}/${targets.length} · 分类 ${kindMatches}/${targets.length} · 漏 ${missing.length} · 多 ${extra.length}`,{actual:engines,expected:targets,matched,missing,extra,kindMatches,unknown:resources.filter(r=>!engine(r.name)).map(r=>r.name)},'比较配置/源码中发现的引擎及数据库/缓存/向量等类别，不声称已运行或各接口实际访问；未命名的“关系数据”不算识别了某引擎。SQLite 被标 file 时也不会忽略分类偏差。');
  const entries=model.entries.filter(e=>e.kind==='http'),known=entries.map(e=>({entry:e,route:entryPath(e)})),routeHits=expected.http.items.filter(r=>known.some(k=>k.entry.location.file===r.file&&k.route?.method===r.method&&normPath(k.route.path)===normPath(r.path)));
  grade('C',entries.length===expected.http.count?(routeHits.length===expected.http.count?'✓':'△'):'✗',`接口 ${entries.length}/${expected.http.count} · 路径 ${routeHits.length}/${expected.http.count}`,{actual:entries.length,expected:expected.http.count,pathMatches:routeHits.length,missing:expected.http.items.filter(r=>!routeHits.includes(r)).map(r=>({file:r.file,method:r.method,path:r.path}))},'总数与声明文件+方法+完整路径分别核对；同数但前缀缺失不算全对；不含框架自动端点。');
  const domains=model.entities.filter(e=>e.kind==='domain'),biggest=Math.max(0,...domains.map(d=>d.entryIds?.filter(id=>entries.some(e=>e.id===id)).length||0)),ratio=entries.length?biggest/entries.length:0;
  const distribution=expected.modules.items.map(m=>({name:m.name,expected:m.count,actual:entries.filter(e=>m.files.includes(e.location.file)).length})),correct=distribution.filter(d=>d.actual===d.expected).length;
  grade('D',ratio>.8||domains.length!==expected.modules.count||correct!==expected.modules.count?'✗':'✓',`模块 ${domains.length}/${expected.modules.count} · 分布 ${correct}/${expected.modules.count} · 最大 ${biggest}/${entries.length} (${(ratio*100).toFixed(1)}%)`,{actual:domains.length,expected:expected.modules.count,distribution,biggest,total:entries.length,ratio,domains:domains.map(d=>({name:d.name,count:d.entryIds?.length||0}))},ratio>.8?'按用户固定的 >80% 规则判 ✗；单 Controller 的真实小项目也会触发，不因此改答案或放宽阈值。':'按 Controller / 路由文件计标准模块；通过入口所属文件核对每组数量。');
  const frontHttp=model.relations.filter(r=>r.type==='HTTP'&&r.locations.some(l=>model.frontendFiles?.some(f=>f.path===l.file))),matchedFront=frontHttp.filter(r=>r.to&&entries.some(e=>e.symbolId===r.to)).length;
  grade('E','✗',`页面 无法评估/${expected.frontend.pages.count} · API 无法评估/${expected.frontend.api.count} · 对接 ${matchedFront} · 文件 ${model.frontendFiles?.length||0}`,{actualPages:null,expectedPages:expected.frontend.pages.count,actualApi:null,expectedApi:expected.frontend.api.count,matchedBackend:matchedFront,frontendHttpRelations:frontHttp.length,frontendFiles:model.frontendFiles?.length||0},'现有中间模型没有前端页面/API 定义集合；不能把本评估脚本独立数出的结果写回当产品能力。即使答案是 0，也不能把“字段不存在”说成已证明 0。');
  const m=graphs.metrics,isolated=m.isolated.length,tooMany=m.mainNodes>15,unjustified=isolated>0&&m.mainNodes>1;
  grade('F',!m.mainNodes||m.placeholder||tooMany||unjustified||graphs.mainLayout.error?'✗':'✓',`节点 ${m.mainNodes} · 边 ${m.mainEdges} · 占位 ${m.placeholder} · 孤立 ${isolated} · >15 ${tooMany?1:0}`,{nodes:m.mainNodes,edges:m.mainEdges,placeholder:m.placeholder,isolated:m.isolated,over15:tooMany,layoutError:graphs.mainLayout.error},'单独应用无外部关系时的一个孤立节点允许；多卡片孤立、空图、占位或超预算判失败。图的身份覆盖另看 A/E/WMS 诊断。');
  const c=m.controllerAboveService,l=m.entitiesCommonBelow,n=m.dependencyNodes,classes=m.classCountCards,wrong=c.total-c.correct+l.total-l.correct;
  grade('G',!n||m.crossings===null?'✗':wrong||classes<n||m.dependencyPlaceholder||m.dependencyOmitted?'✗':'✓',`层级 ${c.correct}/${c.total} · 下层 ${l.correct}/${l.total} · 交叉 ${m.crossings??'无法评估'} · 类数 ${classes}/${n} · 截去 ${m.dependencyOmitted}`,{...m.controllerAboveService,lower:m.entitiesCommonBelow,crossings:m.crossings,nodes:n,edges:m.dependencyEdges,classCountCards:classes,placeholder:m.dependencyPlaceholder,omitted:m.dependencyOmitted,roles:m.roles},n?'执行原 layout.worker 的 overview / DOWN 和原正交布线；只替换 ELK 传输。层级是可见节点中 Controller/Service 及实体/公共层的纵向比较；循环/混合模块不能证明细分角色。交叉按不同边正交段内部交点去重计，重叠共线不算。':'依赖视图没有节点，不能以 0 交叉当布局成功。');
  const visible=ui?.projects.find(project=>project.id===p.id),views=visible?.views||[],empty=views.filter(v=>!v.nodes),unexplained=empty.filter(v=>!v.emptyText),blank=views.reduce((n,v)=>n+v.blankCards,0),errors=(visible?.errors.length||0)+views.reduce((n,v)=>n+v.errors.length,0);
  grade('H',views.length!==3?'△':unexplained.length||blank||errors?'✗':'✓',`视图 ${views.length}/3 · 空图 ${empty.length} · 空框 ${blank} · 无说明 ${unexplained.length} · 错误 ${errors}`,{views,emptyViews:empty.length,blankCards:blank,unexplained:unexplained.length,errors,browserVerified:views.length===3},views.length===3?'当前真实组件+已导出完整模型，主干/接口/默认依赖三视图静态显示和空态文字核对，逐视图有截图；IPC 输入模拟，无目标页面或业务运行。只证明这三种初始显示，不扩展声称所有交互无裁切/遮挡。':'没有完成三视图静态显示核查，无法完整评估；不把图模型结果冒充窗口结果。');
 }
 table.push({project:p.id,commit:p.commit,grades});details.push({project:p,expected,run,grades});
}
await fs.writeFile(path.join(output,'scorecard.json'),JSON.stringify({schema:1,projects:table},null,2));

const baseline=await read(path.join(records,'baseline-subset.json'));
const differences=[];
for(const row of table)for(const key of 'ABCDEFGH'){
 const old=baseline.projects.find(project=>project.project===row.project)?.grades[key];
 if(old&&(old.status!==row.grades[key].status||old.text!==row.grades[key].text))differences.push({project:row.project,item:key,before:old.text,beforeStatus:old.status,after:row.grades[key].text,afterStatus:row.grades[key].status});
}
await fs.writeFile(path.join(output,'baseline-diff.json'),JSON.stringify({changed:differences.length,items:differences},null,2));
const lines=['# 公开语料评分（v1）','','保留原 v1 评分规则；缺失的语料不计为通过。私有语料默认未启用。','','| 项目 | A | B | C | D | E | F | G | H |','|---|---|---|---|---|---|---|---|---|',...table.map(row=>`| ${row.project} | ${[...'ABCDEFGH'].map(key=>cell(row.grades[key].status+' '+row.grades[key].text)).join(' | ')} |`),'','私有语料：已跳过（未启用）。',''];
await fs.writeFile(path.join(output,'SCORECARD.md'),lines.join('\n'));
console.log(`公开评分 v1：${table.length} 个项目；私有语料未启用。`);
