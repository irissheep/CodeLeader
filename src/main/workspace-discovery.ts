import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import policy from '../../resources/workspace-discovery-policy.json';
import type {WorkspaceProject,WorkspaceScan} from '../shared/workspace';

const norm=(value:string)=>value.replaceAll('\\','/').replace(/^\.\//,'');
const inside=(file:string,root:string)=>!root||file===root||file.startsWith(root+'/');
const markerRules=policy.markers.map(rule=>({...rule,regex:new RegExp(rule.pattern,'i')}));
const ignored=new Map(policy.ignoredDirectories.map(rule=>[rule.name.toLowerCase(),rule]));
const source=/\.(?:java|py|tsx?|jsx?|mjs|cjs|vue|html)$/i;
function sourceFeature(file:string,text:string){
 const extension=path.extname(file).toLowerCase();let clean=text,pattern:RegExp;
 if(extension==='.py'){clean=clean.replace(/(?:[rRuUbBfF]{0,2})(?:"""[\s\S]*?"""|'''[\s\S]*?''')/g,value=>value.replace(/[^\n]/g,' ')).replace(/#[^\n]*/g,value=>' '.repeat(value.length));pattern=/^\s*(?:from\s+(?:flask|fastapi|django)(?:\.[\w]+)*\s+import\b|import\s+(?:flask|fastapi|django)(?:\b|\.))/m;}
 else if(extension==='.java'){clean=clean.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g,value=>value.replace(/[^\n]/g,' '));pattern=/@(?:[\w.]+\.)?(?:SpringBootApplication|RestController|Controller)\b/;}
 else{clean=clean.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,value=>value.replace(/[^\n]/g,' '));pattern=/(?:from\s*|import\s*\(|require\s*\()\s*["'](?:vue|react|react-dom)(?:["'/])/;}
 const match=pattern.exec(clean);return match?{offset:match.index,line:clean.slice(0,match.index).split('\n').length}:undefined;
}
const projectName=(file:string,text:string,root:string)=>{
 try{if(/package\.json$/i.test(file)){const value=JSON.parse(text);return typeof value.name==='string'&&value.name.trim()?value.name.trim():path.basename(root);}}catch{}
 if(/pom\.xml$/i.test(file)){const own=text.replace(/<parent\b[^>]*>[\s\S]*?<\/parent>/,'');const value=own.match(/<artifactId>\s*([^<]+)\s*<\/artifactId>/)?.[1]?.trim();if(value)return value;}
 if(/pyproject\.toml$/i.test(file)){const value=text.match(/^\s*name\s*=\s*["']([^"']+)["']/m)?.[1];if(value)return value;}
 return path.basename(root);
};
const classify=(file:string,text:string,fallback:string)=>/spring-boot|org\.springframework\.boot/i.test(text)?'Spring Boot':/\b(?:fastapi|FastAPI)\b/.test(text)?'FastAPI':/\b(?:flask|Flask)\b/.test(text)?'Flask':/\b(?:django|Django)\b/.test(text)?'Django':/["']vue["']\s*:|from\s*["']vue["']/.test(text)?'Vue':/["']react["']\s*:|from\s*["']react["']/.test(text)?'React':fallback;

export async function discoverWorkspace(input:string,requestId:number,signal:AbortSignal,emit:(scan:WorkspaceScan)=>void,overrides?:Partial<{files:number;directories:number;milliseconds:number}>):Promise<WorkspaceScan>{
 const started=Date.now(),selected=await fs.realpath(input),stat=await fs.stat(selected),root=stat.isFile()?path.dirname(selected):selected;if(!stat.isFile()&&!stat.isDirectory())throw Error('请选择目录或源码文件');
 const records:{file:string;hash:string;source:boolean}[]=[],visitedFiles:string[]=[],sharedConfigs:string[]=[],unhashed:string[]=[],markers=new Map<string,WorkspaceProject>(),features:{file:string;line:number;type:string}[]=[];
 const skips=new Map<string,{rule:string;reason:string;count:number}>(policy.ignoredDirectories.map(item=>[item.name,{rule:item.name,reason:item.reason,count:0}])),errors:WorkspaceScan['errors']=[];let directories=0,files=0,sourceFiles=0,limit:string|undefined;
 for(const [rule,reason] of [['symbolic-link','未进入符号链接或目录联接'],['pyvenv.cfg','Python 虚拟环境'],['large-file','文件超过单文件读取上限']])skips.set(rule,{rule,reason,count:0});
 const limits={files:overrides?.files??policy.limits.files.value,directories:overrides?.directories??policy.limits.directories.value,milliseconds:overrides?.milliseconds??policy.limits.milliseconds.value};
 const skip=(rule:string,reason:string)=>{const item=skips.get(rule)||{rule,reason,count:0};item.count++;skips.set(rule,item);};
 const snapshot=(state:WorkspaceScan['state'],projects=[...markers.values()]):WorkspaceScan=>({requestId,root,state,directories,files,sourceFiles,skipped:[...skips.values()],projects:projects.map(p=>({...p,files:state==='scanning'?visitedFiles.filter(file=>inside(file,p.root)).length:p.files,evidence:[...p.evidence]})),sharedConfigs:[...sharedConfigs],limit,errors:[...errors],elapsedMs:Date.now()-started});
 const exhausted=()=>{if(signal.aborted)return true;if(files>=limits.files){limit=`已达到 ${limits.files} 个文件的上限`;return true;}if(directories>=limits.directories){limit=`已达到 ${limits.directories} 个目录的上限`;return true;}if(Date.now()-started>=limits.milliseconds){limit='已达到扫描时间上限';return true;}return false;};
 async function walk(folder:string):Promise<void>{
  if(exhausted())return;directories++;let entries;try{entries=await fs.readdir(folder,{withFileTypes:true});}catch(error){errors.push({path:norm(path.relative(root,folder)),reason:String(error)});return;}
  entries.sort((a,b)=>a.name.localeCompare(b.name));
  for(const entry of entries){if(exhausted())break;const absolute=path.join(folder,entry.name),file=norm(path.relative(root,absolute));
   if(entry.isSymbolicLink()){skip('symbolic-link','未进入符号链接或目录联接');continue;}
   if(entry.isDirectory()){
    const rule=ignored.get(entry.name.toLowerCase());if(rule){skip(rule.name,rule.reason);continue;}
    try{if((await fs.stat(path.join(absolute,'pyvenv.cfg'))).isFile()){skip('pyvenv.cfg','Python 虚拟环境');continue;}}catch{}
    await walk(absolute);continue;
   }
   if(!entry.isFile())continue;files++;visitedFiles.push(file);if(/^(?:docker-)?compose[^/]*\.ya?ml$/i.test(entry.name)||!file.includes('/')&&/^\.env[^/]*$/.test(entry.name))sharedConfigs.push(file);const marker=markerRules.find(rule=>rule.regex.test(entry.name)),isSource=source.test(entry.name);if(isSource)sourceFiles++;
   if(!marker&&!isSource)continue;
   try{const stat=await fs.stat(absolute);if(stat.size>policy.limits.sourceBytes.value){if(isSource)unhashed.push(file);skip('large-file','文件超过单文件读取上限');continue;}const bytes=await fs.readFile(absolute),text=bytes.toString('utf8'),hash=crypto.createHash('sha256').update(bytes).digest('hex');records.push({file,hash,source:isSource});
    if(marker){const relative=norm(path.relative(root,folder)),existing=markers.get(relative),type=classify(entry.name,text,marker.type),project:WorkspaceProject=existing||{id:relative||'.',root:relative,name:projectName(entry.name,text,folder),type,files:0,evidence:[],selected:true};if(project.type===marker.type)project.type=type;project.evidence.push({file,line:1,description:`${marker.type} 声明`});if(type!==marker.type){const token=type==='Spring Boot'?'spring-boot':type.toLowerCase(),offset=text.toLowerCase().indexOf(token);if(offset>=0)project.evidence.push({file,line:text.slice(0,offset).split('\n').length,description:`${type} 来源`});}markers.set(relative,project);emit(snapshot('scanning'));}
    else if(isSource){const match=sourceFeature(entry.name,text);if(match)features.push({file,line:match.line,type:classify(entry.name,text,entry.name.endsWith('.py')?'Python':entry.name.endsWith('.java')?'Java':'JavaScript')});}
   }catch(error){if(isSource)unhashed.push(file);errors.push({path:file,reason:String(error)});}
  }
  if(directories%64===0)emit(snapshot('scanning'));
 }
 await walk(root);
 // Source evidence outside marked projects is grouped by the selected root's immediate subtree.
 for(const item of features){if([...markers.keys()].some(key=>inside(item.file,key)))continue;const parts=item.file.split('/'),first=parts.length>1?parts[0]:'',group=first&&[...markers.keys()].some(key=>key.startsWith(first+'/'))?norm(path.posix.dirname(item.file)).replace(/^\.$/,''):first;if(!markers.has(group))markers.set(group,{id:group||'.',root:group,name:path.basename(path.join(root,group)),type:item.type,files:0,evidence:[{file:item.file,line:item.line,description:'源码中的框架引用或入口声明'}],selected:true});}
 const candidates=[...markers.values()].sort((a,b)=>a.root.split('/').length-b.root.split('/').length||a.root.localeCompare(b.root)),projects:WorkspaceProject[]=[];
 for(const project of candidates){const parent=projects.find(other=>inside(project.root,other.root));if(parent){parent.evidence.push(...project.evidence);continue;}projects.push(project);}
 const signatures=new Map<string,string>(),hashes=new Map(records.map(record=>[record.file,record.hash]));for(const project of projects){const scoped=visitedFiles.filter(file=>inside(file,project.root));project.files=scoped.length;let complete=!limit&&!unhashed.some(file=>inside(file,project.root));
  for(const file of scoped){if(!complete||hashes.has(file))continue;if(exhausted()||/^\.env(?:\.|$)/i.test(path.posix.basename(file))){complete=false;continue;}try{const stat=await fs.stat(path.join(root,file));if(stat.size>policy.limits.sourceBytes.value){complete=false;continue;}hashes.set(file,crypto.createHash('sha256').update(await fs.readFile(path.join(root,file))).digest('hex'));}catch{complete=false;}}
  if(complete&&scoped.length>=2&&scoped.some(file=>source.test(file))){const entries=scoped.map(file=>`${project.root?file.slice(project.root.length+1):file}:${hashes.get(file)}`).sort(),signature=crypto.createHash('sha256').update(entries.join('\n')).digest('hex'),original=signatures.get(signature);if(original){project.duplicateOf=original;project.selected=false;}else signatures.set(signature,project.id);}}
 const state=signal.aborted?'cancelled':projects.length?'found':errors.length&&!files?'error':'empty',result=snapshot(state,projects);emit(result);return result;
}
