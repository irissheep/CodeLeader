import type { ExecutionSession } from '../shared/execution';
import type { ReplayAction, ReplayState } from '../runtime/replay';
import type {Location} from '../shared/model';
export interface ExecutionLayer {
  record?:ExecutionSession;state?:ReplayState;expandedDomain?:string;collapseAuto?:boolean;walkthroughInset?:number;layoutKey?:string;
  operation?:{id:string;marker:string;label:string;preview:string;pending:boolean;stale:boolean};
  dispatch:(action:ReplayAction)=>void;
  browser:()=>void;explore:(domainId?:string)=>void;inspect:(id:string)=>void;
  relation:(source:string,target:string)=>void;
  source?:(location:Location)=>void;
  viewport:(view:{x:number;y:number;zoom:number})=>void;cameraPause:()=>void;cameraResume:()=>void;
}
