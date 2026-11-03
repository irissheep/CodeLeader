import path from 'node:path';
import signals from '../shared/discovery-signals.json';
import type {BuildDeclaration,DiscoveryEvidence,ProjectUnit} from '../shared/model';
import {isTestFile} from '../shared/source-roles';
import type {StructureResult} from './structure';

export const under=(file:string,root:string)=>!root||file===root||file.startsWith(root+'/');
export const directory=(file:string)=>path.posix.dirname(file)==='.'?'':path.posix.dirname(file);
export function discoveryEvidence(source:DiscoveryEvidence['source'],file:string,text:string,at:string|number,note:string,context?:string):DiscoveryEvidence{
 const offset=Math.max(0,typeof at==='number'?at:text.indexOf(at)),before=text.slice(0,offset),line=before.split('\n').length-1,character=offset-(before.lastIndexOf('\n')+1);
 return{source,location:{file,range:{start:{line,character},end:{line,character:character+1}}},note,...(context?{context}:{})};
}
interface Xml {name:string;text:string;offset:number;parent?:Xml;children:Xml[]}
// Read declarations only: no DTD, entity expansion, dynamic expressions or build execution.
function xml(text:string){const root:Xml={name:'',text:'',offset:0,children:[]},stack=[root];for(const m of text.matchAll(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<[^>]+>|[^<]+/g)){const token=m[0];if(token.startsWith('<!--')||token.startsWith('<?')||token.startsWith('<!'))continue;if(token.startsWith('</')){if(stack.length>1)stack.pop();}else if(token.startsWith('<')){const name=token.match(/^<([\w:.-]+)/)?.[1];if(!name)continue;const parent=stack.at(-1)!,n:Xml={name:name.split(':').at(-1)!,text:'',offset:m.index!,parent,children:[]};parent.children.push(n);if(!token.endsWith('/>'))stack.push(n);}else stack.at(-1)!.text+=token;}return root;}
const child=(n:Xml,name:string)=>n.children.find(c=>c.name===name);
const value=(n:Xml|undefined,name:string)=>n&&child(n,name)?.text.trim()||'';
function descendants(n:Xml,name:string):Xml[]{return n.children.flatMap(c=>[...(c.name===name?[c]:[]),...descendants(c,name)]);}
function inside(n:Xml,name:string):boolean{return n.name===name||!!n.parent&&inside(n.parent,name);}
const profile=(n:Xml):string|undefined=>n.name==='profile'?value(n,'id')||'未命名 环境设置':n.parent?profile(n.parent):undefined;
const pythonManifest=(f:string)=>/(?:^|\/)(?:requirements[^/]*\.txt|pyproject\.toml|Pipfile|setup\.cfg)$/.test(f);
function pythonDependencies(file:string,text:string){
 const found:{name:string;offset:number;context?:string}[]=[];let section='',array=false,context:string|undefined,offset=0;
 for(const line of text.split('\n')){
  const header=line.match(/^\s*\[([^\]]+)\]/);if(header){section=header[1];array=false;}
  const requirements=/requirements[^/]*\.txt$/.test(file),poetry=/^tool\.poetry\.(?:dependencies|dev-dependencies|group\.[^.]+\.dependencies)$/.test(section),pip=/^(?:packages|dev-packages)$/.test(section),setup=section==='options'&&/install_requires\s*=/.test(line);
  if(section==='project'&&/^\s*dependencies\s*=/.test(line)||section==='project.optional-dependencies'&&line.includes('=')||section==='dependency-groups'&&line.includes('=')||setup){array=true;context=section==='dependency-groups'?'development':section==='project.optional-dependencies'?'可选依赖':undefined;}
  const development=/dev|test/.test(section)||/requirements[^/]*(?:dev|test)[^/]*\.txt$/.test(file);
  if(requirements||poetry||pip||array){const body=array&&/^\s*[\w.-]+\s*=/.test(line)?line.slice(line.indexOf('=')+1):line,base=offset+line.indexOf(body),matches=array&&!setup?[...body.matchAll(/["']([\w][\w.-]*)(?:\[[^\]]*\])?(?=["'<>=!~ ;])/g)]:[...body.matchAll(/^\s*["']?([\w][\w.-]*)(?:\[[^\]]*\])?(?=["'\s<>=!~;]|$)/g)];for(const m of matches)found.push({name:m[1].toLowerCase().replaceAll('_','-'),offset:base+m.index!+m[0].indexOf(m[1]),context:development?'development':context});}
  if(array&&line.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g,'').includes(']'))array=false;offset+=line.length+1;
 }
 return found;
}
export function discoverUnits(result:StructureResult){
 const {index,configs,facts,syntax}=result,builds:BuildDeclaration[]=[],units:ProjectUnit[]=[],java=new Map<string,{boot:DiscoveryEvidence[];mains:DiscoveryEvidence[]}>(),packages=new Map<string,any>(),coordinates=new Map<string,string>();
 const add=(file:string,tool:BuildDeclaration['tool'],name:string,kind:BuildDeclaration['kind']='module')=>{const b:BuildDeclaration={id:`build:${tool}:${file}`,file,root:directory(file),tool,name,kind,dependencies:[],declaredDependencies:[],basis:[discoveryEvidence('build',file,configs.get(file)||'',0,`${tool} ${kind} 声明`)]};builds.push(b);return b;};
 for(const [file,text] of configs){
  if(file.endsWith('pom.xml')){
   const document=xml(text),project=child(document,'project');if(!project)continue;const parent=child(project,'parent'),group=value(project,'groupId')||value(parent,'groupId'),artifact=value(project,'artifactId'),b=add(file,'maven',`${group}:${artifact}`,value(project,'packaging')==='pom'?'aggregator':'module'),boot:DiscoveryEvidence[]=[];
   coordinates.set(b.id,b.name);
   for(const d of descendants(project,'dependency').filter(d=>!inside(d,'dependencyManagement')&&value(d,'scope')!=='test')){const name=`${value(d,'groupId')}:${value(d,'artifactId')}`;b.declaredDependencies.push({name,basis:discoveryEvidence('dependency',file,text,d.offset,`Maven ${name}`,profile(d))});}
   for(const p of descendants(project,'plugin').filter(p=>!inside(p,'pluginManagement')&&value(p,'artifactId')===signals.frameworks[0].plugin)){if(value(child(p,'configuration'),'skip')!=='true')boot.push(discoveryEvidence('build',file,text,p.offset,'Spring Boot 打包插件',profile(p)));}
   java.set(b.id,{boot,mains:[]});
  }else if(/(?:^|\/)build\.gradle(?:\.kts)?$/.test(file)){
   const b=add(file,'gradle',directory(file).split('/').at(-1)||index.name),boot:DiscoveryEvidence[]=[];
   const plugin=/\bid\s*(?:\(\s*)?["']org\.springframework\.boot["'](?:\s*\))?[^\n]*/g;
   for(const m of text.matchAll(plugin))if(!/\bapply\s+false\b/.test(m[0]))boot.push(discoveryEvidence('build',file,text,m.index!,'Spring Boot Gradle 插件'));
   for(const m of text.matchAll(/\bapply\s+plugin\s*:\s*["']org\.springframework\.boot["']/g))boot.push(discoveryEvidence('build',file,text,m.index!,'Spring Boot Gradle 插件'));
   for(const m of text.matchAll(/["']([\w.-]+:[\w.-]+)(?::[^"']*)?["']/g)){const prefix=text.slice(text.lastIndexOf('\n',m.index!)+1,m.index);if(/\b(?:test\w*|androidTest\w*|integrationTest\w*)\s*\(?\s*$/.test(prefix))continue;b.declaredDependencies.push({name:m[1],basis:discoveryEvidence('dependency',file,text,m.index!,`Gradle ${m[1]}`)});}
   for(const m of text.matchAll(/project\s*\(\s*["'](:[^"']+)["']/g)){const target=m[1].slice(1).replaceAll(':','/');b.declaredDependencies.push({name:`project:${target}`,basis:discoveryEvidence('dependency',file,text,m.index!,`Gradle project ${target}`)});}
   java.set(b.id,{boot,mains:[]});
  }else if(file.endsWith('package.json')){
   try{const p=JSON.parse(text),b=add(file,'npm',String(p.name||directory(file)||index.name),'package');packages.set(b.id,p);if(p.name)coordinates.set(b.id,p.name);for(const [name] of Object.entries({...p.dependencies,...p.devDependencies}))b.declaredDependencies.push({name,basis:discoveryEvidence('dependency',file,text,`"${name}"`,`npm ${name}`,p.dependencies?.[name]?'production':'development')});}catch{index.diagnostics.push({file,message:'项目声明没读懂，已保留其他文件。',severity:'warning'});}
  }else if(pythonManifest(file)){
   const b=add(file,'python',directory(file)||index.name,'package'),name=text.match(/\[(?:project|tool\.poetry)\]([\s\S]*?)(?=\n\[|$)/)?.[1].match(/^name\s*=\s*["']([^"']+)["']/m)?.[1];if(name)coordinates.set(b.id,name);
   for(const d of pythonDependencies(file,text))b.declaredDependencies.push({name:d.name,basis:discoveryEvidence('dependency',file,text,d.offset,`Python ${d.name}`,d.context)});
  }
 }
 const ownerBuild=(file:string,tool:BuildDeclaration['tool'][])=>builds.filter(b=>tool.includes(b.tool)&&under(file,b.root)).sort((a,b)=>b.root.length-a.root.length)[0];
 for(const [file,s] of syntax){if(!file.endsWith('.java')||isTestFile(file,index))continue;const b=ownerBuild(file,['maven','gradle']);if(!b)continue;const meta=java.get(b.id)!;
  for(const main of s.mains){const symbol=index.symbols.find(v=>v.id===main.symbolId),owner=index.symbols.find(v=>v.id===symbol?.parent),d=facts.get(file)?.definitions.find(v=>v.id===owner?.id),annotation=d?.annotations||'',target=signals.frameworks[0].annotation!;
   const imported=facts.get(file)?.imports.some(i=>i.target===target||i.target===target.slice(0,target.lastIndexOf('.'))+'.*');
   const evidence:DiscoveryEvidence={source:'entry',location:main.location,note:'Java public static void main'};
   meta.mains.push(evidence);if(annotation.includes('@'+target)||imported&&/@SpringBootApplication\b/.test(annotation))meta.boot.push({...evidence,note:'Spring Boot 启动类与 main'});
  }
 }
 for(const b of builds){for(const d of b.declaredDependencies){const target=builds.find(t=>t.id!==b.id&&t.tool===b.tool&&(coordinates.has(t.id)&&coordinates.get(t.id)===d.name||d.name.startsWith('project:')&&t.root.endsWith(d.name.slice(8))));if(target)b.dependencies.push(target.id);}b.dependencies=[...new Set(b.dependencies)];}
 const create=(b:BuildDeclaration,kind:ProjectUnit['kind'],language:ProjectUnit['language'],framework:string,basis:DiscoveryEvidence[])=>{const id=`unit:${language}:${b.root||'.'}`,previous=units.find(u=>u.id===id);if(previous){previous.buildIds.push(b.id);previous.basis.push(...b.basis,...basis);if(kind==='application')previous.kind=kind;return previous;}const u:ProjectUnit={id,root:b.root,kind,language,framework,buildIds:[b.id],usedBy:[],basis:[...b.basis,...basis]};units.push(u);return u;};
 for(const b of builds.filter(b=>java.has(b.id))){const m=java.get(b.id)!,hasSource=index.files.some(f=>f.language==='java'&&ownerBuild(f.path,['maven','gradle'])?.id===b.id&&!isTestFile(f.path,index));if(b.tool==='gradle'&&!hasSource&&[...configs.keys()].some(f=>directory(f)===b.root&&/(?:^|\/)settings\.gradle(?:\.kts)?$/.test(f)))b.kind='aggregator';if(b.kind==='aggregator'&&!hasSource)continue;const application=m.boot.length||m.mains.length&&!builds.some(other=>other.dependencies.includes(b.id));create(b,application?'application':'library','java',m.boot.length?'Spring Boot':'Java',[...m.boot,...m.mains]);}
 for(const [file,s] of syntax)if(file.endsWith('.java')&&!isTestFile(file,index)&&!ownerBuild(file,['maven','gradle'])&&s.mains.length){const root=directory(file),id=`unit:java:${root||'.'}`,basis=s.mains.map(m=>({source:'entry' as const,location:m.location,note:'Java public static void main（无构建声明）'})),previous=units.find(u=>u.id===id);if(previous)previous.basis.push(...basis);else units.push({id,root,kind:'application',language:'java',framework:'Java',buildIds:[],usedBy:[],basis});}
 for(const b of builds.filter(b=>b.tool==='npm')){const p=packages.get(b.id),framework=signals.frontend.find(f=>b.declaredDependencies.some(d=>d.name===f.dependency)),entry=(index.frontendFiles||[]).find(f=>!isTestFile(f.path,index)&&ownerBuild(f.path,['npm'])?.id===b.id&&signals.frontendEntries.some(e=>new RegExp(e.pattern).test(path.posix.relative(b.root||'.',f.path)))),script=Object.keys(p.scripts||{}).find(k=>/^(?:dev|serve|start|build)(?::[\w-]+)?$/.test(k));
  const basis:DiscoveryEvidence[]=[];if(framework)basis.push(b.declaredDependencies.find(d=>d.name===framework.dependency)!.basis);if(entry)basis.push(discoveryEvidence('entry',entry.path,'',0,'页面入口'));if(script)basis.push(discoveryEvidence('build',b.file,configs.get(b.file)!,`"${script}"`,`启动或构建脚本 ${script}（未执行）`));
  create(b,framework&&entry&&script?'frontend':p.main||p.exports?'library':'tool','javascript',framework?.name||'Node.js',basis);
 }
 const pythonRoots=[...new Set(builds.filter(b=>b.tool==='python').map(b=>b.root))];
 for(const root of pythonRoots){const related=builds.filter(b=>b.tool==='python'&&b.root===root),deps=related.flatMap(b=>b.declaredDependencies),basis:DiscoveryEvidence[]=[],frameworks:string[]=[];
  for(const f of signals.frameworks.filter(f=>f.language==='python'&&deps.some(d=>d.name===f.dependency))){
   const matches:DiscoveryEvidence[]=[];
   for(const [file,program] of facts){if(!file.endsWith('.py')||isTestFile(file,index)||ownerBuild(file,['python'])?.root!==root)continue;
    if(typeof f.constructor==='string')for(const c of program.calls){const parts=c.callee.split('.');let scope:string|undefined=c.scope===`file:${file}`?`${file}:module`:c.scope,binding;const scopes=syntax.get(file)?.scopes||[];while(scope&&!binding){const current=scopes.find(s=>s.id===scope);binding=current?.bindings.filter(b=>b.name===parts[0]).at(-1);if(!binding&&program.definitions.find(d=>d.id===scope)?.params.some(p=>p.name===parts[0]))break;scope=current?.parent;}const canonical=binding?.kind==='import'?[binding.value.replace(':','.').replace(/\.$/,''),...parts.slice(1)].join('.'):undefined;if(canonical===f.constructor)matches.push({source:'entry',location:c.location,note:`${f.name} 应用对象创建（包括工厂内）`});}
    if(f.settings&&path.posix.basename(file)==='manage.py'){const source=result.texts.get(file)||'',m=source.match(/DJANGO_SETTINGS_MODULE["']\s*,\s*["']([\w.]+)["']/);if(m){const settings=path.posix.join(root,m[1].replaceAll('.','/')+'.py');if(result.texts.has(settings))matches.push(discoveryEvidence('entry',file,source,m.index!,'Django manage.py 与实际 settings 文件'),discoveryEvidence('configuration',settings,result.texts.get(settings)!,0,'Django settings'));}}
   }
   if(matches.length){frameworks.push(f.name);basis.push(deps.find(d=>d.name===f.dependency)!.basis,...matches);}
  }
  const hasSource=index.files.some(f=>f.language==='python'&&!isTestFile(f.path,index)&&ownerBuild(f.path,['python'])?.root===root),production=related.some(b=>coordinates.has(b.id)||b.declaredDependencies.some(d=>d.basis.context!=='development')),u=create(related[0],basis.length?'application':hasSource&&production?'library':'tool','python',frameworks.join(' / ')||'Python',basis);u.buildIds=related.map(b=>b.id);
 }
 // Resolve local declared dependencies, then attach libraries transitively to consuming applications.
 for(const app of units.filter(u=>u.kind==='application'||u.kind==='frontend')){const seen=new Set<string>(),visit=(id:string)=>{if(seen.has(id))return;seen.add(id);for(const next of builds.find(b=>b.id===id)?.dependencies||[])visit(next);};app.buildIds.forEach(visit);for(const lib of units.filter(u=>u.kind==='library'&&u.buildIds.some(id=>seen.has(id))))if(lib.id!==app.id)lib.usedBy.push(app.id);}
 // Keep old runtime consumers working, but never project libraries/aggregators as applications.
 const previous=index.components||[];
 index.components=units.filter(u=>u.kind==='application'||u.kind==='frontend').map(u=>{const kind=u.kind==='frontend'?'frontend':u.language==='java'?'java':'python',old=previous.find(c=>c.kind===kind&&c.root===u.root);return{id:`component:${kind}:${u.root}`,kind,root:u.root,framework:u.framework,location:u.basis[0].location,...(old?.port?{port:old.port}:{})};});
 index.buildDeclarations=builds;index.units=units;index.versions.discovery=signals.version;
}
