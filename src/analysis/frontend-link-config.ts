import ts from 'typescript';
import path from 'node:path';
import {loadAll,JSON_SCHEMA} from 'js-yaml';
import type {Evidence,Location,ProjectUnit} from '../shared/model';
import type {StructureResult} from './structure';
import type {HttpEndpoint} from '../shared/frontend-links';
import type {FrontendHttpCall} from '../shared/frontend-model';
import policy from '../shared/http-link-policy.json';
import {FrontendContext,field,key,unwrap,visit,returns} from './frontend-context';
import {under,directory} from './unit-discovery';
import {isTestFile} from '../shared/source-roles';

export const at=(file:string,text:string,offset:number):Location=>{const before=text.slice(0,Math.max(0,offset)),line=before.split('\n').length-1,character=offset-(before.lastIndexOf('\n')+1);return{file,range:{start:{line,character},end:{line,character:character+1}}};};
export const proof=(location:Location,note:string,kind:Evidence['kind']='config'):Evidence=>({kind,location,note});
const receiver=(text:string,name:string)=>text.startsWith(name)&&text.slice(name.length).replace(/^(?:\s+|\/\/[^\r\n]*(?:\r?\n|$)|\/\*[\s\S]*?\*\/)*/,'').startsWith('.');
export function unitOwners(result:StructureResult,file:string){
 const units=result.index.units||[],owner=units.filter(u=>u.kind!=='tool'&&under(file,u.root)).sort((a,b)=>b.root.length-a.root.length)[0];
 return owner?[owner,...owner.usedBy.map(id=>units.find(u=>u.id===id)!).filter(Boolean)].filter(u=>u.kind==='application'||u.kind==='frontend'):[];
}
interface Setting {key:string;value:string;location:Location;profile:string}
export interface Server {unit:ProjectUnit;profile:string;port?:number;portDeclared:boolean;context:string;hosts:string[];basis:Evidence[];conditions:string[]}
export interface Proxy {unitId?:string;prefix:string;target:string;profile:string;basis:Evidence[];conditions:string[];rewrite?:{pattern:string;replacement:string};unknownRewrite?:boolean}

