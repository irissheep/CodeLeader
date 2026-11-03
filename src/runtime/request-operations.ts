import type {BrowserOperation,BrowserRequest,ExecutionSession} from '../shared/execution';
export const operationWindow=1500;
type Frame={functionName?:string;asyncDepth?:number};
type Candidate={operation:BrowserOperation;times:number[];timer:ReturnType<typeof setTimeout>};
/** Candidates are transient. A request with an eligible callback marker admits the operation. */
export class RequestOperations {
 private candidates=new Map<string,Candidate>();private latest?:string;private active=true;
 constructor(private record:ExecutionSession,private confirmed:(operation:BrowserOperation)=>void,private expired:(operation:BrowserOperation)=>void){
  record.operationVersion=2;
 }
 observe(operation:BrowserOperation){
  if(!this.active||!['click','submit','input'].includes(operation.kind))return false;
  this.latest=operation.id;const previous=this.candidates.get(operation.id);
  if(previous){clearTimeout(previous.timer);previous.operation.time=operation.time;previous.operation.observedAt=operation.observedAt;previous.operation.label=operation.label;}
  const candidate={operation:previous?.operation||operation,times:[...previous?.times||[],operation.time].slice(-64),timer:setTimeout(()=>this.expire(operation.id),operationWindow)};
  this.candidates.set(operation.id,candidate);
  while(this.candidates.size>64){const id=this.candidates.keys().next().value!;clearTimeout(this.candidates.get(id)!.timer);this.candidates.delete(id);}
  return !previous;
 }
 expire(id:string){const candidate=this.candidates.get(id);if(!this.active||!candidate)return;
  if(candidate.operation.kind==='click'&&!candidate.operation.number&&id===this.latest)this.expired(candidate.operation);
 }
 associate(request:BrowserRequest,frames:Frame[]){
  if(!this.active||request.operationId||request.other&&request.other.kind!=='polling')return;
  const valid=(id:string)=>{const candidate=this.candidates.get(id);return !!candidate&&(candidate.times.some(time=>request.start>=time&&request.start-time<=operationWindow)||!!candidate.operation.number&&this.record.requests.some(previous=>previous.operationId===id&&previous.end!==undefined&&request.start>=previous.end&&request.start-previous.end<=operationWindow));};
  const markers=(items:Frame[])=>[...new Set(items.map(frame=>String(frame.functionName||'')).filter(name=>name.startsWith('__cl_operation_')).map(name=>name.slice('__cl_operation_'.length)))].filter(valid);
  const direct=markers(frames.filter(frame=>!frame.asyncDepth)),ids=direct.length?direct:markers(frames);
  request.operationCandidates=ids;request.background=true;
  if(frames.some(frame=>String(frame.functionName||'').startsWith('__cl_background_'))||ids.length!==1)return;
  this.admit(request,this.candidates.get(ids[0])!.operation,direct.length?'当前回调标记及 1500ms 窗口':'异步回调标记及 1500ms 窗口');
 }
 navigation(request:BrowserRequest,reason:string){
  if(!this.active||request.operationId||request.other&&request.other.kind!=='polling'||!['anchorClick','formSubmissionGet','formSubmissionPost'].includes(reason))return;
  const candidate=this.latest&&this.candidates.get(this.latest);if(!candidate||!candidate.times.some(t=>request.start>=t&&request.start-t<=operationWindow))return;
  this.admit(request,candidate.operation,'浏览器报告的链接/表单跳转，与页面动作相邻；不证明因果');
 }
 private admit(request:BrowserRequest,operation:BrowserOperation,basis:string){
  const operations=this.record.operations||(this.record.operations=[]);
  request.operationId=operation.id;request.background=false;request.operationBasis=basis;request.other=undefined;
  if(!operations.some(item=>item.id===operation.id)){
   operation.number=operations.length+1;operations.push(operation);this.confirmed(operation);
  }
 }
 stop(){this.active=false;for(const candidate of this.candidates.values())clearTimeout(candidate.timer);this.candidates.clear();}
}
