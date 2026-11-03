import type {ExecutionSession} from '../shared/execution';
import {primaryRequest,numberedOperations} from '../runtime/operation-flow';
import {replayAction,type ReplayAction,type ReplayState} from '../runtime/replay';

export type ReadingHold='playback'|'inspection'|'expansion'|'breakpoint'|'request';
export interface ExecutionViewing {following:boolean;hold?:ReadingHold;states:Record<string,ReplayState>}
export const initialViewing=(following=true):ExecutionViewing=>({following,states:{}});
export const liveFollowing=(session?:ExecutionSession)=>session?.state==='recording'&&!session.historical;
export const sessionViewing=(session:ExecutionSession)=>initialViewing(!session.historical&&['connecting','recording'].includes(session.state));
export function holdReading(view:ExecutionViewing,key:string,reason:ReadingHold):ExecutionViewing{
 const state=view.states[key];
 return {...view,hold:reason,states:state?{...view.states,[key]:{...state,playing:false}}:view.states};
}
export function viewingReplay(view:ExecutionViewing,key:string,action:ReplayAction):ExecutionViewing{
 const state=view.states[key];if(!state)return view;
 const next=replayAction(state,action),manual=action.type!=='tick'&&action.type!=='update';
 return {...view,hold:next.hit?'breakpoint':manual?(action.type==='inspect'?'inspection':'playback'):view.hold,states:{...view.states,[key]:next}};
}
export function resumeFollowing(view:ExecutionViewing,key:string,restoreCamera?:boolean):ExecutionViewing{
 const state=view.states[key];
 return {...view,following:true,hold:undefined,states:state?{...view.states,[key]:replayAction({...state,follow:restoreCamera??state.follow},{type:'play'})}:view.states};
}
export function latestOperationRequest(session:ExecutionSession,pins:Record<string,string>){
 for(const operation of [...numberedOperations(session)].reverse()){
  const pinned=session.requests.find(r=>r.id===pins[operation.id]&&r.operationId===operation.id);
  const request=pinned||primaryRequest(session,operation.id).request;
  if(request)return {operation,request};
 }
 return undefined;
}
