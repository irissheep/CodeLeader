import {useEffect,useMemo,useState} from 'react';
import type {ExecutionSession,SafeValue} from '../shared/execution';
import type {Location,ProjectIndex} from '../shared/model';
import {callVisibility,replayLabel,type ReplayState,type ReplayAction} from '../runtime/replay';
import {hideActual} from '../runtime/snapshot';
import {visibleValue,bodyValue,methodComparison,resultSummary,exceptionSummary,valueLimits,isObject} from './execution-data';
import ExecutionValues,{ExecutionHeaders,MethodComparison,RawActions} from './ExecutionValues';
import Source from './Source';
import {followingSource} from './source-follow';
import {exceptionChain,exceptionText} from '../runtime/exception-details';
import {orderNotice} from './call-reading';

type Props={index:ProjectIndex;state:ReplayState;record:ExecutionSession;dispatch:(action:ReplayAction)=>void;change:(fn:(s:ReplayState)=>ReplayState)=>void;onSource:(location:Location)=>void;onTrack?:(field:string)=>(()=>void)|undefined};
const itemCount=(value:SafeValue|undefined)=>value===undefined?'没录到':`${isObject(value)?Object.keys(value).length:Array.isArray(value)?value.length:value===null?0:1} 项`;
export default function ExecutionInspector({index,state,record,dispatch,onTrack}:Props){
  const {model}=state,current=model.steps[model.positions[state.cursor]],call=model.byCall[state.inspected]||model.byCall[current?.callId];
  const [tab,setTab]=useState('数据');useEffect(()=>setTab(tab=>tab==='源码'?tab:call?.kind==='browser'?'请求':'数据'),[call?.id]);
  const playback=useMemo(()=>call?followingSource(index,record,state,call):undefined,[index,record.sourceVersion,state.model,state.cursor,state.display,call?.id]);
  if(!call)return null;
  const shown=callVisibility(state,call.id),isRequest=call.kind==='browser'||call.kind==='http',isBrowser=call.kind==='browser',request=model.request,path=new URL(request.url).pathname;
  const input=call.input,output=call.error??call.output,displayInput=visibleValue(input,state.display),displayOutput=bodyValue(visibleValue(output,state.display));
  const method=String(call.span?.attributes['http.request.method']||call.span?.attributes['http.method']||request.method),url=String(call.span?.attributes['url.full']||call.span?.attributes['http.url']||request.url);
  const requestBody=visibleValue(request.requestBody,state.display),emptyInput=displayInput===undefined||displayInput===null||isObject(displayInput)&&!Object.keys(displayInput).length;
  const noInput=isBrowser?['GET','HEAD'].includes(method)&&!new URL(request.url).search&&(requestBody===undefined||requestBody===null||requestBody===''):record.plan.points.find(point=>point.symbolId===call.span?.symbolId)?.parameterNames?.length===0;
  const submitted=bodyValue(displayInput),hasBody=isRequest&&submitted!==undefined&&submitted!==null&&submitted!=='';
  const rows=methodComparison(input,call.output,state.display,isRequest),counts=(kind:string)=>rows.filter(row=>row.kind===kind).length;
  const failed=!!call.error||call.span?.status==='error'||isBrowser&&!!(request.error||request.status&&request.status>=400),chain=exceptionChain(visibleValue(call.error,state.display));
  const requestSummary=hasBody&&isObject(submitted)?`提交 ${Object.keys(submitted).length} 个字段 → ${isObject(displayOutput)?`返回 ${Object.keys(displayOutput).length} 个字段`:resultSummary(displayOutput,path)||'没录到返回内容'}`:undefined;
  const summary=record.policy==='structure'?'这份历史没有保存具体内容。':exceptionText(visibleValue(call.error,state.display))||exceptionSummary(call.error)||(failed?`请求失败${request.status?' · '+request.status:''}`:isRequest?requestSummary||resultSummary(displayOutput,path)||'没录到返回内容':rows.length?`新增 ${counts('added')} 个字段，${counts('changed')} 个改变，${counts('same')} 个不变${counts('removed')?`，${counts('removed')} 个删除`:''}${counts('unknown')?`，${counts('unknown')} 个无法比较`:''}`:`入参 ${itemCount(displayInput)} → 返回 ${itemCount(displayOutput)}`);
  const location=playback?.location||call.span?.location||(isBrowser?request.initiator?.find(item=>item.location)?.location:undefined),selectedStep=model.positions[current?.callId===call.id?current.id:call.enterId]+1;
  const operation=record.operations?.find(operation=>operation.id===request.operationId)?.label;
  const subtitle=isRequest?`${method} ${state.display==='hidden'?String(hideActual(new URL(url).pathname)):new URL(url).pathname}`:`${operation||'当前请求'} · 第 ${selectedStep} 步`;
  const status=failed?'请求失败':shown.returned?'正常返回':shown.reached?'进行中':'尚未到达',notice=orderNotice(model,call.id);
  const valueSection=(title:string,value:SafeValue|undefined,empty:string,preview=false)=><section className={`inspector-value-section ${preview?'data-preview':''}`}><header><h3>{title}</h3>{preview&&<span className="data-preview-label">还没播放到 · 预览</span>}<RawActions value={visibleValue(value,state.display)}/></header><ExecutionValues value={value} mode={state.display} empty={empty} actions={false} onTrack={onTrack}/></section>;
  const inputSection=noInput&&emptyInput?<section className="inspector-value-section input-absent"><h3>入参</h3><p>无入参</p></section>:valueSection('入参',input,'没录到：这次没有保存输入内容。',!shown.reached&&input!==undefined);
  const outputSection=valueSection(failed?'异常':'返回值',output,call.complete?'没录到：这次没有保存返回内容。':'还没收到返回值。',!shown.returned&&output!==undefined);
  const headers=(title:string,value:SafeValue|undefined)=><section className="inspector-value-section"><header><h3>{title}</h3><RawActions value={visibleValue(value,state.display)}/></header><ExecutionHeaders value={value} mode={state.display} actions={false}/></section>;
  const comparison=rows.length>0&&<section className={`inspector-value-section ${!shown.returned?'data-preview':''}`}><header><h3>{isRequest?'提交与返回':'进入与返回'}</h3>{!shown.returned&&<span className="data-preview-label">还没播放到 · 预览</span>}<RawActions value={isRequest?{提交时:submitted??null,返回时:displayOutput??null}:{进入时:displayInput??null,退出时:visibleValue(call.output,state.display)??null}}/></header><MethodComparison rows={rows} onTrack={onTrack} request={isRequest}/>{[...valueLimits(input),...valueLimits(call.output)].map((limit,i)=><p className="value-limit" key={i}>{limit.path&&`${limit.path}：`}{limit.message}</p>)}</section>;
  const tabs=isBrowser?['请求','响应','源码']:['数据','源码'];
  return <div className="data-panel-content" key={call.id}><header className="data-panel-heading"><div><h2>{isBrowser?'浏览器':replayLabel(call)}{notice&&<span className="call-order-notice" title={notice} aria-label={notice}>⇄</span>}</h2><p title={subtitle}>{subtitle}</p><p className={`data-panel-summary ${failed?'is-error':''}`}>{summary}</p></div><div className="data-panel-status"><span className={failed?'status-error':'status-ok'}>{isBrowser&&request.status?request.status:status}</span>{typeof call.durationMs==='number'&&<span className="data-panel-duration">耗时 {call.durationMs.toFixed(1)} ms</span>}</div></header>
    <nav className="data-panel-tabs" aria-label="节点数据">{tabs.map(name=><button key={name} aria-current={tab===name?'page':undefined} onClick={()=>setTab(name)}>{name}</button>)}</nav>
    {call.id!==current?.callId&&<button className="execution-goto" onClick={()=>dispatch({type:'goto',id:call.enterId})}>到此步</button>}
    {tab==='数据'&&(rows.length?<>{comparison}<details className="comparison-values"><summary>入参和返回值</summary>{inputSection}{outputSection}</details></>:<>{inputSection}{outputSection}</>)}
    {tab==='请求'&&<>{inputSection}{headers('请求头',request.headers)}</>}
    {tab==='响应'&&<>{comparison||outputSection}{headers('响应头',request.responseHeaders)}</>}
    {tab==='源码'&&(location?<div className="data-panel-source"><Source embedded playback={playback} location={location} index={index} onNavigate={()=>{}} onClose={()=>setTab(isBrowser?'请求':'数据')}/></div>:<p className="execution-muted">没录到：这处没有可打开的源码位置。</p>)}
    {chain.length>0&&<ol className={`exception-chain ${!shown.returned?'data-preview':''}`} aria-label="异常原因">{chain.map((error,i)=><li key={i}><strong>{i?'原因：':''}{error.type}</strong>{error.message!==undefined&&<p>{error.message}</p>}{error.messageNotice&&<small>{error.messageNotice}</small>}{error.causeNotice&&<p>{error.causeNotice}</p>}</li>)}</ol>}
    {call.span?.attributes['db.query.text']&&<details className="data-panel-query"><summary>执行语句</summary><pre>{String(call.span.attributes['db.query.text'])}</pre></details>}
    {call.span&&!call.span.versionMatch&&<p className="execution-stage-note">源码已变化，暂时不能定位。</p>}
  </div>;
}
