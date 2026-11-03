import type { BrowserRequest, ExecutionSession, RecordedSpan, SafeValue } from '../shared/execution';
import {afterResponseCandidates,causalParents,spanIdentity} from './after-response';

export type ReplayPhase='enter'|'atomic'|'return';
export interface OrderEvidence {
  clocks?:Record<string,string>;
  synchronousParents?:Record<string,string>;
  parallel?:[string,string][];
  notes?:string[];
  requestRoots?:{traceId:string;spanId:string}[];
}
export interface ReplayCall {
  id:string;name:string;kind:'browser'|'http'|'method'|'sql'|'chroma';
  span?:RecordedSpan;records:RecordedSpan[];parentId?:string;children:string[];
  input?:SafeValue;output?:SafeValue;error?:SafeValue;complete:boolean;
  enterId:string;returnId?:string;lastId:string;service:string;durationMs?:number;
  synchronousParent:boolean;uncertain:boolean;parallel:boolean;
  asynchronous?:boolean;
}
export interface ReplayStep {
  id:string;callId:string;phase:ReplayPhase;exception:boolean;sourceIds:string[];
  basis:string[];instant?:{clock:string;ns:string};
  afterResponse?:{offsetMs?:number};
}
export interface ReplayModel {
  key:string;fingerprint:string;request:BrowserRequest;calls:ReplayCall[];steps:ReplayStep[];
  byCall:Record<string,ReplayCall>;positions:Record<string,number>;notes:string[];
  repeats:{id:string;calls:string[]}[];
}
const integer=(s:string|undefined)=>!!s&&/^\d+$/.test(s)&&BigInt(s)>0n;
const ended=(s:RecordedSpan)=>integer(s.end)&&integer(s.start)&&BigInt(s.end)>=BigInt(s.start)&&s.status!=='pending';
export const requestKey=(r:BrowserRequest)=>`${r.traceId}:${r.id}`;
export function replayFingerprint(request:BrowserRequest,spans:RecordedSpan[]){
  const extra=new Set(request.afterResponse?.calls.map(c=>c.id));
  return JSON.stringify([request.id,request.end,request.status,request.error,request.output,request.afterResponse?.calls,
    spans.filter(s=>s.traceId===request.traceId||extra.has(spanIdentity(s))).map(s=>[s.traceId,s.spanId,s.start,s.end,s.status,s.input,s.output,s.error]).sort((a,b)=>String(a[1]).localeCompare(String(b[1])))]);
}

/** Startup metadata proves only the unique controlled process, never a thread or a stack. */
export function sessionOrderEvidence(session:ExecutionSession):OrderEvidence{
  const clocks:Record<string,string>={},notes:string[]=[],direct:Record<string,string>={},synchronousParents:Record<string,string>={};
  for(const span of session.spans){if(span.versionMatch&&typeof span.attributes['codeleader.clock']==='string')clocks[span.traceId+':'+span.spanId]=String(span.attributes['codeleader.clock']);if(span.versionMatch&&typeof span.attributes['codeleader.sync_parent']==='string')synchronousParents[span.spanId]=String(span.attributes['codeleader.sync_parent']);}
  for(const language of ['java','python'] as const){
    const processes=session.processes.filter(p=>p.role===language);
    if(processes.length!==1)continue;
    const points=new Set(session.plan.points.filter(p=>p.language===language).map(p=>p.id));
    const owned=session.spans.filter(s=>s.versionMatch&&points.has(String(s.attributes['codeleader.point'])));
    for(const s of owned)direct[s.traceId+':'+s.spanId]=clocks[s.traceId+':'+s.spanId]|| (clocks[s.traceId+':'+s.spanId]=`${language}:${processes[0].pid}:${processes[0].startedAt}`);
    if(owned.length)notes.push(`${language}：按本会话唯一受控进程的启动记录及匹配观察点确定时钟来源；未记录线程身份。`);
  }
  const raw=new Map(session.spans.map(s=>[s.traceId+':'+s.spanId,s]));
  const children=new Map<string,RecordedSpan[]>();for(const s of session.spans){const key=s.traceId+':'+s.parentSpanId;if(!children.has(key))children.set(key,[]);children.get(key)!.push(s);}
  for(const s of session.spans){
    const identity=s.traceId+':'+s.spanId;
    if(!s.versionMatch||clocks[identity])continue;
    if(s.kind===2){
      // A server belongs to the observed handler, even when two processes share a label.
      const queue=[...(children.get(s.traceId+':'+s.spanId)||[])],origins=new Set<string>(),seen=new Set<string>();
      while(queue.length){const child=queue.shift()!;if(seen.has(child.spanId))continue;seen.add(child.spanId);if(child.kind===2||child.kind===3)continue;const origin=direct[child.traceId+':'+child.spanId];if(origin)origins.add(origin);else queue.push(...children.get(child.traceId+':'+child.spanId)||[]);}
      if(origins.size===1)clocks[identity]=[...origins][0];
    }else{
      let parent=s.parentSpanId;const seen=new Set<string>();while(parent&&!seen.has(parent)){seen.add(parent);const origin=direct[s.traceId+':'+parent];if(origin){clocks[identity]=origin;break;}const p=raw.get(s.traceId+':'+parent);if(!p||p.kind===2)break;parent=p.parentSpanId;}
    }
  }
  return {clocks,notes,requestRoots:session.requests,synchronousParents};
}

