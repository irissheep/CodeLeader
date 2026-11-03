export type SourceEditor='vscode'|'idea';
export function editorURL(absolute:string,line:number,editor:SourceEditor){
  const file=absolute.replace(/\\/g,'/');
  return editor==='idea'?`idea://open?file=${encodeURIComponent(file)}&line=${line}`:`vscode://file/${encodeURI(file).replace(/[?#]/g,encodeURIComponent)}:${line}`;
}