export function springSettings(file:string,text:string):Setting[]{
 const result:Setting[]=[],profile=path.posix.basename(file).match(/^application-([\w-]+)\./)?.[1]||'defaults';
 if(file.endsWith('.properties')){for(const m of text.matchAll(/^\s*([^\s#!=:]+)\s*(?:=|:)\s*([^\r\n]*)/gm))if(Object.values(policy.springKeys).includes(m[1]))result.push({key:m[1],value:m[2].trim(),profile,location:at(file,text,m.index!)});return result;}
 const pieces:{text:string;offset:number}[]=[];let start=0;for(const match of text.matchAll(/^---[ \t]*\r?$/gm)){pieces.push({text:text.slice(start,match.index),offset:start});start=match.index!+match[0].length;}pieces.push({text:text.slice(start),offset:start});
 for(const {text:piece,offset}of pieces){try{const docs=loadAll(piece,undefined,{schema:JSON_SCHEMA});for(const doc of docs){const flattened=new Map<string,string>(),seen=new Set<object>();const walk=(obj:any,prefix='')=>{if(!obj||typeof obj!=='object'||Array.isArray(obj)||seen.has(obj))return;seen.add(obj);for(const [k,v]of Object.entries(obj)){const name=prefix?prefix+'.'+k:k;if(v&&typeof v==='object')walk(v,name);else if(['string','number'].includes(typeof v))flattened.set(name,String(v));}};walk(doc);
   const scope=flattened.get(policy.springKeys.profile)||profile,parents:{indent:number;key:string}[]=[];
   for(const match of piece.matchAll(/^(\s*)([\w.-]+):[^\r\n]*/gm)){while(parents.length&&parents.at(-1)!.indent>=match[1].length)parents.pop();parents.push({indent:match[1].length,key:match[2]});const name=parents.map(p=>p.key).join('.');if(Object.values(policy.springKeys).includes(name)&&flattened.has(name))result.push({key:name,value:flattened.get(name)!,profile:scope,location:at(file,text,offset+match.index!)});}
  }}catch{/* The existing configuration diagnostics remain authoritative. */}
 }return result;
}
export function servers(result:StructureResult):Server[]{
 const settings=[...result.configs].filter(([f])=>/(?:^|\/)application(?:-[\w-]+)?\.(?:ya?ml|properties)$/.test(f)&&!isTestFile(f,result.index)).flatMap(([file,text])=>springSettings(file,text));
 return(result.index.units||[]).filter(u=>u.kind==='application').flatMap(unit=>{
  const defaults=policy.serverDefaults.find(row=>row.framework===unit.framework),values=settings.filter(s=>unitOwners(result,s.location.file).some(u=>u.id===unit.id));
  const profiles=[...new Set(['defaults',...values.map(v=>v.profile)])];
  return profiles.map(profile=>{const combined=[...values.filter(v=>v.profile==='defaults'),...profile==='defaults'?[]:values.filter(v=>v.profile===profile)],find=(name:string)=>combined.filter(v=>v.key===name).at(-1);
   const port=find(policy.springKeys.port),context=find(policy.springKeys.context),address=find(policy.springKeys.address),conditions:string[]=[];
   const resolved=(item:Setting|undefined,fallback:string)=>{if(!item)return fallback;return item.value.replace(/\$\{([^}:]+)(?::([^}]*))?\}/g,(_all,key,value)=>{if(value!==undefined){conditions.push(key+' 未设置时使用源码默认值');return value;}return'{'+key+'}';});};
   let portText=resolved(port,String(defaults?.port||'')),portDeclared=!!port;const basis:Evidence[]=[...port?[proof(port.location,policy.springKeys.port+' = '+port.value)]:[],...context?[proof(context.location,policy.springKeys.context+' = '+context.value)]:[]];
   if(unit.language==='python')for(const [file,text]of result.configs)if(/Dockerfile(?:\.[^/]*)?$/.test(file)&&under(file,unit.root)){const command=text.match(/^\s*(?:CMD|ENTRYPOINT)\s+([^\r\n]+)/m);if(command&&/\b(?:uvicorn|fastapi|flask|manage\.py)\b/.test(command[1])){const explicit=command[1].match(/--port["']?\s*[, ]\s*["']?(\d+)/);if(explicit){portText=explicit[1];portDeclared=true;}basis.push(proof(at(file,text,command.index!),explicit?'启动声明中的 HTTP 端口':'框架启动声明与其默认端口'));}}
   if(!basis.length&&unit.basis[0])basis.push(proof(unit.basis[0].location,'框架默认监听设置：'+(defaults?.basis||'未确定')));
   const host=resolved(address,''),deployment=result.index.entities?.find(e=>e.id===unit.serviceId&&e.kind==='service'),hosts=host&&host!=='0.0.0.0'? [host,...policy.loopbackHosts.includes(host)?policy.loopbackHosts:[]]:[...policy.loopbackHosts];if(deployment?.id.startsWith('service:compose:')||deployment?.basis.some(b=>b.location.file.match(/compose.*\.ya?ml$/)))hosts.push(deployment.name);
   return{unit,profile,port:/^\d+$/.test(portText)?Number(portText):undefined,portDeclared,context:resolved(context,defaults?.context||''),hosts,basis,conditions};
  });
 });
}

export const serverAddresses=(result:StructureResult)=>servers(result).filter(s=>s.portDeclared&&s.port&&s.basis.length&&!s.context.includes('{')).map(s=>({unitId:s.unit.id,address:`http://${s.hosts[0].includes(':')?'['+s.hosts[0]+']':s.hosts[0]}:${s.port}${s.context}`,profile:s.profile,location:s.basis[0].location,basis:s.basis}));

export function linkConfig(result:StructureResult){
 const c=new FrontendContext(result.index,result.frontendTexts||new Map(),result.configs),proxies:Proxy[]=[];
 const object=(raw:ts.Node|undefined)=>{const ref=c.ref(raw);return ref?.kind==='node'?ref.node:raw;};
 const scalar=(node:ts.Node|undefined,depth=0):{value:string;profile:string;basis:Evidence[];conditions:string[]}[]=>{
  if(!node)return[];node=unwrap(node);
  if(depth>policy.thresholds.expressionDepth.value)return[{value:'{expression}',profile:'defaults',basis:[proof(c.location(node),'地址表达式没有确定')],conditions:[]}];
  if(ts.isBinaryExpression(node)&&node.operatorToken.kind===ts.SyntaxKind.PlusToken)return scalar(node.left,depth+1).flatMap(left=>scalar((node as ts.BinaryExpression).right,depth+1).filter(right=>left.profile==='defaults'||right.profile==='defaults'||left.profile===right.profile).map(right=>({value:left.value+right.value,profile:left.profile==='defaults'?right.profile:left.profile,basis:[...left.basis,...right.basis],conditions:[...left.conditions,...right.conditions]})));
  if(ts.isBinaryExpression(node)&&[ts.SyntaxKind.BarBarToken,ts.SyntaxKind.QuestionQuestionToken].includes(node.operatorToken.kind)){const left=c.values(node.left).filter(v=>!v.unresolved);if(left.length)return left.map(v=>({value:v.value,profile:v.profile||'defaults',basis:[proof(v.location,'前端地址配置')],conditions:[]}));return scalar(node.right,depth+1).map(v=>({...v,conditions:[...v.conditions,node.left.getText()+' 未设置时']}));}
  return c.values(node).map(v=>({value:v.value,profile:v.profile||'defaults',basis:[proof(v.location,'前端地址配置')],conditions:[]}));
 };
 for(const [file,doc]of c.docs)if(/(?:vite|vue)\.config\.[cm]?[jt]s$/.test(file))visit(doc.sf,node=>{
  if(!(ts.isPropertyAssignment(node)||ts.isShorthandPropertyAssignment(node))||key(node.name)!=='proxy')return;const config=object(ts.isPropertyAssignment(node)?node.initializer:node.name);if(!config||!ts.isObjectLiteralExpression(config))return;
  for(const prop of config.properties){if(!ts.isPropertyAssignment(prop))continue;const value=object(prop.initializer),prefixes=ts.isComputedPropertyName(prop.name)?scalar(prop.name.expression):[{value:key(prop.name)||'',profile:'defaults',basis:[proof(c.location(prop.name),'代理前缀')],conditions:[]}];
   for(const prefix of prefixes)for(const target of scalar(field(value,'target')||value)){
    const rewrite=field(value,'rewrite')||field(value,'pathRewrite');let parsed:Proxy['rewrite'],unknownRewrite=false;
    if(rewrite){const fn=object(rewrite),returned=fn&&(ts.isArrowFunction(fn)||ts.isFunctionExpression(fn))?returns(fn):[],part=returned.length===1?unwrap(returned[0]):undefined;
      if(part&&fn&&(ts.isArrowFunction(fn)||ts.isFunctionExpression(fn))&&ts.isCallExpression(part)&&ts.isPropertyAccessExpression(part.expression)&&ts.isIdentifier(part.expression.expression)&&key(fn.parameters[0]?.name)===part.expression.expression.text&&part.expression.name.text==='replace'&&part.arguments.length===2&&ts.isRegularExpressionLiteral(part.arguments[0])&&ts.isStringLiteralLike(part.arguments[1])){const raw=part.arguments[0].text,pattern=raw.slice(1,raw.lastIndexOf('/')).replace(/\\\//g,'/'),flags=raw.slice(raw.lastIndexOf('/')+1);if(/^\^[\w/.-]+$/.test(pattern)&&!flags&&!part.arguments[1].text.includes('$'))parsed={pattern,replacement:part.arguments[1].text};}
      if(!parsed&&ts.isObjectLiteralExpression(rewrite)&&rewrite.properties.length===1){
      const item=rewrite.properties[0];if(item&&ts.isPropertyAssignment(item)){const name=ts.isComputedPropertyName(item.name)?item.name.expression:item.name,pattern=scalar(name).find(s=>s.profile===prefix.profile)||scalar(name)[0],replacement=c.value(item.initializer);if(pattern&&!replacement.unknown)parsed={pattern:pattern.value,replacement:replacement.text};}
    }if(!parsed)unknownRewrite=true;}
    proxies.push({unitId:c.unit(file)?.id,prefix:prefix.value,target:target.value,profile:prefix.profile!=='defaults'?prefix.profile:target.profile,basis:[...prefix.basis,...target.basis,proof(c.location(prop),'开发代理；不是已运行环境')],conditions:[...prefix.conditions,...target.conditions],rewrite:parsed,unknownRewrite});
   }
  }
 });
 for(const proxy of result.index.frontend?.proxies||[])if(proxy.prefix==='/'&&!proxies.some(p=>p.unitId===proxy.unitId&&p.prefix===proxy.prefix))proxies.push({unitId:proxy.unitId,prefix:proxy.prefix,target:proxy.target.value,profile:proxy.target.profile||'defaults',basis:[proof(proxy.location,'前端代理')],conditions:[]});
 const addressBasis=(call:FrontendHttpCall)=>{
  const doc=c.docs.get(call.location.file),basis:Evidence[]=[],seen=new Set<ts.Node>();if(!doc)return basis;
  const collect=(node:ts.Node,depth=0)=>{if(seen.has(node)||depth>policy.thresholds.expressionDepth.value)return;seen.add(node);
   if(/^(?:import\.meta\.env|process\.env)\.[A-Za-z_\d]+$/.test(node.getText())){for(const value of c.values(node))if(!value.unresolved)basis.push(proof(value.location,'前端地址来自这个设置'));return;}
   if(ts.isIdentifier(node)){const ref=c.ref(node);if(ref?.kind==='node'&&ref.node!==node&&!ts.isFunctionLike(ref.node))collect(ref.node,depth+1);}
   node.forEachChild(child=>collect(child,depth+1));
  };
  const after=(a:{line:number;character:number},b:{line:number;character:number})=>a.line>b.line||a.line===b.line&&a.character>=b.character;
  visit(doc.sf,node=>{if(node.getText()!==call.expression)return;const span=c.location(node).range;if(after(span.start,call.location.range.start)&&after(call.location.range.end,span.end))collect(node);});
  return [...new Map(basis.map(b=>[JSON.stringify(b),b])).values()];
 };
 return{proxies,addressBasis};
}

export function endpoints(result:StructureResult,allServers:Server[]):HttpEndpoint[]{
 const index=result.index,found:HttpEndpoint[]=[];
 for(const entry of index.entries||[]){if(entry.kind!=='http'||isTestFile(entry.location.file,index))continue;const route=entry.pathEvidence||(()=>{const [method,path]=entry.name.split(' · ')[0].split(' ');return{method,path};})();
  const variants=[{path:route.path,basis:entry.pathEvidence?.basis||[],issues:entry.pathEvidence?.issues||[]},...entry.pathEvidence?.aliases||[]];
  for(const owner of unitOwners(result,entry.location.file).filter(u=>u.kind==='application'))for(const config of allServers.filter(s=>s.unit.id===owner.id))for(const[alias,variant]of variants.entries()){const symbol=index.symbols.find(s=>s.id===entry.symbolId),definition=symbol?{file:symbol.file,range:symbol.selection}:entry.location,branches=entry.pathEvidence?.conditions||[];found.push({id:`frontend:endpoint:${entry.id}:${owner.id}:${config.profile}`+(alias?`:alias:${alias}`:''),entryId:entry.id,symbolId:entry.symbolId,unitId:owner.id,method:route.method,path:('/'+config.context+'/'+variant.path).replace(/\/+/g,'/'),profile:config.profile,port:config.port,hosts:config.hosts,location:definition,basis:[proof(entry.location,entry.basis,'declaration'),proof(definition,'接口定义','definition'),...variant.basis,...branches.map(location=>proof(location,'入口只在这段代码启用时提供','declaration')),...config.basis],conditions:[...config.conditions,...branches.map(location=>'取决于 '+location.file+':'+(location.range.start.line+1)+' 的启用分支')],kind:'route',addressKnown:!variant.issues.length});}
 }
 for(const [file,program]of result.facts)for(const rule of policy.frameworkEndpoints){if(!program.imports.some(i=>i.target===rule.import))continue;
  for(const call of program.calls.filter(c=>c.callee.endsWith('.'+rule.method)&&c.args[0]?.value.literal&&program.calls.some(outer=>outer.scope===c.scope&&outer.callee.endsWith('.logout')&&outer.text.includes(c.text)&&program.definitions.some(d=>d.id===outer.scope&&/@(?:[\w.]+\.)?Bean\b/.test(d.annotations)&&d.returnType==='SecurityFilterChain'&&d.params.some(p=>program.imports.some(i=>i.target===rule.import&&i.name===p.type)&&receiver(outer.text,p.name))))&&!program.calls.some(other=>other.scope===c.scope&&other.callee.endsWith('.logoutRequestMatcher'))))for(const owner of unitOwners(result,file).filter(u=>u.kind==='application'))for(const config of allServers.filter(s=>s.unit.id===owner.id)){
   const path=call.args[0].value.literal!;found.push({id:`frontend:framework:${file}:${call.location.range.start.line}:${config.profile}`,unitId:owner.id,method:rule.verb,path:('/'+config.context+'/'+path).replace(/\/+/g,'/'),profile:config.profile,port:config.port,hosts:config.hosts,location:call.location,basis:[proof(call.location,'框架声明的 HTTP 入口','declaration'),proof(program.imports.find(i=>i.target===rule.import)!.location,rule.basis,'declaration'),...config.basis],conditions:[...config.conditions,'按框架默认 HTTP 方法；未运行'],kind:'framework'});
  }
 }
 return found;
}

export function templateOrigins(result:StructureResult){
 const found=new Map<string,{unitId:string;basis:Evidence[]}[]>();
 for(const row of policy.templates)for(const [file,facts]of result.facts){const constructor=facts.imports.find(i=>i.target===row.constructor);if(!constructor)continue;
  for(const create of facts.calls.filter(c=>c.callee===constructor.name)){const folderArg=create.args.find(a=>a.name==='template_folder')?.value;if(folderArg&&!folderArg.literal)continue;const folder=path.posix.join(directory(file),folderArg?.literal||row.defaultFolder);
   for(const unit of unitOwners(result,file).filter(u=>u.kind==='application')){
    const rendered=new Set<string>(),basis:Evidence[]=[proof(create.location,'HTML 由这个应用提供','declaration')];
    for(const [source,program]of result.facts)if(unitOwners(result,source).some(u=>u.id===unit.id))for(const call of program.calls)if(program.imports.some(i=>i.target===row.renderer&&i.name===call.callee)&&call.args[0]?.value.literal){rendered.add(path.posix.join(folder,call.args[0].value.literal));basis.push(proof(call.location,'应用返回这个页面','call'));}
    const pending=[...rendered];while(pending.length){const template=pending.shift()!,text=result.frontendTexts?.get(template)||'';for(const match of text.matchAll(/\{%\s*(?:extends|include)\s+['"]([^'"]+)['"]/g)){const dependency=path.posix.join(folder,match[1]);if(!rendered.has(dependency)){rendered.add(dependency);pending.push(dependency);}}}
    for(const template of rendered)found.set(template,[...(found.get(template)||[]),{unitId:unit.id,basis}]);
   }
  }
 }
 return found;
}
