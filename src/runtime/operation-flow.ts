import type { BrowserRequest, ExecutionSession } from '../shared/execution';
import {buildReplay} from './replay';

const identity=(request:BrowserRequest)=>request.method+' '+new URL(request.url).pathname;
export function pollingRequest(request:BrowserRequest,all:BrowserRequest[]){
  const previous=all.filter(r=>identity(r)===identity(request)&&r.start<=request.start).sort((a,b)=>a.start-b.start);
  if(previous.length<3||request.method!=='GET')return false;
  const gaps=previous.slice(-4).slice(1).map((r,i)=>r.start-previous.slice(-4)[i].start),mean=gaps.reduce((a,b)=>a+b,0)/gaps.length;
  return mean>=500&&gaps.every(g=>Math.abs(g-mean)<mean*.2);
}
export function operationRequests(session:ExecutionSession,operationId:string){return session.requests.filter(r=>r.operationId===operationId&&!r.background);}
export function numberedOperations(session:ExecutionSession){
 const ids=new Set(session.requests.filter(request=>!request.background).map(request=>request.operationId));
 return (session.operations||[]).filter(operation=>!['open','navigation'].includes(operation.kind)&&ids.has(operation.id));
}
export function backgroundRequests(session:ExecutionSession){const ids=new Set(numberedOperations(session).map(operation=>operation.id));return session.requests.filter(request=>request.background||!request.operationId||!ids.has(request.operationId));}
export function primaryRequest(session:ExecutionSession,operationId:string){
  const requests=operationRequests(session,operationId),writes=requests.filter(r=>['POST','PUT','PATCH','DELETE'].includes(r.method));
  if(writes.length)return {request:[...writes].sort((a,b)=>b.start-a.start||a.id.localeCompare(b.id))[0],reason:'本次操作中最晚发出的写请求',others:requests};
  const depth=(r:BrowserRequest)=>{const model=buildReplay(r,session.spans,{requestRoots:session.requests});return Math.max(0,...model.calls.map(call=>{let current=call,result=0;const seen=new Set<string>();while(current.kind!=='browser'&&!seen.has(current.id)){seen.add(current.id);result++;const parent=model.byCall[current.parentId||''];if(!parent)break;current=parent;}return result;}));};
  const candidates=session.operationVersion===2?requests:requests.filter(r=>!pollingRequest(r,session.requests));
  const request=[...candidates].sort((a,b)=>depth(b)-depth(a)||b.start-a.start||a.id.localeCompare(b.id))[0];
  return {request,reason:request&&depth(request)>0?'优先已观察业务下游，再按相关请求发出时间':'按页面操作上下文选择，因果未完全证明',others:requests};
}
