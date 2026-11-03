import path from 'node:path';
import { load, JSON_SCHEMA } from 'js-yaml';
import type { Evidence, Location } from '../shared/model';
import type { StructureResult } from './structure';
import { basis } from './code-facts';
import { secretKey } from '../shared/redact';
export interface Deployment {id:string;name:string;image?:string;roots:string[];environment:Record<string,string>;basis:Evidence[];module?:string;exportName?:string;port?:string;portConfirmed?:boolean}
export interface ConfigValue {key:string;value:string;location:Location;override?:Location}
const normalize=(p:string)=>p.replaceAll('\\','/').replace(/^\.\//,'');
export function configFacts(result:StructureResult,selection?:string){
 const {index,configs}=result,deployments:Deployment[]=[],values:ConfigValue[]=[];
 index.configurations=[{id:'defaults',name:'源码默认设置',kind:'defaults',locations:[]}];
 const loc=(file:string,key:string):Location=>{const lines=(configs.get(file)||'').split('\n'),line=Math.max(0,lines.findIndex(l=>l.includes(key)));return{file,range:{start:{line,character:0},end:{line,character:lines[line]?.length||0}}};};
 const propertyLocation=(file:string,key:string)=>{const parents:{indent:number;key:string}[]=[];for(const [line,text] of (configs.get(file)||'').split('\n').entries()){const m=text.match(/^(\s*)([\w.-]+):/);if(!m)continue;while(parents.length&&parents.at(-1)!.indent>=m[1].length)parents.pop();parents.push({indent:m[1].length,key:m[2]});if(parents.map(p=>p.key).join('.')===key)return{file,range:{start:{line,character:m[1].length},end:{line,character:text.length}}};}return loc(file,key);};
 const parsed=new Map<string,any>();
 for(const [file,text] of configs){if(!/\.ya?ml$/.test(file))continue;try{parsed.set(file,load(text,{schema:JSON_SCHEMA}));}catch{index.diagnostics.push({file,message:'配置无法按静态 YAML 子集读取，未执行或求值。',severity:'warning'});}}
 for(const [file,data] of parsed)if(data?.services&&typeof data.services==='object')index.configurations.push({id:`compose:${file}`,name:`Compose · ${file}（未运行）`,kind:'compose',locations:[loc(file,'services:')]});
 const compose=index.configurations.filter(c=>c.kind==='compose');index.configurationId=index.configurations.some(c=>c.id===selection)?selection:compose.length===1?compose[0].id:'defaults';
 for(const file of configs.keys())if(/(?:^|\/)application-[\w-]+\.ya?ml$/.test(file))index.diagnostics.push({file,message:'发现其他环境的设置；当前只读默认设置和所选部署文件，没有读取其他环境的值。',severity:'warning'});
 const selected=index.configurationId?.startsWith('compose:')?index.configurationId.slice(8):undefined;
 if(selected){const data=parsed.get(selected);
  for(const [name,raw] of Object.entries(data?.services||{}) as [string,any][]){
   const environment:Record<string,string>={};
   for(const [key,val] of Array.isArray(raw.environment)?raw.environment.map((s:string)=>[s.split('=')[0],s.slice(s.indexOf('=')+1)]):Object.entries(raw.environment||{}))if(!secretKey(key)&&['string','number','boolean'].includes(typeof val))environment[key]=String(val);
   const context=typeof raw.build==='string'?raw.build:raw.build?.context||'.',docker=typeof raw.build==='object'?raw.build.dockerfile||'Dockerfile':'Dockerfile';
   const dockerfile=normalize(path.posix.join(path.posix.dirname(selected),context,docker)),dockerText=configs.get(dockerfile)||'';
   const roots=[...dockerText.matchAll(/^COPY\s+(?!.*--from)["']?([\w./-]+)(?:["']?)\s+/gm)].map(m=>normalize(path.posix.join(path.posix.dirname(selected),context,m[1]))).filter(p=>index.files.some(f=>f.path===p||f.path.startsWith(p+'/')));
   const finalStage=dockerText.slice([...dockerText.matchAll(/^FROM\b.*$/gim)].at(-1)?.index||0),instructions=[...finalStage.matchAll(/^\s*(?:CMD|ENTRYPOINT)\s+(.+)$/gim)].map(m=>m[1]).join(' ');
   const command=raw.command!==undefined?(Array.isArray(raw.command)?raw.command.join(' '):String(raw.command)):raw.entrypoint!==undefined?'':instructions;
   const safeCommand=/[$`]/.test(command)?'':command,entry=safeCommand.match(/["'\s]([\w.]+):([\w]+)(?:["'\s]|$)/),module=entry?.[1],port=safeCommand.match(/(?:["']?--port["']?\s*[, ]\s*["']?)(\d+)/)?.[1];
   deployments.push({id:`service:${selected}:${name}`,name,image:typeof raw.image==='string'?raw.image:undefined,roots:[...new Set(roots)],environment,module,exportName:entry?.[2],port:port||dockerText.match(/^EXPOSE\s+(\d+)/mi)?.[1],portConfirmed:!!port,basis:[basis('config',loc(selected,name+':'),`部署声明 ${name}；仅作为所选配置参照`),...(dockerText?[basis('config',loc(dockerfile,module||'COPY'),module?`启动模块 ${module}:${entry?.[2]}；未执行 Docker 指令`:'Docker COPY 与应用构建来源；未执行 Docker 指令')]:[])]});
  }
 }
 function flatten(file:string,obj:any,prefix='',seen=new Set<object>()){
  if(!obj||typeof obj!=='object'||seen.has(obj))return;seen.add(obj);
  for(const [key,val] of Object.entries(obj)){const name=prefix?`${prefix}.${key}`:key;if(secretKey(name))continue;if(val&&typeof val==='object')flatten(file,val,name,seen);else if(['string','number','boolean'].includes(typeof val))values.push({key:name,value:String(val),location:propertyLocation(file,name)});}
 }
 for(const [file,data] of parsed)if(/(?:^|\/)application\.ya?ml$/.test(file))flatten(file,data);
 for(const [file,text] of configs)if(/(?:^|\/)application\.properties$/i.test(file)){
  const lines=text.replace(/\\\r?\n\s*/g,'').split(/\r?\n/);
  for(const line of lines){if(/^\s*[#!]/.test(line))continue;const match=line.match(/^\s*([^\s=:]+)\s*(?:=|:|\s)\s*(.*)$/);if(!match||secretKey(match[1]))continue;
   const decode=(value:string)=>value.replace(/\\u([a-f\d]{4})/gi,(_,hex)=>String.fromCharCode(parseInt(hex,16))).replace(/\\([:=\s\\])/g,'$1');
   values.push({key:decode(match[1]),value:decode(match[2]),location:loc(file,match[1])});
  }
 }
 for(const file of configs.keys())if(/(?:^|\/)application-[\w-]+\.properties$/i.test(file))index.diagnostics.push({file,message:'发现其他环境的设置，当前没有读取。',severity:'info'});
 function resolve(key:string,service?:Deployment):ConfigValue|undefined{
  const config=values.filter(v=>v.key===key&&(!service||service.roots.some(root=>v.location.file.startsWith(root.split('/src')[0]+'/'))));
  if(config.length!==1)return;
  const item=config[0],m=item.value.match(/^\$\{([\w_]+)(?::([^]*))?\}$/);
  if(!m)return item;
  const replacement=service?.environment[m[1]]??m[2];if(replacement===undefined)return;
  const envDefault=replacement.match(/^\$\{[\w_]+:-(.*)\}$/)?.[1]??replacement;
  return {...item,value:envDefault,override:service?.environment[m[1]]!==undefined&&selected?propertyLocation(selected,`services.${service.name}.environment.${m[1]}`):undefined};
 }
 return {deployments,values,resolve,loc,configuration:index.configurationId||'defaults'};
}
