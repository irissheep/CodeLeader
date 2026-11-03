import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import type {ProjectIndex,ProjectUnit} from '../shared/model';
import type {StartupPlan,StartupChoice,StartupCommand,StartupEvidence} from '../shared/startup';
import policy from '../shared/runtime-policy.json';
import defaults from '../shared/http-link-policy.json';
import {springSettings} from '../analysis/frontend-link-config';
import {managedPath} from '../../scripts/managed-path.mjs';
import yaml from 'js-yaml';

const ignored=new Set(['.git','node_modules','target','build','dist','.venv','venv','__pycache__','.cache','.idea']);
const metadata=(name:string)=>/^(?:package\.json|pom\.xml|build\.gradle(?:\.kts)?|Procfile|Dockerfile(?:\..*)?|boot\.sh|README(?:\.md|\.rst)?|pyproject\.toml|manage\.py|requirements[^/]*\.txt|\.flaskenv|\.env(?:\..*)?|application(?:-[\w-]+)?\.(?:properties|ya?ml)|(?:vite|vue)\.config\.[cm]?[jt]s|(?:docker-)?compose[^/]*\.ya?ml)$/.test(name);
const inUnit=(file:string,root:string)=>!root||file.startsWith(root+'/');
export function words(text:string){const tokens=text.match(/"(?:\\.|[^"\\])*"|'[^']*'|[^\s]+/g)||[];return tokens.map(s=>s.replace(/^(['"])([\s\S]*)\1$/,'$2'));}
export async function startupTexts(root:string){const result=new Map<string,string>();async function walk(folder:string){for(const entry of await fs.readdir(path.join(root,folder),{withFileTypes:true})){if(entry.isSymbolicLink())continue;const file=path.posix.join(folder,entry.name);if(entry.isDirectory()){if(!ignored.has(entry.name))await walk(file);}else if(metadata(entry.name)&&(await fs.stat(path.join(root,file))).size<=policy.thresholds.metadataBytes.value)result.set(file,await fs.readFile(path.join(root,file),'utf8'));}}await walk('');return result;}
export function discoverStartup(index:ProjectIndex,texts:Map<string,string>,copy:string):StartupPlan {
 const choices:StartupChoice[]=[],warnings:string[]=[],sourceVersion=crypto.createHash('sha256').update(index.files.map(f=>f.path+':'+f.hash).sort().join('\n')).digest('hex');
 const at=(file:string,key:string,note:string):StartupEvidence=>({file,line:Math.max(0,(texts.get(file)||'').split('\n').findIndex(l=>l.includes(key)))+1,note});
 const settings=[...texts].filter(([f])=>/application(?:-[\w-]+)?\.(?:properties|ya?ml)$/.test(f)).flatMap(([file,text])=>springSettings(file,text));
 const add=(unit:ProjectUnit,command:StartupCommand,port?:number,profile='defaults',prepare:StartupCommand[]=[])=>{choices.push({id:unit.id+':'+choices.length,unitId:unit.id,name:unit.root||index.name,root:unit.root,language:unit.language,framework:unit.framework,serviceId:unit.serviceId,port,profile,command,prepare,basis:[...unit.basis.map(b=>({file:b.location.file,line:b.location.range.start.line+1,note:b.note})),...command.basis]});};
 for(const unit of index.units?.filter(u=>u.kind==='application'||u.kind==='frontend')||[]){
  const unitFiles=[...texts].filter(([f])=>inUnit(f,unit.root)),rootFile=(name:string)=>unit.root?unit.root+'/'+name:name;
  const explicit=settings.filter(s=>s.key==='server.port'&&inUnit(s.location.file,unit.root)),ports=explicit.length?explicit.map(s=>({port:Number(s.value.match(/^\$\{[^:}]+:(\d+)\}$/)?.[1]||s.value)||undefined,profile:s.profile,basis:{file:s.location.file,line:s.location.range.start.line+1,note:'端口设置'}})):[{port:defaults.serverDefaults.find(d=>d.framework===unit.framework)?.port,profile:'defaults',basis:undefined}];
  if(unit.kind==='frontend'){
   const file=rootFile('package.json');let pkg:any;try{pkg=JSON.parse(texts.get(file)||'');}catch{warnings.push(`${unit.root||index.name} 没读到启动脚本`);continue;}
   let port:number|undefined;const basis:StartupEvidence[]=[];
   for(const [file,text]of unitFiles.filter(([name])=>/(?:^|\/)(?:package\.json|(?:vite|vue)\.config\.[cm]?[jt]s)$/.test(name))){const m=text.match(/(?:\bport\s*[:=]\s*|--port(?:=|\s+))(\d{1,5})/i),fallback=text.match(/\bport\s*:\s*[^\n,}]+\|\|\s*(\d{1,5})/i);if(m||fallback){const found=m||fallback!;port=Number(found[1]);basis.push(at(file,found[0],fallback&&!m?'页面端口默认值':'页面端口'));break;}}
   const server=policy.frontendServers.find(row=>pkg.dependencies?.[row.dependency]||pkg.devDependencies?.[row.dependency]);
   const envPort=unitFiles.filter(([f])=>/\/\.env(?:\.|$)|^\.env(?:\.|$)/.test(f)).flatMap(([file,text])=>[...text.matchAll(/^\s*([\w]*PORT)\s*=\s*['"]?(\d+)['"]?\s*$/gm)].map(m=>({port:Number(m[2]),basis:at(file,m[1],'端口默认值')})))[0];
   for(const script of policy.scripts)if(typeof pkg.scripts?.[script]==='string'){const match=pkg.scripts[script].match(/--port(?:=|\s+)(\d+)/);add(unit,{tool:'npm',args:['run',script],label:'npm run '+script,basis:[at(file,'"'+script+'"',pkg.scripts[script]),...basis,...envPort?[envPort.basis]:[]]},Number(match?.[1])||port||envPort?.port);choices.at(-1)!.portOption=server?.portOption;}
   continue;
  }
  if(unit.language==='java'&&unit.framework==='Spring Boot'){
   for(const build of (index.buildDeclarations||[]).filter(b=>unit.buildIds.includes(b.id)&&['maven','gradle'].includes(b.tool)))for(const p of ports){const args=build.tool==='maven'?['spring-boot:run']:['bootRun'];add(unit,{tool:build.tool as 'maven'|'gradle',args,label:(build.tool==='maven'?'mvn':'gradle')+' '+args[0],basis:[at(build.file,'spring','启动应用的构建声明'),...p.basis?[p.basis]:[]]},p.port,p.profile);}
   continue;
  }
  const prepare:StartupCommand[]=[],commands:{file:string;args:string[]}[]=[];
  const command=(file:string,value:unknown)=>{let args=Array.isArray(value)&&value.every(v=>typeof v==='string')?value as string[]:typeof value==='string'?words(value):[];if(/^python(?:3(?:\.\d+)?)?$/.test(args[0]||'')&&args[1]==='-m')args=args.slice(2);if(policy.pythonCommands.includes(args[0]))commands.push({file,args});};
  for(const [file,text]of texts){if(/compose[^/]*\.ya?ml$/.test(file))try{const document=yaml.load(text) as any;for(const service of Object.values(document?.services||{}) as any[]){const context=typeof service.build==='string'?service.build:service.build?.context;if(typeof context==='string'&&path.posix.normalize(path.posix.join(path.posix.dirname(file),context)).replace(/^\.$/,'')===unit.root)command(file,service.command);}}catch{}
   if(inUnit(file,unit.root)&&/Dockerfile/.test(file))for(const m of text.matchAll(/^\s*(?:CMD|ENTRYPOINT)\s+(\[[^\r\n]+\])/gm))try{command(file,JSON.parse(m[1]));}catch{}
  }
  for(const [file,text]of unitFiles){if(path.posix.basename(file)==='Procfile'){for(const line of text.split('\n').filter(l=>/^web\s*:/.test(l)))for(const part of line.replace(/^web\s*:/,'').split(';').map(s=>s.trim()).filter(Boolean)){const args=words(part);if(policy.pythonCommands.includes(args[0])){if(args[0]==='flask'&&args[1]!=='run')prepare.push({tool:'python',module:true,args:['flask',...args.slice(1)],label:part,basis:[at(file,part,'启动前步骤')]});else commands.push({file,args});}}}
   else if(/Dockerfile|README|pyproject/.test(file)){for(const match of text.matchAll(/\b(uvicorn|flask|gunicorn)\s+([^\r\n`]+)/g)){const args=words(match[0].replace(/^["']|["']$/g,''));if(args.length)commands.push({file,args});}}
  }
  let port:number|undefined;let portFile:string|undefined;
  for(const [file,text]of unitFiles){const m=text.match(/(?:--port(?:=|\s+)|EXPOSE\s+|--bind\s+(?:[^:\s]+)?:|\s-b\s+:)(\d{2,5})/i);if(m){port=Number(m[1]);portFile=file;break;}}
  const env=unitFiles.find(([file])=>path.posix.basename(file)==='.flaskenv'),app=env?.[1].match(/^\s*FLASK_APP\s*=\s*([^\r\n]+)/m)?.[1]?.trim();
  if(unit.framework==='Flask'&&app){const file=env![0],args=['flask','--app',app,'run','--no-reload','--no-debugger','--host','127.0.0.1','--port',String(port||defaults.serverDefaults.find(d=>d.framework==='Flask')!.port)];add(unit,{tool:'python',module:true,args,label:'python -m '+args.join(' '),basis:[at(file,'FLASK_APP','Flask 应用入口；Windows 使用 Flask 官方启动方式'),...portFile?[at(portFile,String(port),'服务端口')]:[]]},Number(args.at(-1)),'defaults',prepare);}
  for(const item of commands){const [tool,...args]=item.args;if(tool==='gunicorn'){const entry=args.find(a=>/^[\w.]+:[\w.]+$/.test(a));if(unit.framework==='Flask'&&entry&&!app){const flask=['flask','--app',entry,'run','--no-reload','--no-debugger','--host','127.0.0.1','--port',String(port||defaults.serverDefaults.find(d=>d.framework==='Flask')!.port)];add(unit,{tool:'python',module:true,args:flask,label:'python -m '+flask.join(' '),basis:[at(item.file,tool,'Gunicorn 的同一入口；Windows 使用 Flask 官方启动方式')]},Number(flask.at(-1)),'defaults',prepare);}continue;}
    if(tool==='uvicorn'&&args.some(a=>/^[\w.]+:[\w.]+$/.test(a))||tool==='fastapi'&&args[0]==='run')add(unit,{tool:'python',module:true,args:[tool,...args],label:'python -m '+[tool,...args].join(' '),basis:[at(item.file,tool,'源码声明的 Python 启动命令')]},port||defaults.serverDefaults.find(d=>d.framework==='FastAPI')?.port,'defaults',prepare);
    if(tool==='flask'&&!app&&args.includes('run'))add(unit,{tool:'python',module:true,args:[tool,...args],label:'python -m '+[tool,...args].join(' '),basis:[at(item.file,tool,'源码声明的 Flask 启动命令')]},port||defaults.serverDefaults.find(d=>d.framework==='Flask')?.port,'defaults',prepare);
  }
  const manage=rootFile('manage.py');if(texts.has(manage))add(unit,{tool:'python',args:['manage.py','runserver','--noreload'],label:'python manage.py runserver --noreload',basis:[at(manage,'DJANGO_SETTINGS_MODULE','Django 启动入口')]},defaults.serverDefaults.find(d=>d.framework==='Django')?.port);
 }
 choices.sort((a,b)=>policy.toolPreference.order.indexOf(a.command.tool)-policy.toolPreference.order.indexOf(b.command.tool));
 const selected=[...new Set(choices.map(c=>c.unitId))].flatMap(id=>choices.find(c=>c.unitId===id&&c.profile==='defaults')?.id||choices.find(c=>c.unitId===id)?.id||[]),selectedChoices=choices.filter(c=>selected.includes(c.id));
 const page=selectedChoices.filter(c=>index.units?.find(u=>u.id===c.unitId)?.kind==='frontend'),servers=selectedChoices.filter(c=>c.language!=='javascript'),single=page.length===1?page[0]:page.length===0&&servers.length===1?servers[0]:undefined;
 const data={projectId:index.id,sourceVersion,copy:managedPath(copy),choices,selected,url:single?.port?'http://127.0.0.1:'+single.port:'',excludedUrls:policy.excludedUrls.default,resources:(index.resources||[]).map(r=>({engine:r.engine,kind:r.kind,note:r.kind==='database'?'按所选启动方式使用':'没有自动启动，相关功能可能不可用'})),warnings,revision:''};data.revision=crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');return data;
}
