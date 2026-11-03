import { useRef, type CSSProperties, type MouseEvent } from 'react';
import type { EntryPoint } from '../shared/model';
import type { EntryOutcome } from './reading-model';
import { interfaceRowHeight } from './entry-geometry';
import {httpMethodLabel} from '../shared/http-method';
import {Row} from './Layout';

export default function EntryList({entries,outcomes,onEntry,full=false,onMore,selectedId}:{entries:EntryPoint[];outcomes:Record<string,EntryOutcome>;onEntry:(e:EntryPoint,target?:string)=>void;full?:boolean;onMore?:(e:EntryPoint)=>void;selectedId?:string}){
 const down=useRef<{x:number;y:number}|undefined>(undefined);
 const activate=(event:MouseEvent<HTMLButtonElement>,action:()=>void)=>{event.stopPropagation();if(event.detail&&down.current&&Math.hypot(event.clientX-down.current.x,event.clientY-down.current.y)>6){event.preventDefault();return;}action();};
 return <div className={`entry-list nodrag nopan ${full?'complete':''}`} style={{'--entry-row-height':`${interfaceRowHeight}px`} as CSSProperties} onClick={e=>e.stopPropagation()} onDoubleClick={e=>e.stopPropagation()} onPointerDownCapture={e=>{down.current={x:e.clientX,y:e.clientY};}} onPointerCancel={()=>down.current=undefined}>{entries.map(entry=>{
  const [method,...path]=entry.name.split(' · ')[0].split(' '),outcome=outcomes[entry.id],issues=[...entry.pathEvidence?.issues||[],...entry.pathEvidence?.aliases?.flatMap(a=>a.issues)||[]];
  return <div className={`entry-row ${selectedId===entry.id?'selected':''}`} key={entry.id} data-entry-id={entry.id}>
   <button type="button" className="entry-route" title={[path.join(' '),...entry.pathEvidence?.aliases?.map(a=>a.path)||[]].join('\n')} aria-current={selectedId===entry.id?'true':undefined} onClick={e=>activate(e,()=>onEntry(entry))}><Row leading={<span className={`http-method ${method.toLowerCase()}`}>{httpMethodLabel(method)}</span>}><span className="entry-path" title={path.join(' ')}>{path.join(' ')}{!!entry.pathEvidence?.aliases?.length&&` · 另有 ${entry.pathEvidence.aliases.length} 个路径`}</span></Row></button>
   <div className="entry-landings">{outcome?.destinations.slice(0,full?undefined:2).map(d=><button type="button" key={d.id} className="landing-chip" data-target-id={d.id} onClick={e=>activate(e,()=>onEntry(entry,d.id))} title={[...d.via,d.name].join(' → ')}>→ {[...d.via,d.name].join(' → ')}</button>)}
    {!full&&outcome?.destinations.length>2&&<button type="button" className="more-landings" onClick={e=>activate(e,()=>onMore?.(entry))}>其余 {outcome.destinations.length-2} 个落点</button>}
    {!!issues.length&&<span className="direct-return" title={issues.map(i=>`${i.location.file}:${i.location.range.start.line+1} · ${i.reason}`).join('\n')}>{entry.reason}</span>}
    {entry.frameworkMapping?.approximate&&<span className="direct-return" title={entry.frameworkMapping.basis.map(b=>`${b.location.file}:${b.location.range.start.line+1} · ${b.note}`).join('\n')}>按 {entry.frameworkMapping.name} {entry.frameworkMapping.version} 映射</span>}
    {outcome?.direct&&<span className="direct-return">直接返回</span>}
   </div>
  </div>;
 })}</div>;
}
