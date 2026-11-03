import type {ProjectIndex} from './model';
import type {FrontendLink,FrontendLinks,FrontendTarget,HttpEndpoint} from './frontend-links';
import policy from './http-link-policy.json';
export const httpPath=(path:string)=>path.split(/[?#]/)[0].replace(/%7B/gi,'{').replace(/%7D/gi,'}').replace(/\$?\{[^}]+\}/g,'{param}').replace(/:([A-Za-z_]\w*)(?:\([^)]*\))?/g,'{param}');
export const sameRoute=(method:string,path:string,endpoint:HttpEndpoint)=>endpoint.addressKnown!==false&&['ANY','*',method].includes(endpoint.method)&&httpPath(path)===httpPath(endpoint.path);
export const sameHost=(a:string,b:string)=>a===b||policy.loopbackHosts.includes(a)&&policy.loopbackHosts.includes(b);
const endpointKey=(e:HttpEndpoint)=>(e.entryId||e.location.file+':'+e.location.range.start.line+':'+e.method)+':'+e.unitId;
export function summarizeFrontend(calls:FrontendLink[]):FrontendLinks['units']{
 const units:FrontendLinks['units']=[];
 for(const call of calls){if(!call.fromUnitId)continue;
  const ids=call.userTarget?.backendUnitId?[call.userTarget.backendUnitId]:['matched','ambiguous','path-only'].includes(call.outcome)?call.targets.map(t=>t.unitId):call.configuredUnitIds;
  for(const to of new Set(ids)){let row=units.find(u=>u.from===call.fromUnitId&&u.to===to);if(!row){row={id:`frontend:unit-link:${call.fromUnitId}:${to}`,from:call.fromUnitId,to,kind:call.fromUnitId===to?'embedded':'cross-unit',matched:[],unmatched:[],ambiguous:[],pathOnly:[],lineStyle:'dashed',basis:[]};units.push(row);}
   if(call.outcome==='matched')row.matched.push(call.callId);else if(call.outcome==='ambiguous')row.ambiguous.push(call.callId);else{row.unmatched.push(call.callId);if(call.outcome==='path-only')row.pathOnly!.push(call.callId);}
   row.userSpecified||=!!call.userTarget;row.basis.push(...call.basis);row.lineStyle=row.matched.length||row.userSpecified?'solid':'dashed';
  }
 }
 for(const row of units)row.basis=[...new Map(row.basis.map(b=>[JSON.stringify(b),b])).values()];return units;
}
/** User choices affect the viewing projection only; they never rewrite analysis or source files. */
export function withFrontendTargets(index:ProjectIndex,choices?:Record<string,FrontendTarget>):ProjectIndex{
 const links=index.frontendLinks;if(!links||!choices||!Object.keys(choices).length)return index;
 const calls=links.calls.map(row=>{
  const choice=row.fromUnitId&&choices[row.fromUnitId];if(!choice||row.addresses.length&&row.addresses.every(a=>a.known))return row;
  if(choice.backendUnitId&&!index.units?.some(u=>u.id===choice.backendUnitId&&u.kind==='application'))return row;
  const next:FrontendLink={...row,userTarget:{...choice},targets:[],external:undefined,configuredUnitIds:[],configurationTargets:[]};
  if(choice.address){let base:URL;try{base=new URL(choice.address);if(!['http:','https:'].includes(base.protocol)||base.username||base.password)return row;}catch{return row;}
   const original=index.frontend?.httpCalls.find(c=>c.id===row.callId),path=(original?.url||'').replace(/^\{[^}]+\}/,''),url=base.href.replace(/\/+$/,'')+'/'+path.replace(/^\/+/,''),parsed=new URL(url),port=Number(parsed.port||(parsed.protocol==='https:'?443:80));
   next.addresses=[{id:row.id+':user',url,path:parsed.pathname+parsed.search,host:parsed.hostname,port,profile:'用户指定',known:true,basis:[],conditions:['用户指定的地址，不是源码中的配置']}];
   const endpoints=links.endpoints.filter(e=>(!choice.backendUnitId||e.unitId===choice.backendUnitId)&&e.port===port&&e.hosts.some(h=>sameHost(parsed.hostname,h)));
   next.configuredUnitIds=[...new Set(endpoints.map(e=>e.unitId))];next.targets=[...new Map(endpoints.filter(e=>sameRoute(row.method,parsed.pathname,e)).map(e=>[endpointKey(e),e])).values()];
   if(!next.configuredUnitIds.length)next.external={host:parsed.hostname,port,origin:parsed.origin,location:row.source};
  }else if(choice.backendUnitId){next.targets=row.pathCandidates.filter(t=>t.unitId===choice.backendUnitId);next.configuredUnitIds=[choice.backendUnitId];}
  else return row;
  next.outcome=next.targets.length===1?'matched':next.targets.length>1?'ambiguous':'unmatched';next.reason=next.targets.length===1?'unique':next.targets.length>1?'multiple':next.external?'external-backend':'missing-endpoint';return next;
 });
 return{...index,frontendLinks:{...links,calls,units:summarizeFrontend(calls)}};
}
