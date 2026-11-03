import type {BrowserRequest,ExecutionSession,RecordedSpan,AfterResponseCall} from '../shared/execution';

export const spanIdentity=(span:Pick<RecordedSpan,'traceId'|'spanId'>)=>span.traceId+':'+span.spanId;
const valid=(ns:string)=>/^\d+$/.test(ns)&&BigInt(ns)>0n;
const finished=(s:RecordedSpan)=>s.status!=='pending'&&valid(s.end)&&valid(s.start)&&BigInt(s.end)>=BigInt(s.start);
export function idleSeconds(value:number|undefined){return Number.isFinite(value)?Math.min(30,Math.max(1,Math.round(value!))):3;}

/** Identity establishes membership; comparable service clocks establish response-relative time.
 * File arrival times control the collection budget only, never prove execution order. */
export function causalParents(request:BrowserRequest,spans:RecordedSpan[]){
  const root=request.traceId+':'+request.spanId,connected=new Set([root]),parents=new Map<string,string>();
  for(let changed=true;changed;){changed=false;for(const s of spans){const id=spanIdentity(s);if(connected.has(id))continue;
    const parent=s.parentSpanId&&s.traceId+':'+s.parentSpanId;
    // A consumer's links identify its producers. Arbitrary links do not prove a continuation.
    const from=parent&&connected.has(parent)?parent:s.kind===4?s.links.map(spanIdentity).find(id=>connected.has(id)):undefined;
    if(from){connected.add(id);parents.set(id,from);changed=true;}
  }}
  return parents;
}
export function afterResponseCandidates(request:BrowserRequest,spans:RecordedSpan[],clocks:Record<string,string>){
  const raw=new Map(spans.map(s=>[spanIdentity(s),s])),parents=causalParents(request,spans);
  const servers=spans.filter(s=>s.traceId===request.traceId&&s.kind===2&&s.parentSpanId===request.spanId&&finished(s));
  const result=new Map<string,AfterResponseCall>();
  for(let changed=true;changed;){changed=false;for(const s of spans){const id=spanIdentity(s),parentId=parents.get(id);if(result.has(id)||!parentId)continue;
    const anchor=servers.find(server=>clocks[spanIdentity(server)]&&clocks[spanIdentity(server)]===clocks[id]);
    const offset=(ns:string)=>anchor&&valid(ns)?Number(BigInt(ns)-BigInt(anchor.end))/1e6:undefined;
    const startOffsetMs=offset(s.start),endOffsetMs=finished(s)?offset(s.end):undefined,parent=result.get(parentId);
    const startsAfter=startOffsetMs!==undefined&&startOffsetMs>0;
    const returnsAfter=!startsAfter&&endOffsetMs!==undefined&&endOffsetMs>0;
    if(!startsAfter&&!returnsAfter&&(!parent||parent.returnOnly))continue;
    const p=raw.get(parentId),comparable=p&&finished(p)&&clocks[parentId]&&clocks[parentId]===clocks[id];
    const outlivesParent=comparable&&(valid(s.start)&&BigInt(s.start)>BigInt(p.end)||finished(s)&&BigInt(s.end)>BigInt(p.end));
    result.set(id,{id,parentId,startOffsetMs,endOffsetMs,returnOnly:!startsAfter&&(!parent||parent.returnOnly),asynchronous:!!outlivesParent||s.kind===4,completed:finished(s)});changed=true;
  }}
  return result;
}

export function updateAfterResponse(session:ExecutionSession,now:number,clocks:Record<string,string>){
  let changed=false;
  for(const request of session.requests){
    if(request.responseObservedAt===undefined||request.finished!=='completed')continue;
    if(!request.afterResponse){const responseAt=request.responseObservedAt;request.afterResponse={responseAt,lastActivityAt:responseAt,deadline:responseAt+30000,calls:[]};changed=true;}
    const window=request.afterResponse;if(window.closedAt!==undefined)continue;
    const quietUntil=window.lastActivityAt+idleSeconds(session.backgroundIdleSeconds)*1000;
    if(session.state!=='recording'||now>=Math.min(quietUntil,window.deadline)){
      window.closedAt=Math.min(now,quietUntil,window.deadline);window.reason=session.state!=='recording'?'stopped':window.deadline<=quietUntil?'limit':'idle';changed=true;continue;
    }
    const candidates=afterResponseCandidates(request,session.spans,clocks);
    for(const next of candidates.values()){
      const previous=window.calls.find(call=>call.id===next.id);
      if(!previous){window.calls.push(next);window.lastActivityAt=now;changed=true;}
      else if(JSON.stringify(previous)!==JSON.stringify(next)){Object.assign(previous,next);window.lastActivityAt=now;changed=true;}
    }
  }
  return changed;
}

export function backgroundAssociationGaps(session:ExecutionSession,request:BrowserRequest){
  const parents=causalParents(request,session.spans),associated=session.spans.filter(s=>parents.has(spanIdentity(s)));
  const written=new Set(associated.flatMap(s=>s.entityId&&session.plan.resources?.some(r=>r.id===s.entityId&&r.operation==='write')?[s.entityId]:[]));
  return (session.plan.backgroundReaders||[]).filter(reader=>reader.resources.some(id=>written.has(id))&&!associated.some(s=>s.symbolId===reader.symbolId)).map(reader=>`后台处理没关联上：${reader.name} 会另行读取这些数据，但没有保存本次请求与它的对应关系。`);
}
export function afterResponseText(step:{afterResponse?:{offsetMs?:number}}){return step.afterResponse?step.afterResponse.offsetMs===undefined?'响应后 · 时间未录到':`响应后 +${(Math.max(0,step.afterResponse.offsetMs)/1000).toFixed(1)}s`:undefined;}
