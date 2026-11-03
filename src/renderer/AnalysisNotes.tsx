import {createContext,useContext,useCallback,useEffect,useLayoutEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import type {AnalysisNotes,MissingAddressNotes,MissingWebNotes,NoteEvidence} from '../shared/analysis-notes';
import {analysisNotesKey} from '../shared/analysis-notes';
import type {Location,ProjectIndex} from '../shared/model';
import './analysis-notes.css';
import {useCanvasPopup} from './useCanvasOverlays';

const NotesContext=createContext<{notes?:AnalysisNotes;failed?:boolean;onSource?:(location:Location)=>void;copy?:(unitId:string)=>Promise<void>}>({});
export const useAnalysisNotes=()=>useContext(NotesContext);
export function AnalysisNotesProvider({index,onSource,children}:{index?:ProjectIndex;onSource:(location:Location)=>void;children:ReactNode}){
 const key=index&&analysisNotesKey(index),[state,setState]=useState<{key:string;notes?:AnalysisNotes;failed?:boolean}>();
 const source=useRef(onSource);source.current=onSource;const select=useCallback((location:Location)=>source.current(location),[]);
 const copy=useCallback((unitId:string)=>window.codeleader.copyAnalysisNotes(unitId,index?.id,index?.contextId),[key]);
 useEffect(()=>{
  let active=true;if(!index||['structure','analyzing'].includes(index.status))return;
  const request=window.codeleader.analysisNotes?.(index.id,index.contextId);
  if(!request){setState({key:key!,failed:true});return;}
  void request.then(notes=>{if(active)setState(notes.projectId===index.id&&notes.version===index.createdAt?{key:key!,notes}:{key:key!,failed:true});}).catch(()=>{if(active)setState({key:key!,failed:true});});
  return()=>{active=false;};
 },[key]);
 const current=state?.key===key?state:undefined,value=useMemo(()=>({notes:current?.notes,failed:current?.failed,onSource:select,copy}),[current,select,copy]);
 return <NotesContext.Provider value={value}>{children}</NotesContext.Provider>;
}
export function UnitAddressExplanation({unitId}:{unitId?:string}){const {notes}=useAnalysisNotes(),note=notes?.addresses.find(n=>n.unitId===unitId);return note?<AddressExplanation note={note}/>:null;}
export function EvidenceLinks({items}:{items:NoteEvidence[]}){
 const {onSource}=useAnalysisNotes();
 return <span className="explanation-evidence">{items.map((e,i)=><button key={i} onClick={()=>onSource?.(e.location)} title={e.label}>{e.location.file}:{e.location.range.start.line+1}</button>)}</span>;
}
export function WebExplanation({note}:{note:MissingWebNotes}){
 const [copied,setCopied]=useState(false),[failed,setFailed]=useState(false),{copy}=useAnalysisNotes();
 return <section className="graph-absence web-explanation" data-web-explanation={note.unitId}>
  <div><strong>识别到 {note.framework} · 没识别出接口</strong><p>{note.name}</p>
   <p>来源：<EvidenceLinks items={note.basis.slice(0,2)}/></p>
   <details><summary>已扫描 {note.files.length} 个路由/视图文件</summary><ul>{note.files.map(file=><li key={file}>{file}</li>)}</ul></details>
   {note.reasons.map((reason,i)=><p key={i}>可能原因：{reason.text}<EvidenceLinks items={reason.evidence.slice(0,2)}/></p>)}
   <p>请核对这些文件；也可以按 Ctrl+O 选择包含路由的源码目录。</p>
   <button className="button" onClick={()=>{void (copy?copy(note.unitId):Promise.reject()).then(()=>{setCopied(true);setFailed(false);}).catch(()=>setFailed(true));}}>{copied?'已复制':'复制说明'}</button>
   {failed&&<p role="status">复制失败，请选中说明文字复制。</p>}
  </div>
 </section>;
}
export function AddressExplanation({note}:{note:MissingAddressNotes}){
 const anchor=useRef<HTMLDivElement>(null),popup=useRef<HTMLDivElement>(null);
 const stays=(target:EventTarget|null)=>target instanceof Node&&(anchor.current?.contains(target)||popup.current?.contains(target));
 const hide=()=>{if(popup.current){popup.current.style.visibility='hidden';popup.current.inert=true;popup.current.setAttribute('aria-hidden','true');}};
 const show=()=>{if(!anchor.current||!popup.current||anchor.current.closest<HTMLElement>('.graph-canvas')?.dataset.overlayMoving==='true')return;const trigger=anchor.current.getBoundingClientRect(),area=anchor.current.closest('.canvas-stage')?.getBoundingClientRect()||document.documentElement.getBoundingClientRect(),element=popup.current,gap=parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--space-1'));
  element.style.maxWidth=area.width-gap*2+'px';element.style.maxHeight=area.height-gap*2+'px';const box=element.getBoundingClientRect();
  element.style.left=Math.max(area.left+gap,Math.min(trigger.left,area.right-box.width-gap))+'px';element.style.top=Math.max(area.top+gap,Math.min(trigger.bottom+gap,area.bottom-box.height-gap))+'px';
  element.style.visibility='visible';element.inert=false;element.setAttribute('aria-hidden','false');
 };
 useCanvasPopup(anchor,hide,show);
 useLayoutEffect(()=>{hide();},[note]);
 const escape=(event:React.KeyboardEvent)=>{if(event.key==='Escape'){event.stopPropagation();hide();anchor.current?.blur();}};
 return <div ref={anchor} className="address-explanation" tabIndex={0} data-address-explanation={note.unitId} onPointerEnter={show} onPointerLeave={e=>{if(!stays(e.relatedTarget))hide();}} onFocus={show} onBlur={e=>{if(!stays(e.relatedTarget))hide();}} onKeyDown={escape}>
  <p>{note.summary||`${note.count} 处调用 · 地址由变量组成，无法确定指向哪个后端`}</p>
  {createPortal(<div ref={popup} className="address-examples nowheel" role="tooltip" style={{visibility:'hidden'}} inert aria-hidden="true" onClick={e=>{if((e.target as Element).closest('button'))hide();}} onPointerLeave={e=>{if(!stays(e.relatedTarget))hide();}} onKeyDown={escape}><strong>还不能确定这些地址</strong>
   {note.calls.map(call=><div className="address-example" key={call.id}><p>{call.method} {call.address}</p><EvidenceLinks items={[{location:call.location,label:'发出请求的位置'}]}/>
    {call.variables.map(v=><p key={v.name} data-address-variable={v.state}><code>{v.name}</code>：{v.text}<EvidenceLinks items={v.evidence.slice(0,1)}/></p>)}
    {!call.variables.length&&<p>地址来自运行时的表达式，这里还不能确定取值。</p>}
   </div>)}
   <p>可打开上面的位置查看地址来源；如果只在页面运行时取值，可在页面里发出请求后查看。</p>
  </div>,document.body)}
 </div>;
}
