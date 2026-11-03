import {FileSearch} from 'lucide-react';
import type {ProjectIndex,ViewState} from '../shared/model';
import {useAnalysisNotes,WebExplanation} from './AnalysisNotes';

export default function GraphAbsence({index,view,empty}:{index:ProjectIndex;view:ViewState;empty:boolean}){
 const {notes}=useAnalysisNotes();
 if(index.status==='structure'||index.status==='analyzing')return null;
 if(view.level==='guide'&&notes?.web.length)return <div className="graph-explanations">{notes.web.map(note=><WebExplanation key={note.unitId} note={note}/>)}</div>;
 const files=index.files.length+(index.frontendFiles?.length||0),http=index.entries?.filter(e=>e.kind==='http').length||0;
 const frontend=index.units?.some(u=>u.kind==='frontend'),backend=index.units?.some(u=>u.kind==='application');
 const resource=index.resources?.some(r=>r.kind==='database');
 const missing=!backend&&frontend?'没有识别到后端':!http&&files?'没有识别到接口':view.level==='main'&&backend&&!resource?'没有识别到数据库':undefined;
 if(!empty&&!missing&&index.status!=='failed')return null;
 const title=index.status==='failed'?'这次没能读完项目':empty&&!files?'还没有可阅读的源码':missing||'这个范围没有可显示的内容';
 return <section className={`graph-absence ${empty?'is-empty graph-no-data':''}`} aria-label={title}><FileSearch size={22}/><div><strong>{title}</strong><p>已查看所选目录，找到 {files} 个源码文件。</p><p>{!backend&&frontend?'要看后端，请选择包含后端源码的项目目录。':'按 Ctrl+B 选择文件，或按 Ctrl+O 选择源码所在目录。'}</p></div></section>;
}
