import fs from 'node:fs/promises';
import sync from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type {ProjectIndex} from '../shared/model';
import type {StartupPlan,StartupCommand,StartupTools} from '../shared/startup';
import type {RuntimeComponent,RuntimeEnvironment} from './runtime-configuration';
import {discoverStartup,startupTexts} from './startup-discovery';
import {startupArtifacts} from './startup-artifacts';
import {managedPath} from '../../scripts/managed-path.mjs';

export function startupTools(base:string):StartupTools {
 const find=(name:string)=>(process.env.PATH||'').split(path.delimiter).map(dir=>path.join(dir,name)).find(file=>sync.existsSync(file));
 const mvn=process.env.CODELEADER_MAVEN||find('mvn.cmd'),gradle=process.env.CODELEADER_GRADLE||find('gradle.bat'),node=process.env.CODELEADER_NODE||find('node.exe'),npm=process.env.CODELEADER_NPM||find('npm.cmd');
 return {java:process.env.CODELEADER_JAVA||path.join(base,'resources/jre/bin/java.exe'),mavenHome:mvn?path.resolve(path.dirname(mvn),'..'):undefined,gradleHome:gradle?path.resolve(path.dirname(gradle),'..'):undefined,python:process.env.CODELEADER_PYTHON||path.join(base,'.tools/runtime/python/Scripts/python.exe'),node,npm:npm?path.join(path.dirname(npm),'node_modules/npm/bin/npm-cli.js'):undefined};
}
export class StartupManager {
 private previews=new Map<string,StartupPlan>();private confirmations=new Map<string,{projectId:string;revision:string;environment:RuntimeEnvironment}>();
 constructor(private base:string,private data:string){}
 reset(){this.previews.clear();this.confirmations.clear();}
 revoke(token:string){this.confirmations.delete(token);}
 private folder(id:string){if(!/^[a-f0-9]{20}$/.test(id))throw Error('项目身份无效');return managedPath(path.join(this.base,'.tools/runtime/environments',id));}
 async preview(index:ProjectIndex){
  const folder=this.folder(index.id),plan=discoverStartup(index,await startupTexts(index.root),path.join(folder,'source'));
  for(const unit of index.units?.filter(item=>item.kind==='frontend')||[])if(!plan.choices.some(item=>item.unitId===unit.id))plan.choices.push({id:unit.id+':manual',unitId:unit.id,name:unit.root||index.name,root:unit.root,language:unit.language,framework:unit.framework,profile:'defaults',command:{tool:'npm',args:['run',''],label:'',basis:[]},prepare:[],basis:[]});
  for(const artifact of await startupArtifacts(index)){const unit=index.units!.find(u=>u.id===artifact.unitId)!;plan.choices.push({id:unit.id+':jar:'+artifact.file,unitId:unit.id,name:unit.root||index.name,root:unit.root,language:'java',framework:unit.framework,serviceId:unit.serviceId,artifact:artifact.file,profile:'defaults',port:plan.choices.find(c=>c.unitId===unit.id)?.port,command:{tool:'java',args:['-jar',path.join(plan.copy,artifact.file)],label:'java -jar '+path.join(plan.copy,artifact.file),basis:[{file:artifact.file,note:'JAR 声明入口 '+artifact.main+'；还不能确认它与当前源码一致'}]},prepare:[],basis:[{file:artifact.file,note:'已构建的可运行 JAR'}]});if(!plan.selected.some(id=>plan.choices.find(c=>c.id===id)?.unitId===unit.id))plan.selected.push(plan.choices.at(-1)!.id);}
  try{const saved=JSON.parse(await fs.readFile(path.join(folder,'startup.json'),'utf8'));if(saved.projectId===index.id&&saved.sourceVersion===plan.sourceVersion){for(const c of plan.choices){const prior=saved.choices?.find((p:any)=>p.id===c.id&&p.unitId===c.unitId);if(prior){c.command.args=prior.command.args;c.command.label=prior.command.label;c.root=prior.root;c.port=prior.port;}}plan.selected=saved.selected.filter((id:string)=>plan.choices.some(c=>c.id===id));plan.url=saved.url;plan.excludedUrls=saved.excludedUrls||'';}}catch{}
  this.previews.set(index.id,structuredClone(plan));return plan;
 }
 async confirm(index:ProjectIndex,input:StartupPlan){
  const original=this.previews.get(index.id);if(!original||input?.projectId!==index.id||input.revision!==original.revision||input.sourceVersion!==original.sourceVersion)throw Error('请重新查看本项目的启动方式');
  if(!Array.isArray(input.selected)||!input.selected.length||new Set(input.selected).size!==input.selected.length)throw Error('请选择要启动的应用');
  const plan=structuredClone(original),tools=startupTools(this.base),folder=this.folder(index.id),components:RuntimeComponent[]=[],units=new Set<string>();
  if(typeof input.excludedUrls!=='string'||input.excludedUrls.length>2000)throw Error('忽略地址太长');try{for(const regex of input.excludedUrls.split(',').filter(Boolean))new RegExp(regex);}catch{throw Error('忽略地址格式不正确');}
  for(const id of input.selected){const c=plan.choices.find(c=>c.id===id),edit=input.choices?.find(c=>c.id===id);if(!c||!edit||units.has(c.unitId))throw Error('每个应用请选择一种启动方式');units.add(c.unitId);
   if(!Array.isArray(edit.command?.args)||!edit.command.args.length||edit.command.args.length>100||edit.command.args.some(a=>typeof a!=='string'||a.length>8192||a.includes('\0')))throw Error('请填写完整启动命令');
   if(edit.port!==undefined&&(!Number.isInteger(edit.port)||edit.port<1||edit.port>65535))throw Error('端口应在 1–65535 之间');
   if(typeof edit.root!=='string'||path.isAbsolute(edit.root)||edit.root.split(/[\\/]/).includes('..'))throw Error('目录应在本项目副本内');
   c.command.args=edit.command.args;c.command.label=edit.command.label;c.root=edit.root;c.port=edit.port;
   const cwd=managedPath(path.join(plan.copy,c.root)),component=this.command(c.command,cwd,tools,folder,c.unitId);component.port=c.port;component.serviceId=c.serviceId;component.unitId=c.unitId;component.name=c.name;component.displayCommand=c.command.label;
   if(c.framework==='Spring Boot')component.env={...component.env,...c.port?{SERVER_PORT:String(c.port)}:{},...c.profile!=='defaults'?{SPRING_PROFILES_ACTIVE:c.profile}:{}};
   if(c.port!==original.choices.find(p=>p.id===c.id)?.port&&c.port){
    if(c.command.tool==='python'){const at=component.args.indexOf('--port');if(at>=0)component.args[at+1]=String(c.port);else component.args.push('--port',String(c.port));}
    if(c.command.tool==='npm'){if(c.portOption==='PORT')component.env={...component.env,PORT:String(c.port)};else if(c.portOption)component.args.push('--',c.portOption,String(c.port));else throw Error('这个启动命令的端口需要在命令里修改');}
   }
   if(c.language==='python')component.pythonRoot=cwd;
   if(c.artifact)component.unverifiedArtifact=true;
   component.prepare=[...component.prepare||[],...c.prepare.map(p=>this.command(p,cwd,tools,folder,c.unitId))];
   if(c.language==='python'){
    const python=managedPath(path.join(folder,'python',c.unitId.replace(/[^\w-]/g,'_'),'Scripts/python.exe'));
    const venv=path.resolve(python,'../..'),requirements=path.join(cwd,'requirements.txt'),sourceRequirements=path.join(index.root,c.root,'requirements.txt'),toolRequirements=path.join(this.base,'runtime/python/requirements-observe.txt'),hash=crypto.createHash('sha256').update(await fs.readFile(sourceRequirements).catch(()=>Buffer.from(''))).update(await fs.readFile(toolRequirements)).digest('hex'),receipt=managedPath(path.join(venv,'prepared.txt'));
    if(!sync.existsSync(python)||(await fs.readFile(receipt,'utf8').catch(()=>''))!==hash){
     const installation:RuntimeComponent[]=[];
     if(!sync.existsSync(python))installation.push({role:'prepare',executable:tools.python!,args:['-m','venv',venv],cwd:plan.copy});
     if(sync.existsSync(sourceRequirements))installation.push({role:'prepare',executable:python,args:['-m','pip','install','--disable-pip-version-check','-r',requirements],cwd});
     installation.push({role:'prepare',executable:python,args:['-m','pip','install','--disable-pip-version-check','-r',toolRequirements],cwd});component.prepare.unshift(...installation);component.prepareReceipt={file:receipt,hash};
    }
    component.executable=python;component.env={...component.env,PATH:path.dirname(python)+path.delimiter+(process.env.PATH||'')};for(const p of component.prepare)if(p.role==='python')p.executable=python;
   }
   components.push(component);
  }
  const url=new URL(input.url);if(!['http:','https:'].includes(url.protocol)||!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||url.username||url.password)throw Error('请填写本机页面地址');
  const ports=components.map(c=>c.port).filter(Boolean);if(new Set(ports).size!==ports.length)throw Error('两个应用使用同一端口，请修改后再启动');
  plan.selected=input.selected;plan.url=input.url;plan.excludedUrls=input.excludedUrls;
  await fs.mkdir(folder,{recursive:true});
  if(path.resolve(index.root).toLowerCase()===path.resolve(plan.copy).toLowerCase())throw Error('需要独立副本');
  await fs.cp(index.root,plan.copy,{recursive:true,force:true,filter:async source=>{
   if((await fs.lstat(source)).isSymbolicLink())return false;
   const relative=path.relative(index.root,source);if(relative.split(path.sep).some(part=>['.git','node_modules','target','build','dist','.venv','venv','__pycache__'].includes(part)))return false;
   managedPath(path.join(plan.copy,relative));return true;
  }});
  for(const c of plan.choices.filter(c=>plan.selected.includes(c.id)&&c.artifact)){const target=managedPath(path.join(plan.copy,c.artifact!));await fs.mkdir(path.dirname(target),{recursive:true});await fs.copyFile(path.join(index.root,c.artifact!),target);}
  await fs.writeFile(managedPath(path.join(folder,'startup.json')),JSON.stringify(plan,null,2));
  const environment:RuntimeEnvironment={projectRoot:index.root,sourceVersion:plan.sourceVersion,copy:plan.copy,components,excludedUrls:plan.excludedUrls};
  const token=crypto.randomUUID();this.confirmations.set(token,{projectId:index.id,revision:plan.revision,environment});return {token,plan};
 }
 take(index:ProjectIndex,token?:string){const item=token&&this.confirmations.get(token);if(!item||item.projectId!==index.id)throw Error('请先确认本项目的启动方式');this.confirmations.delete(token!);return item.environment;}
 private command(command:StartupCommand,cwd:string,tools:StartupTools,folder:string,unitId:string):RuntimeComponent {
  const args=command.args;let component:RuntimeComponent;
  if(command.tool==='maven'){
   if(!tools.mavenHome||!tools.java)throw Error('没找到 Maven，请把已有 Maven 加入 PATH 后重试');
   const boot=path.join(tools.mavenHome,'boot'),jar=sync.readdirSync(boot).find(file=>/^plexus-classworlds-.*\.jar$/.test(file));if(!jar)throw Error('Maven 文件不完整');
   component={role:'java',executable:tools.java,cwd,javaBootstrap:'maven',args:['-Djava.io.tmpdir='+path.join(this.data,'temp'),'-Duser.home='+path.join(this.base,'.tools/java-home'),'-classpath',path.join(boot,jar),'-Dclassworlds.conf='+path.join(tools.mavenHome,'bin/m2.conf'),'-Dmaven.home='+tools.mavenHome,'-Dmaven.multiModuleProjectDirectory='+cwd,'org.codehaus.plexus.classworlds.launcher.Launcher','-B','-s',path.join(this.base,'scripts/maven-settings.xml'),'-gs',path.join(this.base,'scripts/maven-settings.xml'),'-Dmaven.repo.local='+path.join(this.base,'.cache/maven'),...args]};
  }else if(command.tool==='gradle'){
   if(!tools.gradleHome||!tools.java)throw Error('没找到 Gradle，请选择已有启动方式或配置工具位置');
   const lib=path.join(tools.gradleHome,'lib'),launcher=sync.readdirSync(lib).find(file=>/^gradle-launcher-.*\.jar$/.test(file));if(!launcher)throw Error('Gradle 文件不完整');
   component={role:'java',executable:tools.java,cwd,javaBootstrap:'gradle',args:['-Djava.io.tmpdir='+path.join(this.data,'temp'),'-Duser.home='+path.join(this.base,'.tools/java-home'),'-Dgradle.user.home='+path.join(this.base,'.cache/gradle'),'-classpath',path.join(lib,launcher),'org.gradle.launcher.GradleMain','--no-daemon',...args]};
  }else if(command.tool==='npm'){
   if(!tools.node||!tools.npm||!sync.existsSync(tools.npm))throw Error('没找到 npm，请配置已安装的 Node');component={role:'frontend',executable:tools.node,args:[tools.npm,...args],cwd,env:{npm_config_cache:path.join(this.base,'.cache/npm')}};
   component.prepare=[{...component,role:'prepare',args:[tools.npm,'install','--no-audit','--no-fund']}];
  }else if(command.tool==='python'){
   if(!tools.python||!sync.existsSync(tools.python))throw Error('没找到 Python，请配置已有 Python');
   component={role:'python',executable:tools.python,cwd,args:[path.join(this.base,'runtime/python/launch.py'),command.module?'--module':'--file',...args],env:{CODELEADER_EXCLUDED_URLS:''}};
  }else{const jar=args.indexOf('-jar');if(jar<0||!args[jar+1])throw Error('请填写 java -jar 后的文件位置');component={role:'java',executable:tools.java!,cwd,args:[],java:{jar:managedPath(path.resolve(cwd,args[jar+1])),vmArgs:args.slice(0,jar),args:args.slice(jar+2)}};}
  return component;
 }
}
