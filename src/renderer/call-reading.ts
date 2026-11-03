import {callVisibility,type ReplayModel,type ReplayState} from '../runtime/replay';
export function rowProgress(state:ReplayState,ids:string[]){
 const current=state.model.steps[state.model.positions[state.cursor]]?.callId;
 const contains=(id:string)=>{let parent:string|undefined=current;const seen=new Set<string>();while(parent&&!seen.has(parent)){if(parent===id)return true;seen.add(parent);parent=state.model.byCall[parent]?.parentId;}return false;};
 const reached=ids.some(id=>callVisibility(state,id).reached||contains(id)),returned=ids.every(id=>callVisibility(state,id).returned);
 return {current:ids.includes(current),reached,returned,active:reached&&!returned&&ids.some(contains)};
}
export function orderNotice(model:ReplayModel,id:string):string|undefined{
 const call=model.byCall[id];if(!call)return;
 if(call.parallel)return '这两步是并行的';
 if(!call.parentId)return;
 const range=(other:string)=>{const c=model.byCall[other],a=model.steps[model.positions[c.enterId]]?.instant,b=c.returnId&&model.steps[model.positions[c.returnId]]?.instant;return a&&b&&a.clock===b.clock?{clock:a.clock,start:BigInt(a.ns),end:c.returnId===c.enterId&&c.span&&/^\d+$/.test(c.span.end)?BigInt(c.span.end):BigInt(b.ns)}:undefined;};
 const own=range(id);
 for(const sibling of model.byCall[call.parentId]?.children||[]){if(sibling===id)continue;const other=range(sibling);
  if(own&&other&&own.clock===other.clock){if(own.start<other.end&&other.start<own.end)return '这两步的时间重叠';}
  else if(call.uncertain&&model.byCall[sibling].uncertain)return '这两步的先后没录清楚';
 }
}