/** Derive a partial order from recorded identities and comparable clocks. No raw record is mutated. */
export function buildReplay(request:BrowserRequest,records:RecordedSpan[],evidence:OrderEvidence={}):ReplayModel{
  const accepted=new Map(request.afterResponse?.calls.map(c=>[c.id,c])),causal=causalParents(request,records);
  const late=request.afterResponse?afterResponseCandidates(request,records,evidence.clocks||{}):new Map();
  const key=requestKey(request),sameTrace=records.filter(s=>(s.traceId===request.traceId||accepted.has(spanIdentity(s)))&&(!request.afterResponse||causal.has(spanIdentity(s)))&&(!late.has(spanIdentity(s))||accepted.has(spanIdentity(s)))),allRaw=new Map(sameTrace.map(s=>[s.spanId,s]));
  const otherRoots=new Set(evidence.requestRoots?.filter(r=>r.traceId===request.traceId&&r.spanId!==request.spanId).map(r=>r.spanId));
  const spans=sameTrace.filter(s=>{let parent=s.parentSpanId;const seen=new Set<string>();while(parent&&!seen.has(parent)){if(parent===request.spanId)return true;if(otherRoots.has(parent))return false;seen.add(parent);parent=allRaw.get(parent)?.parentSpanId;}return true;}).sort((a,b)=>a.spanId.localeCompare(b.spanId));
  const raw=new Map(spans.map(s=>[s.spanId,s])),owner=new Map<string,string>();
  const clockFor=(s:RecordedSpan)=>evidence.clocks?.[s.traceId+':'+s.spanId]??evidence.clocks?.[s.spanId];
  const browserId=key+':browser',calls:ReplayCall[]=[],byCall:Record<string,ReplayCall>={};
  const eligible=(s:RecordedSpan)=>{if(s.attributes['codeleader.boundary']==='http.payload')return false;let parent=s.parentSpanId;const seen=new Set<string>();while(parent&&!seen.has(parent)){seen.add(parent);const source=raw.get(parent);if(source?.attributes['codeleader.boundary']==='jdbc'&&(s.attributes['db.statement']||s.attributes['db.query.text']))return false;parent=source?.parentSpanId;}return !!(s.symbolId||s.attributes['codeleader.point']||s.attributes['codeleader.boundary']||s.attributes['db.statement']||s.attributes['db.query.text']||s.kind===2||s.kind===3);};
  const add=(id:string,s:RecordedSpan|undefined,members:RecordedSpan[],kind:ReplayCall['kind'])=>{
    const payload=members.find(m=>m.attributes['codeleader.boundary']==='http.payload');
    const complete=s?ended(s)&&(!payload||ended(payload))&&accepted.get(spanIdentity(s))?.completed!==false:request.end!==undefined;
    const duration=s?.durationMs??(s&&complete?Number((BigInt(s.end)-BigInt(s.start))/1000n)/1000:undefined);
    const call:ReplayCall={id,name:s?.name||`${request.method} ${new URL(request.url).pathname}`,kind,span:s,records:members,children:[],input:s?s.input:request.input,output:s?s.output:request.output,error:s?s.error||members.find(m=>m.error)?.error:request.error,complete,enterId:'',lastId:'',service:s?.service||'浏览器',durationMs:duration,synchronousParent:false,uncertain:false,parallel:false};
    if(!s&&request.end!==undefined)call.durationMs=request.end-request.start;
    if(s&&accepted.get(spanIdentity(s))?.completed===false){call.output=undefined;call.error=undefined;}
    calls.push(call);byCall[id]=call;for(const m of members)owner.set(m.spanId,id);return call;
  };
  const topServers=spans.filter(s=>s.kind===2&&s.parentSpanId===request.spanId);
  add(browserId,undefined,topServers,'browser');owner.set(request.spanId,browserId);
  for(const server of topServers)if(server.attributes['codeleader.service_id']&&!spans.some(s=>s.parentSpanId===server.spanId&&s.symbolId&&s.attributes['codeleader.point']))add(key+':'+server.spanId,server,[server],'http');
  for(const s of spans.filter(s=>s.kind===3)){
    const servers=spans.filter(c=>c.kind===2&&c.parentSpanId===s.spanId);
    if(servers.length===1)add(key+':'+s.spanId,s,[s,servers[0],...spans.filter(p=>p.spanId===s.attributes['codeleader.payload'])],'http');
  }
  for(const s of spans){
    if(owner.has(s.spanId)||!eligible(s))continue;
    add(key+':'+s.spanId,s,[s],s.attributes['codeleader.boundary']==='chroma.query'?'chroma':s.attributes['db.statement']||s.attributes['db.query.text']?'sql':s.kind===2||s.kind===3?'http':'method');
  }
  for(const call of calls){
    if(call.kind==='browser')continue;
    const continuation=call.span&&accepted.get(spanIdentity(call.span));
    call.asynchronous=continuation?.asynchronous;
    let parent=call.span?.parentSpanId||continuation?.parentId.split(':')[1];const visited=new Set<string>();
    while(parent&&!visited.has(parent)){
      visited.add(parent);const mapped=owner.get(parent);
      if(mapped&&mapped!==call.id){call.parentId=mapped;break;}
      parent=raw.get(parent)?.parentSpanId;
    }
    // Malformed cycles must not create a fictitious stack.
    let p=call.parentId;const chain=new Set([call.id]);
    while(p){if(chain.has(p)){call.parentId=undefined;break;}chain.add(p);p=byCall[p]?.parentId;}
    if(call.parentId)byCall[call.parentId].children.push(call.id);
    const proven=call.span&&evidence.synchronousParents?.[call.span.spanId];
    call.synchronousParent=!call.asynchronous&&!!proven&&proven===byCall[call.parentId||'']?.span?.spanId;
  }
  const steps:ReplayStep[]=[],stepsById=new Map<string,ReplayStep>();
  for(const call of calls){
    const atomic=call.kind!=='browser'&&call.complete&&!call.children.length&&!call.span?.attributes['codeleader.phase']&&!(call.span&&accepted.get(spanIdentity(call.span))?.returnOnly);
    const phase:ReplayPhase=atomic?'atomic':'enter';call.enterId=call.id+':'+phase;
    const failed=!!(call.error||call.span?.status==='error'||call.kind==='browser'&&request.status&&request.status>=400||call.kind==='http'&&call.records.some(s=>Number(s.attributes['http.response.status_code']||s.attributes['http.status_code'])>=400));
    const enter:ReplayStep={id:call.enterId,callId:call.id,phase,exception:atomic&&failed,sourceIds:call.records.map(s=>s.spanId),basis:[]};
    steps.push(enter);stepsById.set(enter.id,enter);
    if(atomic)call.returnId=call.enterId;
    else if(call.complete){call.returnId=call.id+':return';const exit:ReplayStep={id:call.returnId,callId:call.id,phase:'return',exception:failed,sourceIds:enter.sourceIds,basis:[]};steps.push(exit);stepsById.set(exit.id,exit);}
  }
  for(const step of steps){const call=byCall[step.callId];if(call.kind==='browser'){const time=step.phase==='return'?request.end:request.start;if(time!==undefined)step.instant={clock:'browser:'+key,ns:BigInt(Math.round(time*1e6)).toString()};}else if(call.span){const clock=clockFor(call.span),ns=step.phase==='return'?call.span.end:call.span.start;if(clock&&integer(ns))step.instant={clock,ns};}}
  for(const step of steps){const call=byCall[step.callId],continuation=call.span&&accepted.get(spanIdentity(call.span));if(continuation&&(!continuation.returnOnly||step.phase==='return'||step.phase==='atomic'))step.afterResponse={offsetMs:step.phase==='return'||step.phase==='atomic'&&continuation.returnOnly?continuation.endOffsetMs:continuation.startOffsetMs};}
  const edges=new Map<string,Set<string>>(),incoming=new Map<string,number>();
  const node=(id:string)=>{if(!incoming.has(id))incoming.set(id,0);};
  const edge=(from:string,to:string,basis?:string)=>{node(from);node(to);if(from===to)return;if(!edges.get(from)?.has(to)){if(!edges.has(from))edges.set(from,new Set());edges.get(from)!.add(to);incoming.set(to,incoming.get(to)!+1);}if(basis){const step=stepsById.get(to);if(step&&!step.basis.includes(basis))step.basis.push(basis);}};
  for(const step of steps)node(step.id);
  for(const call of calls){
    if(call.returnId&&call.returnId!==call.enterId)edge(call.enterId,call.returnId,'本次调用进入早于退出');
    if(call.parentId){const p=byCall[call.parentId];edge(p.enterId,call.enterId,'已录父子上下文：上游发起早于下游进入');
      if(call.synchronousParent&&call.returnId&&p.returnId)edge(call.returnId,p.returnId,'已证明的同步嵌套');
    }
  }
  const browserReturn=byCall[browserId].returnId;
  if(browserReturn)for(const step of steps)if(step.afterResponse)edge(browserReturn,step.id,'已录服务端响应结束后的关联调用');
  // Timestamp barriers keep this graph O(n log n), including overlapping atomic intervals.
  const clockEvents=new Map<string,{step:string;start:bigint;end:bigint}[]>();
  const anchor=(clock:string,id:string,start:bigint,end=start)=>{if(!clockEvents.has(clock))clockEvents.set(clock,[]);clockEvents.get(clock)!.push({step:id,start,end});};
  for(const call of calls){
    // A merged call has one boundary per clock. Anchoring the same step at two
    // different instants creates a cycle through the intervening time barriers.
    const bounds=new Map<string,{start:bigint;end?:bigint}>();
    for(const s of call.records){const clock=clockFor(s);if(!clock||!integer(s.start))continue;const start=BigInt(s.start),end=ended(s)?BigInt(s.end):undefined,old=bounds.get(clock);
      bounds.set(clock,{start:old&&old.start<start?old.start:start,end:end===undefined?old?.end:old?.end!==undefined&&old.end>end?old.end:end});
    }
    for(const [clock,bound]of bounds){anchor(clock,call.enterId,bound.start,call.enterId===call.returnId?bound.end??bound.start:bound.start);if(call.returnId&&call.returnId!==call.enterId&&bound.end!==undefined)anchor(clock,call.returnId,bound.end);}
  }
  // Browser timestamps are a separate monotonic source; never align them to Unix ns.
  anchor('browser:'+key,browserId+':enter',BigInt(Math.round(request.start*1e6)));
  if(request.end!==undefined)anchor('browser:'+key,browserId+':return',BigInt(Math.round(request.end*1e6)));
  for(const [clock,events] of clockEvents){
    const times=[...new Set(events.flatMap(e=>[e.start.toString(),e.end.toString()]))].map(BigInt).sort((a,b)=>a<b?-1:a>b?1:0);
    const barrier=(t:bigint,suffix:string)=>`@${clock}:${t}:${suffix}`;
    times.forEach((t,i)=>{edge(barrier(t,'before'),barrier(t,'after'));if(i)edge(barrier(times[i-1],'after'),barrier(t,'before'));});
    for(const e of events){edge(barrier(e.start,'before'),e.step,'同一已确认时钟来源的纳秒记录');edge(e.step,barrier(e.end,'after'));}
  }
  // Paired HTTP is one communication. Its server completion is a causal prerequisite
  // for the client's received response, not a cross-process clock comparison.
  for(const call of calls.filter(c=>c.kind==='browser'||c.records.length>1)){
    const servers=call.records.filter(s=>s.kind===2);
    for(const child of calls.filter(c=>c.parentId===call.id)){
      const own=child.span,server=servers.find(s=>s.spanId===own?.parentSpanId);
      if(!own||!server||!call.returnId||!child.returnId||!ended(own)||!ended(server))continue;
      const clock=clockFor(own);
      if(clock&&clock===clockFor(server)&&BigInt(own.end)<=BigInt(server.end))edge(child.returnId,call.returnId,'HTTP 响应依赖已录服务端处理结束');
    }
  }
  const depth=(id:string)=>{let n=0;const seen=new Set<string>();while(byCall[id]?.parentId&&!seen.has(id)){seen.add(id);id=byCall[id].parentId!;n++;}return n;};
  const stable=(a:string,b:string)=>{
    const left=stepsById.get(a),right=stepsById.get(b);if(!left||!right)return !left&&!right?a.localeCompare(b):!left?-1:1;
    // A readable tie break, not extra causal evidence: finish a recorded leaf before
    // displaying an incomparable enclosing return. Uncertainty remains explicit.
    const rank=(s:ReplayStep)=>s.phase==='enter'?0:s.phase==='atomic'?1:2;
    return rank(left)-rank(right)||(left.phase==='return'?depth(right.callId)-depth(left.callId):0)||a.localeCompare(b);
  },ready=[...incoming].filter(([,n])=>n===0).map(([id])=>id).sort(stable),ordered:ReplayStep[]=[];
  // All eligible steps at a frontier are incomparable. Stable order is only presentation.
  const notes=[...(evidence.notes||[])];
  const dropped=Math.max(0,...spans.map(s=>Number(s.attributes['codeleader.dropped'])||0));
  if(dropped)notes.push(`记录含方法预算丢弃提示（至少 ${dropped} 次）；这不是完整丢失总数，未观察到不等于未执行。`);
  while(ready.length){
    const id=ready.shift()!;const step=stepsById.get(id);
    if(step){if(ready.some(other=>stepsById.has(other))){byCall[step.callId].uncertain=true;for(const other of ready){const s=stepsById.get(other);if(s)byCall[s.callId].uncertain=true;}}ordered.push(step);}
    for(const to of edges.get(id)||[]){incoming.set(to,incoming.get(to)!-1);if(!incoming.get(to)){ready.push(to);ready.sort(stable);}}
    incoming.delete(id);
  }
  if(incoming.size){notes.push('部分时间或关联约束冲突：冲突部分仅稳定展示，先后不确定。');for(const s of steps.filter(s=>incoming.has(s.id)).sort((a,b)=>stable(a.id,b.id))){byCall[s.callId].uncertain=true;ordered.push(s);}}
  if(calls.some(c=>c.uncertain))notes.push('存在无法证明先后的分支；稳定显示顺序不代表真实执行顺序。');
  if(calls.some(c=>c.kind!=='browser'&&!c.parentId)){notes.push('存在缺失上游记录的调用；未补造父节点，孤立记录先后不确定。');for(const c of calls)if(c.kind!=='browser'&&!c.parentId)c.uncertain=true;}
  const browserEnter=ordered.findIndex(s=>s.id===byCall[browserId].enterId);
  if(browserEnter>0){ordered.unshift(...ordered.splice(browserEnter,1));ordered[0].basis.push('浏览器发出为阅读起点；孤立记录的先后不作推定');}
  if(ordered.some(step=>step.afterResponse))ordered.splice(0,ordered.length,...ordered.filter(step=>!step.afterResponse),...ordered.filter(step=>step.afterResponse));
  for(const [a,b] of evidence.parallel||[])for(const c of calls)if(c.records.some(s=>s.spanId===a||s.spanId===b))c.parallel=true;
  const positions=Object.fromEntries(ordered.map((s,i)=>[s.id,i]));
  for(const call of calls)call.lastId=call.returnId||call.enterId;
  for(const step of ordered){let id=byCall[step.callId].parentId;const seen=new Set<string>();while(id&&!seen.has(id)){seen.add(id);const call=byCall[id];if(positions[call.lastId]>=positions[step.id])break;call.lastId=step.id;id=call.parentId;}}
  for(const call of calls){
    call.children.sort((a,b)=>positions[byCall[a].enterId]-positions[byCall[b].enterId]);
  }
  const repeats:ReplayModel['repeats']=[];
  for(const parent of calls){let group:string[]=[];const finish=()=>{if(group.length>3)repeats.push({id:'repeat:'+group[0],calls:group});group=[];};for(const id of parent.children){const previous=byCall[group.at(-1)||''];if(previous&&(previous.name!==byCall[id].name||previous.kind!==byCall[id].kind))finish();group.push(id);}finish();}
  return {key,fingerprint:replayFingerprint(request,records),request:{...request},calls,steps:ordered,byCall,positions,notes,repeats};
}
export interface ReplayState {
  model:ReplayModel;cursor:string;inspected:string;playing:boolean;breakpoints:string[];hit?:string;skipOnce?:string;
  speed:number;follow:boolean;showAll:boolean;display:'structure'|'synthetic'|'raw'|'hidden';expanded:string[];timing?:'steps'|'recorded';
  pauseOnError?:boolean;notice?:string;viewport?:{x:number;y:number;zoom:number};compareSources?:Record<string,string>;
}
export function initialReplay(model:ReplayModel,policy:'structure'|'synthetic'|'raw'):ReplayState{return {model,cursor:model.steps[0]?.id||'',inspected:model.steps[0]?.callId||'',playing:false,breakpoints:[],speed:1000,follow:true,showAll:true,display:policy,expanded:[]};}
export type ReplayAction={type:'next'|'previous'|'into'|'over'|'out'|'tick'|'play'|'pause'}|{type:'goto';id:string}|{type:'inspect'|'breakpoint';id:string}|{type:'update';model:ReplayModel};
export function replayAction(state:ReplayState,action:ReplayAction):ReplayState{
  const {model}=state,index=model.positions[state.cursor]??0,current=model.steps[index],call=current&&model.byCall[current.callId];
  const at=(id:string|undefined,notice?:string):ReplayState=>{const target=model.steps.find(s=>s.id===id);return {...state,playing:false,hit:undefined,skipOnce:undefined,notice,cursor:target?.id||state.cursor,inspected:target?.callId||state.inspected};};
  if(action.type==='pause')return {...state,playing:false};
  if(action.type==='play')return {...state,playing:true,skipOnce:state.hit,hit:undefined,notice:undefined};
  if(action.type==='inspect')return {...state,playing:false,inspected:action.id};
  if(action.type==='breakpoint')return {...state,playing:false,breakpoints:state.breakpoints.includes(action.id)?state.breakpoints.filter(id=>id!==action.id):[...state.breakpoints,action.id]};
  if(action.type==='update'){
    const next=action.model,cursor=next.positions[state.cursor]!==undefined?state.cursor:next.steps[0]?.id||'';
    const lateError=state.playing&&state.pauseOnError!==false?next.steps.find(step=>step.exception&&next.positions[step.id]<=next.positions[cursor]&&!model.steps.find(previous=>previous.id===step.id)?.exception):undefined;
    return {...state,model:next,playing:false,hit:lateError?.id,skipOnce:undefined,cursor:lateError?.id||cursor,inspected:lateError?.callId||(next.byCall[state.inspected]?state.inspected:next.steps[0]?.callId||''),breakpoints:state.breakpoints.filter(id=>next.byCall[id]),notice:lateError?'这一步出错了':'已更新已录步骤，当前位置按稳定身份保留。'};
  }
  if(action.type==='tick'&&!state.playing)return state;
  if(action.type==='goto')return at(action.id);
  if(action.type==='previous')return at(model.steps[Math.max(0,index-1)]?.id);
  if(action.type==='next')return at(model.steps[Math.min(model.steps.length-1,index+1)]?.id);
  if(action.type==='into')return current?.phase==='enter'&&call?.children.length?at(model.byCall[call.children[0]].enterId):at(model.steps[index+1]?.id);
  if(action.type==='over'||action.type==='out'){
    if(action.type==='over'&&current?.phase!=='enter')return at(model.steps[index+1]?.id);
    let target=call;
    if(action.type==='out'&&current?.phase!=='enter')target=model.byCall[call?.parentId||''];
    if(!target)return {...state,playing:false,notice:'没有可用的上层返回。'};
    return at(target.returnId||target.lastId,target.returnId?undefined:'没有录到返回；停在该调用已知的最后位置。');
  }
  const next=model.steps[index+1];if(!next)return {...state,playing:false};
  if(next.phase!=='return'&&state.breakpoints.includes(next.callId)&&state.skipOnce!==next.id)return {...state,playing:false,hit:next.id,notice:'即将进入回放断点；再次播放可继续。'};
  if(next.exception&&state.pauseOnError!==false&&state.skipOnce!==next.id)return {...state,cursor:next.id,inspected:next.callId,playing:false,hit:next.id,skipOnce:undefined,notice:'这一步出错了'};
  return {...state,cursor:next.id,inspected:next.callId,skipOnce:undefined,hit:undefined,notice:undefined,playing:index+1<model.steps.length-1};
}
export function callVisibility(state:ReplayState,id:string){const call=state.model.byCall[id],at=state.model.positions[state.cursor]??-1;return {reached:!!call&&at>=state.model.positions[call.enterId],returned:!!call?.returnId&&at>=state.model.positions[call.returnId]};}
export function callPath(model:ReplayModel,id:string){const result:ReplayCall[]=[],seen=new Set<string>();while(id&&!seen.has(id)){seen.add(id);const call=model.byCall[id];if(!call)break;result.unshift(call);id=call.parentId||'';}return result;}
export function replayLabel(call:ReplayCall){
  if(call.kind==='chroma')return 'Chroma 检索';
  if(call.kind==='sql'){const sql=String(call.span?.attributes['db.query.text']||call.span?.attributes['db.statement']||''),mysql=String(call.span?.attributes['db.system']||call.span?.attributes['db.system.name']).includes('mysql');return /^\s*select\b/i.test(sql)?`读取 ${mysql?'MySQL':'数据库'}`:`${mysql?'MySQL':'SQL'} 数据操作`;}
  if(call.kind==='http')return call.records.find(s=>s.kind===2)?.name||call.name;
  return call.name;
}
export function replayInterval(state:ReplayState){const index=state.model.positions[state.cursor],left=state.model.steps[index]?.instant,right=state.model.steps[index+1]?.instant;if(state.timing!=='recorded')return {ms:state.speed};if(!left||!right||left.clock!==right.clock)return {ms:state.speed,reason:'时钟未对齐，按步骤播放'};const delta=BigInt(right.ns)-BigInt(left.ns);if(delta<0n)return {ms:state.speed,reason:'先后不确定，按步骤播放'};const ms=Number(delta/1000000n);return {ms:Math.max(60,Math.min(5000,ms))*state.speed/1000,...(ms>5000?{reason:'已录间隔超过 5 秒，按阅读上限播放'}:{})};}
