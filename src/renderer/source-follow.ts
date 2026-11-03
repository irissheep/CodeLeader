import type {ExecutionSession,SafeValue} from '../shared/execution';
import type {Location,ProjectIndex,SymbolInfo} from '../shared/model';
import {callVisibility,type ReplayCall,type ReplayState} from '../runtime/replay';
import {exceptionChain,recordedFrames,type RecordedFrame} from '../runtime/exception-details';
import {fullValue,visibleValue,valueLimits,bodyValue,isObject} from './execution-data';

export interface SourceNote {line:number;label:string;value:SafeValue;notice?:string;summary?:string;}
export interface SourcePlayback {stepId:string;step:number;location:Location;active:Location;precise:boolean;failed:boolean;notes:SourceNote[];browserSteps?:{sent:number;received?:number};}
const base=(file:string)=>file.replace(/\\/g,'/').split('/').at(-1);
function matchingFrame(frames:RecordedFrame[],symbol:SymbolInfo,record:ExecutionSession){
 const point=record.plan.points.find(point=>point.symbolId===symbol.id);
 return frames.find(frame=>frame.method===symbol.name&&base(frame.file)===base(symbol.file)&&(!frame.className||frame.className===point?.owner)&&frame.line>=symbol.range.start.line+1&&frame.line<=symbol.range.end.line+1);
}
function stack(call:ReplayCall,returned=true){return recordedFrames(call.span?.attributes['codeleader.stack']).concat(returned?exceptionChain(call.error)[0]?.stack||[]:[]);}
export function followingSource(index:ProjectIndex,record:ExecutionSession,state:ReplayState,selected:ReplayCall):SourcePlayback|undefined{
 const step=state.model.steps[state.model.positions[state.cursor]],position=state.model.positions[state.cursor],seen=new Set<string>();let call:ReplayCall|undefined=selected;
 while(call&&call.kind!=='method'&&call.parentId&&!seen.has(call.id)){seen.add(call.id);call=state.model.byCall[call.parentId];}
 const symbol=(call?.span?.versionMatch?index.symbols.find(symbol=>symbol.id===call?.span?.symbolId):undefined)||(selected.span?.versionMatch?index.symbols.find(symbol=>symbol.id===selected.span?.symbolId):undefined);
 if(!symbol){
  const location=selected.kind==='browser'?state.model.request.initiator?.find(item=>item.location)?.location:undefined;
  if(!location)return;
  const shown=callVisibility(state,selected.id),notes:SourceNote[]=[],line=location.range.start.line+1,request=state.model.request;
  const add=(label:string,value:SafeValue|undefined,summary?:string)=>{if(value!==undefined)notes.push({line,label,value:bodyValue(visibleValue(value,state.display))!,summary,notice:valueLimits(value).map(limit=>limit.message).join(' · ')||undefined});};
  const input=bodyValue(visibleValue(selected.input,state.display)),output=bodyValue(visibleValue(selected.output,state.display));
  if(shown.reached)add('→ 请求体',selected.input,isObject(input)?`→ 请求体 {${Object.keys(input).join(', ')}}`:undefined);
  if(shown.returned&&request.status!==undefined)add(`← ${request.status}`,selected.output,`← ${request.status}${isObject(output)?` · ${Object.keys(output).length} 个字段`:Array.isArray(output)?` · ${output.length} 项`:''}`);
  return {stepId:step.id,step:position+1,location,active:location,precise:true,failed:step.callId===selected.id&&step.exception,notes,browserSteps:{sent:state.model.positions[selected.enterId]+1,received:selected.returnId?state.model.positions[selected.returnId]+1:undefined}};
 }
 const frame=matchingFrame(stack(selected,callVisibility(state,selected.id).returned),symbol,record),location={file:symbol.file,range:symbol.range};
 const active=frame?{file:symbol.file,range:{start:{line:frame.line-1,character:0},end:{line:frame.line-1,character:1}}}:location;
 const notes:SourceNote[]=[],shown=callVisibility(state,call!.id),head=symbol.selection.start.line+1,tail=symbol.range.end.line+(symbol.range.end.character?1:0);
 const note=(line:number,label:string,value:SafeValue|undefined)=>{if(value!==undefined)notes.push({line,label,value:visibleValue(value,state.display)!,notice:valueLimits(value).map(limit=>limit.message).join(' · ')||undefined});};
 if(call?.kind==='method'&&shown.reached)note(head,'入参',call.input);
 if(call?.kind==='method'&&shown.returned&&!call.error)note(Math.max(head,tail),'返回',call.output);
 // The allowed method-wide fallback has only the head and tail values.
 if(frame)for(const id of call!.children){const child=state.model.byCall[id];if(child.error||!callVisibility(state,id).returned||child.output===undefined)continue;const caller=matchingFrame(stack(child),symbol,record);if(caller)note(caller.line,'→ 返回',child.output);}
 return {stepId:step.id,step:position+1,location,active,precise:!!frame,failed:step.callId===selected.id&&step.exception,notes};
}
export const noteFull=(note:SourceNote)=>`${note.label} ${fullValue(note.value)}${note.notice?' · '+note.notice:''}`;
