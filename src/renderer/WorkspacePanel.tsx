import {useEffect,useState} from 'react';
import type {WorkspaceScan} from '../shared/workspace';
import {OverlayShell} from './OverlayShell';
import './workspace.css';

export default function WorkspacePanel({scan,onStart,onCancel,onChoose,onChooseFile}:{scan:WorkspaceScan;onStart:(ids:string[])=>void;onCancel:()=>void;onChoose:()=>void;onChooseFile:()=>void}){
 const [selected,setSelected]=useState<string[]>([]);
 useEffect(()=>{if(scan.state==='found')setSelected(scan.projects.filter(project=>project.selected).map(project=>project.id));},[scan.requestId,scan.state]);
 const scanning=scan.state==='scanning';
 const title=scanning?'正在扫描目录':scan.state==='found'?`找到 ${scan.projects.length} 个项目`:scan.state==='cancelled'?'已取消扫描':scan.state==='error'?'没能读取这个目录':'没有找到项目';
 const footer=scanning?<div className="overlay-secondary"><button className="button" onClick={onCancel}>取消</button></div>:<>{scan.state==='found'&&<button className="button primary overlay-primary" disabled={!selected.length} onClick={()=>onStart(selected)}>开始分析</button>}<div className="overlay-secondary"><button className="button" onClick={onChoose}>选择其它目录</button><button className="button" onClick={onChooseFile}>选择文件</button></div></>;
 return <OverlayShell id="workspace" title={title} onClose={onCancel} footer={footer}>
  <p>已查看 {scan.directories} 个文件夹、{scan.files} 个文件，发现 {scan.projects.length} 个项目。</p>
  {scan.limit&&<p role="status">{scan.limit}，以下是已经找到的内容。</p>}
  {scan.state==='empty'&&<p>找到 {scan.sourceFiles} 个源码文件，但没有找到可识别的项目声明或入口。可以选择包含项目声明的目录，或选择一个源码文件。</p>}
  {scan.state==='error'&&<p>这个目录暂时无法读取，请检查位置和访问权限后重试。</p>}
  {!!scan.projects.length&&<div className="workspace-projects">{scan.projects.map(project=><label className="workspace-project" key={project.id}>
   {!scanning&&<input type="checkbox" checked={selected.includes(project.id)} onChange={event=>setSelected(previous=>event.target.checked?[...previous,project.id]:previous.filter(id=>id!==project.id))}/>}
   <span><strong>{project.name}</strong><small>{project.type} · {project.files} 个文件{project.duplicateOf?' · 疑似副本，默认不加入':''}</small><small>{project.evidence.map(e=>`${e.file}:${e.line} ${e.description}`).join(' · ')}</small></span>
  </label>)}</div>}
  <details><summary>查看扫描过程</summary><p>源码候选 {scan.sourceFiles} 个；已跳过的目录或文件：</p>{scan.skipped.length?scan.skipped.map(item=><p key={item.rule}>{item.rule} · {item.count} 处 · {item.reason}</p>):<p>没有跳过的项目。</p>}{scan.errors.map((error,i)=><p key={i}>{error.path}：无法读取</p>)}</details>
 </OverlayShell>;
}
