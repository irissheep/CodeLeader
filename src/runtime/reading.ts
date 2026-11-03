import type { BrowserRequest, RecordedSpan } from '../shared/execution';

/** Collapse duplicate HTTP evidence, retaining every raw span in the session. */
export function readingSpans(spans:RecordedSpan[],request?:BrowserRequest){
  const all=new Map(spans.map(s=>[s.spanId,s]));
  const visible=spans.filter(s=>{
    if(s.kind===2&&spans.some(child=>child.parentSpanId===s.spanId&&child.symbolId))return false;
    if(s.kind===3&&spans.some(child=>child.kind===2&&child.parentSpanId===s.spanId))return false;
    return !!(s.symbolId||s.attributes['codeleader.boundary']||s.attributes['db.statement']||s.attributes['db.query.text']||s.kind===2||s.kind===3);
  });
  const ids=new Set(visible.map(s=>s.spanId));
  const parent=(s:RecordedSpan)=>{let at=s.parentSpanId;const visited=new Set<string>();while(at&&all.has(at)&&!ids.has(at)&&!visited.has(at)){visited.add(at);at=all.get(at)?.parentSpanId;}return at;};
  const depth=(s:RecordedSpan,visited=new Set<string>()):number=>{if(visited.has(s.spanId))return 1;visited.add(s.spanId);const p=parent(s);return p&&ids.has(p)?1+depth(all.get(p)!,visited):1;};
  return {spans:visible.sort((a,b)=>depth(a)-depth(b)||Number(spans.some(s=>s.parentSpanId===b.spanId))-Number(spans.some(s=>s.parentSpanId===a.spanId))),parent,depth};
}
