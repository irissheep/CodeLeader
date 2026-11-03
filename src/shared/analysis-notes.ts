import type {Location,ProjectIndex} from './model';

export interface NoteEvidence {location:Location;label:string}
export interface MissingWebNotes {
 unitId:string;name:string;framework:string;basis:NoteEvidence[];files:string[];
 reasons:{text:string;evidence:NoteEvidence[]}[];
}
export interface AddressVariable {
 name:string;state:'missing'|'unresolved'|'commented';text:string;evidence:NoteEvidence[];
}
export interface MissingAddressNotes {
 unitId:string;count:number;summary?:string;
 calls:{id:string;method:string;address:string;location:Location;variables:AddressVariable[]}[];
}
export interface AnalysisNotes {
 projectId:string;version:string;web:MissingWebNotes[];addresses:MissingAddressNotes[];
 partial:{id:string;text:string;impact:string;count:number;evidence:NoteEvidence[]}[];
 unreadFiles:string[];
}
export const analysisNotesKey=(index:ProjectIndex)=>[index.id,index.contextId,index.createdAt,index.status,index.diagnostics.length,index.files.length,index.frontendFiles?.length,index.frontend?.httpCalls.length].join(':');
export function webNotesText(note:MissingWebNotes){
 const at=(item:NoteEvidence)=>`${item.location.file}:${item.location.range.start.line+1}`;
 return [`应用：${note.name}`,`识别到 ${note.framework}`,`来源：${note.basis.map(at).join('、')}`,
  '没识别出接口',`已扫描 ${note.files.length} 个路由/视图文件`,...note.files,
  ...note.reasons.map(r=>`可能原因：${r.text}${r.evidence.length?'（'+r.evidence.map(at).join('、')+'）':''}`)].join('\n');
}
