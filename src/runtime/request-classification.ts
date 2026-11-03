import type {BrowserRequest} from '../shared/execution';
import type {ProjectIndex} from '../shared/model';
import policy from '../shared/runtime-policy.json';
export function classifyRequest(request:BrowserRequest,index:ProjectIndex,previous:BrowserRequest[],polling=true):BrowserRequest['other']{
 const url=new URL(request.url),deps=new Set(index.buildDeclarations?.flatMap(b=>b.dependencies)||[]),has=(name:string)=>deps.has(name)||[...deps].some(dep=>dep.startsWith(name+':'));
 if(request.method==='OPTIONS')return {kind:'preflight',reason:'浏览器检查是否可以访问'};
 if(policy.assetTypes.includes(request.resourceType||''))return {kind:'asset',reason:'页面文件'};
 if(policy.hotReload.some(row=>has(row.dependency)&&row.prefixes.some(prefix=>url.pathname.startsWith(prefix))))return {kind:'development',reason:'页面更新通知'};
 if(policy.frameworkRequests.some(row=>has(row.dependency)&&(url.pathname===row.prefix||url.pathname.startsWith(row.prefix+'/'))))return {kind:'framework',reason:'框架自带的请求'};
 if(polling&&!request.operationId&&request.method==='GET'&&previous.filter(r=>r.id!==request.id&&!r.operationId&&r.method===request.method&&r.url===request.url&&request.start-r.start>=0&&request.start-r.start<=policy.thresholds.pollWindowMs.value).length>=policy.thresholds.pollRepeats.value-1)return {kind:'polling',reason:'页面反复自动刷新'};
 return undefined;
}
