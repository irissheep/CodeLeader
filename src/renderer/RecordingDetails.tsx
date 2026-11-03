import type {ExecutionSession} from '../shared/execution';
import type {ReplayState} from '../runtime/replay';
import {backgroundAssociationGaps} from '../runtime/after-response';
export default function RecordingDetails({record,state,onClose}:{record:ExecutionSession;state?:ReplayState;onClose:()=>void}){
  const calls=state?.model.calls||[],missing=calls.filter(c=>c.complete&&c.output===undefined&&c.error===undefined).length;
  const uncertain=calls.some(c=>c.uncertain&&!c.parallel);
  const gaps=state?backgroundAssociationGaps(record,state.model.request):[];
  return <aside className="execution-technical-drawer" aria-label="录制情况"><header><h2>录制情况</h2><button onClick={onClose}>关闭</button></header><dl className="recording-summary"><div><dt>录到了什么</dt><dd>{record.requests.length} 次请求，{record.spans.length} 条内部记录。</dd></div><div><dt>没录到什么</dt><dd>{missing?`当前请求有 ${missing} 处没有返回内容。`:'当前请求没有已确认缺失的返回内容。'}{gaps.map(gap=><p key={gap}>{gap}</p>)}{record.dropped>0&&`另有 ${record.dropped} 条记录未能保存。`}</dd></div><div><dt>先后顺序从哪来</dt><dd>{uncertain?'按记录中的调用关系排列，部分步骤先后无法确定。':'按记录中的调用关系和进入、返回的位置排列。'}</dd></div></dl><details><summary>更多</summary><dl className="recording-summary"><div><dt>开始时间</dt><dd>{new Date(record.createdAt).toLocaleString()}</dd></div>{record.stoppedAt&&<div><dt>结束时间</dt><dd>{new Date(record.stoppedAt).toLocaleString()}</dd></div>}<div><dt>已保存的内容</dt><dd>{calls.filter(c=>c.input!==undefined).length} 处输入，{calls.filter(c=>c.output!==undefined).length} 处输出，{calls.filter(c=>c.error!==undefined).length} 处异常。</dd></div><div><dt>完整内容</dt><dd>可在“更多”中导出本次录制。</dd></div></dl></details></aside>;
}
