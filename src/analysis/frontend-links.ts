import type {FrontendAddress,FrontendLink,FrontendLinks,HttpEndpoint} from '../shared/frontend-links';
import type {StructureResult} from './structure';
import {endpoints,linkConfig,proof,servers,serverAddresses,templateOrigins,unitOwners} from './frontend-link-config';
import policy from '../shared/http-link-policy.json';
import {httpPath,sameRoute,summarizeFrontend} from '../shared/frontend-targets';

export {httpPath};
const combine=(base:string,path:string)=>/^https?:\/\//i.test(path)?path:base?base.replace(/\/+$/,'')+'/'+path.replace(/^\/+/, ''):path;
const targetKey=(e:HttpEndpoint)=>(e.entryId||e.location.file+':'+e.location.range.start.line+':'+e.method)+':'+e.unitId;
const local=(host:string)=>policy.loopbackHosts.includes(host.replace(/^\[|\]$/g,''));

/** Separate derived facts: no backend entries, unit counts, runtime records or graph layouts are changed. */
export function frontendLinks(result:StructureResult){
 const index=result.index,server=servers(result),backend=endpoints(result,server),{proxies,addressBasis}=linkConfig(result),templates=templateOrigins(result),output:FrontendLinks={version:policy.version,endpoints:backend,calls:[],units:[]};
 output.servers=serverAddresses(result);
 for(const call of index.frontend?.httpCalls||[]){if(call.test)continue;
  const module=index.frontend!.modules.find(m=>m.id===call.moduleId),fromUnitId=module?.unitId||unitOwners(result,call.location.file)[0]?.id,origin=templates.get(call.location.file)||[];
  const addresses:FrontendAddress[]=[];
  const bases=call.baseURLs.length?call.baseURLs:[{value:'',location:call.location}];
  let url=call.url;let templateTarget:HttpEndpoint|undefined;
  if(url.includes('{template}')){
   const raw=result.frontendTexts?.get(call.location.file)||'',lines=raw.split('\n'),fragment=lines.slice(call.location.range.start.line,call.location.range.end.line+1).join('\n'),endpoint=fragment.match(/\{\{\s*url_for\(\s*['"]([^'"]+)['"]/)?.[1];
   if(endpoint){const [group,name]=endpoint.includes('.')?endpoint.split('.'):[undefined,endpoint];const matches=backend.filter(e=>{const entry=index.entries?.find(item=>item.id===e.entryId),symbol=index.symbols.find(s=>s.id===e.symbolId);return symbol?.name===name&&(!group||entry?.moduleName===group||entry?.moduleParent?.name===group||entry?.owner===group)&&origin.some(o=>o.unitId===e.unitId);});const definitions=[...new Map(matches.map(e=>[e.entryId,e])).values()];if(definitions.length===1){templateTarget=definitions[0];url=url.replace('{template}',templateTarget.path);}}
  }
  const add=(raw:string,profile:string,basis:FrontendAddress['basis'],conditions:string[],originUnitId?:string,reason?:string,pathKnown=true)=>{
   let host:string|undefined,port:number|undefined,path=raw,known=!reason;
   if(/^https?:\/\//i.test(raw)){try{const value=new URL(raw);host=value.hostname;port=Number(value.port||(value.protocol==='https:'?443:80));path=value.pathname+value.search;if(/[{}]/.test(host))known=false;}catch{known=false;}}
   else if(!originUnitId)known=false;
   // A parameter within a path segment is preserved; a dynamic origin/prefix is not an address.
   if(!path.startsWith('/')||/^\/?\{[^}]+\}/.test(path)||/^\{[^}]+\}$/.test(call.url))known=false;
   addresses.push({id:`${call.id}:address:${addresses.length}`,url:raw,path,host,port,profile,known,pathKnown:pathKnown&&!/^\{[^}]+\}$/.test(call.url),sourceUnitId:fromUnitId,originUnitId,basis,conditions,...!known?{reason:reason||'地址未确定'}:{}});
  };
  const urlBasis=addressBasis(call);
  const variants=templateTarget?[{value:url,location:call.location}]:call.urlValues?.length?call.urlValues:[{value:url,location:call.location}];
  for(const variant of variants)for(const base of bases){if(variant.profile&&base.profile&&variant.profile!==base.profile)continue;const full=combine(base.value,variant.value),profile=variant.profile||base.profile||'defaults',basis=[...call.basis,...urlBasis,proof(base.location,'前端地址：'+base.value),proof(variant.location,'请求地址来自这里')],unknownOrigin=/^[^/]*\{[^}]+\}[^/]*\//.test(full)||/^\{[^}]+\}/.test(full);
   if(/^https?:\/\//i.test(full)){add(full,profile,basis,[...call.conditions,...base.conditions||[],...variant.conditions||[]],undefined,base.unresolved?'地址来自未提供的配置':undefined);continue;}
   const proxyOptions=proxies.filter(p=>(!p.unitId||p.unitId===fromUnitId)&&(p.profile==='defaults'||profile==='defaults'||p.profile===profile)&&(full===p.prefix||full.startsWith(p.prefix.endsWith('/')?p.prefix:p.prefix+'/'))).sort((a,b)=>b.prefix.length-a.prefix.length);
   if(proxyOptions.length){const longest=proxyOptions[0].prefix.length;for(const proxy of proxyOptions.filter(p=>p.prefix.length===longest)){
     let path=full;if(proxy.rewrite){if(proxy.rewrite.pattern.startsWith('^')&&/^[\w/.-]+$/.test(proxy.rewrite.pattern.slice(1))&&path.startsWith(proxy.rewrite.pattern.slice(1)))path=proxy.rewrite.replacement+path.slice(proxy.rewrite.pattern.length-1);else if(!proxy.rewrite.pattern.startsWith('^')){add(full,profile,[...basis,...proxy.basis],proxy.conditions,undefined,'代理地址改写没读出来',false);continue;}}
     add(combine(proxy.target,path),profile==='defaults'?proxy.profile:profile,[...basis,...proxy.basis],[...call.conditions,...proxy.conditions],undefined,proxy.unknownRewrite?'代理地址改写没读出来':undefined,!proxy.unknownRewrite);
    }continue;
   }
   if(origin.length){for(const source of origin)add(full,profile,[...basis,...source.basis],call.conditions,source.unitId,unknownOrigin?'地址未确定':undefined);}
   else add(full,profile,basis,call.conditions,undefined,'地址未确定');
  }
  const unique=[...new Map(addresses.map(a=>[JSON.stringify([a.url,a.profile,a.originUnitId,a.known]),a])).values()],possible=backend.filter(e=>unique.some(a=>a.known&&(a.originUnitId===e.unitId||a.port!==undefined&&a.port===e.port&&!!a.host&&(e.hosts.includes(a.host)||local(a.host)&&e.hosts.some(local))))),matching=possible.filter(e=>unique.some(a=>a.known&&(a.originUnitId===e.unitId||a.port===e.port&&!!a.host&&(e.hosts.includes(a.host)||local(a.host)&&e.hosts.some(local)))&&sameRoute(call.method,a.path,e))),targets=[...new Map(matching.map(e=>[targetKey(e),e])).values()];
  const compatibleServers=server.filter(s=>unique.some(a=>a.known&&(a.originUnitId===s.unit.id||a.port===s.port&&!!a.host&&(s.hosts.includes(a.host)||local(a.host)&&s.hosts.some(local))))),configuredUnitIds=[...new Set(compatibleServers.map(s=>s.unit.id))],noBackend=!server.length,known=unique.some(a=>a.known),unresolved=unique.some(a=>!a.known),outside=noBackend||known&&!configuredUnitIds.length&&server.every(s=>s.port!==undefined);
  const outcome=targets.length>1?'ambiguous':targets.length===1&&!unresolved?'matched':targets.length===1?'ambiguous':configuredUnitIds.length?'configured':'unmatched';
  const reason:FrontendLink['reason']=outcome==='matched'?'unique':outcome==='ambiguous'?'multiple':outcome==='configured'?'configuration-only':outside?'external-backend':!known||server.some(s=>s.port===undefined)?'unknown-address':'path-mismatch';
  const externalAddress=outside&&unique.find(a=>a.host&&a.port),link:FrontendLink={id:'frontend:link:'+call.id,callId:call.id,method:call.method,source:call.methodLocation,fromUnitId,outcome,reason,addresses:unique,targets,pathCandidates:targets.length?[]:[...new Map(backend.filter(e=>unique.some(a=>sameRoute(call.method,a.path.replace(/^\{[^}]+\}/,''),e))).map(e=>[targetKey(e),e])).values()],configuredUnitIds,configurationTargets:compatibleServers.flatMap(s=>s.basis[0]?[{unitId:s.unit.id,profile:s.profile,location:s.basis[0].location,basis:s.basis}]:[]),basis:[...unique.flatMap(a=>a.basis),...targets.flatMap(t=>t.basis),...compatibleServers.flatMap(s=>s.basis)],...externalAddress?{external:{host:externalAddress.host!,port:externalAddress.port!,origin:`${externalAddress.url.match(/^https?:\/\//)?.[0]||'http://'}${externalAddress.host}:${externalAddress.port}`,location:call.baseURLs[0]?.location||call.methodLocation}}:{}};
  // Missing runtime values never become a unique result merely because a suffix resembles a route.
  const completeRoutes=backend.length>0&&!backend.some(e=>e.addressKnown===false);
  if(link.reason==='unknown-address'&&unique.every(a=>a.pathKnown!==false)){
   if(link.pathCandidates.length===1){link.outcome='path-only';link.reason='path-only';link.targets=link.pathCandidates;}
   else if(link.pathCandidates.length>1)link.reason='multiple-paths';
   else if(completeRoutes&&server.length&&unique.some(a=>a.path.replace(/^\{[^}]+\}/,'').startsWith('/')))link.reason='missing-endpoint';
  }else if(link.outcome==='configured'&&completeRoutes&&call.method!=='UNKNOWN'&&unique.every(a=>a.known&&!/^\{/.test(a.path))){link.outcome='unmatched';link.reason='missing-endpoint';}
  output.calls.push(link);
 }
 output.units=summarizeFrontend(output.calls);
 index.frontendLinks=output;index.versions.frontendLinks=policy.version;return output;
}
