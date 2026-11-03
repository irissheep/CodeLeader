import type {ProjectIndex,Location} from '../shared/model';
import type {SourceEditor} from '../shared/source-editor';
export function savedEditor():SourceEditor{try{return localStorage.getItem('codeleader.editor')==='idea'?'idea':'vscode';}catch{return 'vscode';}}
export function saveEditor(editor:SourceEditor){try{localStorage.setItem('codeleader.editor',editor);}catch{}}
export function sourceRole(index:ProjectIndex,location:Location){
 const symbols=index.symbols.filter(symbol=>symbol.file===location.file&&symbol.range.start.line<=location.range.start.line&&symbol.range.end.line>=location.range.start.line);
 if(symbols.some(symbol=>/Controller$/.test(symbol.name)||/@(?:RestController|Controller)\b/.test(symbol.declaration||'')))return '入口';
 if(symbols.some(symbol=>/Service$/.test(symbol.name)||/@Service\b/.test(symbol.declaration||'')))return '业务';
 if(symbols.some(symbol=>/(?:Repository|Mapper|Dao|DAO)$/.test(symbol.name)||/@(?:Repository|Mapper)\b/.test(symbol.declaration||'')))return '数据访问';
 if(index.frontendFiles?.some(file=>file.path===location.file)&&/(?:^|\/)(?:api|requests?)(?:\.[cm]?[jt]sx?|\/[^/]+\.[cm]?[jt]sx?)$/i.test(location.file))return '前端接口';
 return undefined;
}
