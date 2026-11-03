import uiTokens from '../shared/ui-tokens';
import { useEffect, useRef, useState } from 'react';
import * as monaco from 'monaco-editor/editor/editor.api.js';
import 'monaco-editor/languages/definitions/java/register.js';
import 'monaco-editor/languages/definitions/python/register.js';
import 'monaco-editor/languages/definitions/typescript/register.js';
import 'monaco-editor/languages/definitions/javascript/register.js';
import 'monaco-editor/languages/definitions/html/register.js';
import 'monaco-editor/languages/definitions/css/register.js';
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker';
import { Code2, Crosshair, X, ChevronRight, AlertCircle } from 'lucide-react';
import type { Location, ProjectIndex } from '../shared/model';
import { contains } from '../shared/model';
import {noteFull,type SourcePlayback} from './source-follow';
import {savedEditor,sourceRole} from './source-options';
import {fullValue,isObject} from './execution-data';
import './source-playback.css';
(self as any).MonacoEnvironment={getWorker:()=>new EditorWorker()};
export default function Source({location,index,onNavigate,onClose,embedded=false,playback}:{location:Location;index:ProjectIndex;onNavigate:(id:string)=>void;onClose:()=>void;embedded?:boolean;playback?:SourcePlayback}) {
  const host=useRef<HTMLDivElement>(null);const editor=useRef<monaco.editor.IStandaloneCodeEditor|null>(null);const [error,setError]=useState('');const [stale,setStale]=useState(false);const [line,setLine]=useState(location.range.start.line+1);const decorations=useRef<monaco.editor.IEditorDecorationsCollection|null>(null);
  const [loaded,setLoaded]=useState(''),[expandedValue,setExpandedValue]=useState<{line:number;text:string}>();
  const [notice,setNotice]=useState('');
  const zones=useRef<string[]>([]);
  const copyPosition=async()=>{try{await window.codeleader.copySource(location.file,line,index.id,index.contextId);setNotice('已复制位置');}catch{setNotice('复制失败，请复制上方文件路径。');}};
  const openEditor=async()=>{setNotice('');try{setNotice(await window.codeleader.openSource(location.file,line,savedEditor(),index.id,index.contextId)?'已在编辑器中打开':'没找到编辑器，已复制位置');}catch{try{await window.codeleader.copySource(location.file,line,index.id,index.contextId);setNotice('没找到编辑器，已复制位置');}catch{setNotice('复制失败，请复制上方文件路径。');}}};
  const current=useRef({index,onNavigate,location,stale,playback});current.current={index,onNavigate,location,stale,playback};
  const jump=()=>{
    const state=current.current;const selection=editor.current?.getSelection();const pos=selection&&!selection.isEmpty()?selection.getStartPosition():editor.current?.getPosition();if(!pos||state.stale){setError('源码已变化，请重新分析后定位。');return;}
    const p={line:pos.lineNumber-1,character:pos.column-1};
    const relation=state.index.relations.filter(r=>['HTTP','CALLS'].includes(r.type)&&r.locations.some(l=>l.file===state.location.file&&contains(l.range,p))).sort((a,b)=>Number(b.type==='HTTP'&&!!b.to)-Number(a.type==='HTTP'&&!!a.to))[0];
    const symbol=state.index.symbols.filter(s=>s.file===state.location.file&&contains(s.range,p)).sort((a,b)=>b.range.start.line-a.range.start.line)[0];
    if(relation?.to)state.onNavigate(relation.to);else if(relation)setError(relation.reason||'调用目标未解析。');else if(symbol)state.onNavigate(symbol.id);else setError('当前位置没有可识别的定义或调用。');
  };
  useEffect(()=>{
    monaco.editor.defineTheme('codeleader',{base:'vs-dark',inherit:true,rules:[],colors:{'editor.background':uiTokens.color["compat-287"],'editor.foreground':uiTokens.color["compat-469"],'editorLineNumber.foreground':uiTokens.color["compat-470"],'editorLineNumber.activeForeground':uiTokens.color["compat-471"],'editor.selectionBackground':uiTokens.color["compat-472"],'editor.lineHighlightBackground':uiTokens.color["compat-473"],'editorCursor.foreground':uiTokens.color["compat-474"]}});
    const instance=monaco.editor.create(host.current!,{value:'',language:'plaintext',theme:'codeleader',readOnly:true,domReadOnly:true,automaticLayout:true,minimap:{enabled:false},fontFamily:uiTokens.font.mono,fontSize:parseFloat(uiTokens.font.code),lineHeight:21,padding:{top:18},scrollBeyondLastLine:false,renderLineHighlight:'line',overviewRulerLanes:0,wordWrap:'off',lineNumbersMinChars:3,contextmenu:false,folding:true,stickyScroll:{enabled:false}});
    editor.current=instance;decorations.current=instance.createDecorationsCollection();
    const noteWidth=()=>host.current?.style.setProperty('--source-note-width',`${instance.getLayoutInfo().contentWidth}px`);noteWidth();
    const layoutListener=instance.onDidLayoutChange(noteWidth);
    instance.onDidChangeCursorPosition(e=>setLine(e.position.lineNumber));
    instance.onMouseDown(event=>{if(!event.target.element?.closest('.source-runtime-value'))return;const line=event.target.position?.lineNumber,notes=current.current.playback?.notes.filter(note=>note.line===line);if(line&&notes?.length)setExpandedValue({line,text:notes.map(noteFull).join('\n\n')});});
    const action=instance.addAction({id:'codeleader.locate',label:'在图中定位',keybindings:[monaco.KeyMod.CtrlCmd|monaco.KeyCode.Enter],run:jump});
    return()=>{layoutListener.dispose();action.dispose();instance.getModel()?.dispose();instance.dispose();};
  },[]);
  useEffect(()=>{
    let active=true;setError('');setLoaded('');setExpandedValue(undefined);setNotice('');
    window.codeleader.source(location.file,index.id,index.contextId).then(result=>{
      if(!active||!editor.current)return;setStale(result.stale);
      const old=editor.current.getModel();const language=location.file.endsWith('.java')?'java':location.file.endsWith('.py')?'python':/\.tsx?$/.test(location.file)?'typescript':/\.jsx?$/.test(location.file)?'javascript':/\.(vue|html)$/.test(location.file)?'html':location.file.endsWith('.css')?'css':'plaintext';
      editor.current.setModel(monaco.editor.createModel(result.text,language));old?.dispose();setLoaded(location.file);
    }).catch(e=>active&&setError(String(e)));
    return()=>{active=false;};
  },[location.file,index.createdAt]);
  useEffect(()=>{
    if(loaded!==location.file||!editor.current)return;setExpandedValue(undefined);
    editor.current.updateOptions({wordWrap:playback?'on':'off',fontSize:playback?13:12,lineHeight:playback?23:21});
    const r=playback?.active.range||location.range,range=new monaco.Range(r.start.line+1,r.start.character+1,r.end.line+1,r.end.character+1),items:monaco.editor.IModelDeltaDecoration[]=[];
    if(playback&&!stale){
      items.push({range,options:{className:playback.failed?(playback.precise?'source-error-line':'source-error-method'):playback.precise?'source-execution-line':'source-execution-method',isWholeLine:true,linesDecorationsClassName:playback.failed?'source-error-gutter':'source-execution-gutter'}});
      const grouped=new Map<number,typeof playback.notes>();for(const note of playback.notes)grouped.set(note.line,[...grouped.get(note.line)||[],note]);
      const model=editor.current.getModel()!;
      if(playback.browserSteps)for(const [line,values]of grouped){if(line<1||line>model.getLineCount())continue;const full=values.map(noteFull).join(' · '),single=values.map(note=>note.summary||noteFull(note)).join(' · ').replace(/[\r\n\t]+/g,' '),content='  '+(single.length>150?single.slice(0,149)+'…':single);items.push({range:new monaco.Range(line,model.getLineMaxColumn(line),line,model.getLineMaxColumn(line)),options:{showIfCollapsed:true,after:{content,inlineClassName:'source-runtime-value',cursorStops:monaco.editor.InjectedTextCursorStops.None},hoverMessage:{value:full.replace(/([\\`*_{}[\]()#+.!<>|])/g,'\\$1'),isTrusted:false,supportHtml:false}}});}
      editor.current.setPosition({lineNumber:r.start.line+1,column:1});
    }else{items.push({range,options:{className:'source-evidence',isWholeLine:false,linesDecorationsClassName:'source-gutter'}});editor.current.setSelection(range);}
    editor.current.changeViewZones(accessor=>{
      for(const id of zones.current)accessor.removeZone(id);zones.current=[];
      if(!playback||stale||playback.browserSteps)return;
      const model=editor.current!.getModel()!,returns:number[]=[];
      for(let line=location.range.start.line+1;line<=Math.min(model.getLineCount(),location.range.end.line+1);line++)if(/^\s*return\b/.test(model.getLineContent(line)))returns.push(line);
      for(const note of playback.notes){const line=note.label==='返回'&&returns.length===1?returns[0]:note.line;if(line<1||line>model.getLineCount())continue;
        const full=note.label==='入参'&&isObject(note.value)?'入参 '+Object.entries(note.value).map(([key,value])=>`${key}=${fullValue(value)}`).join(' '):noteFull(note),single=full.replace(/[\r\n\t]+/g,' '),node=document.createElement('div'),inner=document.createElement('div'),text=document.createElement('span');node.className='source-note-row';inner.className='source-note-inner';node.append(inner);node.dataset.line=String(line);text.className='source-note-text';text.textContent=single.length>80?single.slice(0,80)+'…':single;text.title=full;inner.append(text);
        if(single.length>80){const button=document.createElement('button'),expand=()=>setExpandedValue({line,text:noteFull(note)});button.textContent='展开';button.setAttribute('aria-label',`展开第 ${line} 行的${note.label}`);button.onclick=expand;button.onpointerdown=event=>{event.preventDefault();event.stopPropagation();expand();};inner.append(button);}
        zones.current.push(accessor.addZone({afterLineNumber:line,heightInLines:1,domNode:node,suppressMouseDown:true}));
      }
    });
    decorations.current?.set(items);editor.current.revealRangeInCenterIfOutsideViewport(range);setLine(r.start.line+1);
  },[loaded,stale,location,playback]);
  const name=location.file.split('/').at(-1),role=sourceRole(index,location),browserSteps=playback?.browserSteps;
  return <aside className="source-panel" data-source-step={playback?.stepId} data-source-precise={playback?.precise} data-source-error={playback?.failed}>{!embedded&&<div className="source-heading"><span><Code2 size={15}/>源码证据</span><button onClick={onClose} title="关闭源码侧栏"><X size={16}/></button></div>}<div className="source-file" title={location.file}>{role&&<span className="source-role">{role}</span>}<strong>{name}</strong><span className="readonly">只读</span>{playback&&<span className="source-playback-position">{browserSteps?`第 ${browserSteps.sent} 步发出 · ${browserSteps.received?`第 ${browserSteps.received} 步收到`:'尚未收到'}`:`第 ${playback.step} 步`}</span>}</div><div className="source-path" title={location.file}>{location.file}</div><div className="source-actions"><button onClick={()=>void openEditor()}>在编辑器中打开</button><button onClick={()=>void copyPosition()}>复制位置</button></div>{notice&&<p className="source-notice" role="status">{notice}</p>}{(error||stale)&&<div className="source-warning"><AlertCircle size={14}/>{error||'源码已变化，请重新分析后继续查看。'}</div>}<div ref={host} className="editor-host" data-testid="source-editor"/>{expandedValue&&<section className="source-values-popover" aria-label="行内值全文"><header><strong>第 {expandedValue.line} 行</strong><button onClick={()=>setExpandedValue(undefined)}>关闭</button></header><pre>{expandedValue.text}</pre></section>}<div className="source-footer"><span>第 {line} 行</span><button onClick={jump}><Crosshair size={13}/>在图中定位 <ChevronRight size={12}/></button></div></aside>;
}
