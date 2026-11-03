import type { Location } from './model';
export type SafeValue=null|boolean|number|string|SafeValue[]|{[key:string]:SafeValue};
export type CapturePolicy='structure'|'synthetic'|'raw';
export interface OperationClick {x:number;y:number;rect:{x:number;y:number;width:number;height:number};viewport:{width:number;height:number};text:string;pageTime:number;pageEpoch:number;}
export interface OperationThumbnail {name?:string;status:'saved'|'unavailable'|'disabled';width?:number;height?:number;bytes?:number;capturedAt?:number;reason?:string;}
export interface BrowserOperation {id:string;documentId:string;kind:'open'|'click'|'submit'|'navigation'|'input';time:number;url:string;label:string;source?:string;number?:number;observedAt?:number;click?:OperationClick;thumbnail?:OperationThumbnail;feedback?:'click'|'no-request';}
export interface ObservationPoint {
  id:string;symbolId:string;language:'java'|'python';owner:string;method:string;parameters:string[];parameterNames:string[];
  module?:string;file:string;hash:string;location:Location;serviceId?:string;binding?:'function'|'method';
  construction?:{fields:Record<string,string>;location:Location};
}
export interface ObservationPlan {
  excludedUrls?:string;
  unitRoots?:{id:string;root:string;language:string;serviceId?:string}[];
  pythonModules?:string[];
  version:1;projectId:string;sourceVersion:string;points:ObservationPoint[];
  capturePolicy?:CapturePolicy;
  routes:{method:string;path:string;symbolId?:string;serviceId?:string;location?:Location}[];
  dtoTypes:string[];budgets:{depth:number;methods:number;perEntry:number;invocations:number};limitations:string[];
  resources?:{id:string;from:string;sql?:string;location?:Location;operation:string;kind?:string}[];
  backgroundReaders?:{symbolId:string;name:string;resources:string[];location:Location}[];
}
export interface RecordedSpan {
  traceId:string;spanId:string;parentSpanId?:string;name:string;kind:number;service:string;
  start:string;end:string;status:'ok'|'error'|'pending';attributes:Record<string,SafeValue>;
  links:{traceId:string;spanId:string}[];symbolId?:string;location?:Location;versionMatch:boolean;
  input?:SafeValue;output?:SafeValue;error?:SafeValue;invocationId?:string;durationMs?:number;
  entityId?:string;mappingBasis?:string;
}
export interface BrowserRequest {
  other?:{kind:'asset'|'development'|'preflight'|'polling'|'framework';reason:string};
  id:string;traceId:string;spanId:string;method:string;url:string;page:string;start:number;end?:number;status?:number;error?:string;
  input?:SafeValue;output?:SafeValue;initiator?:{url:string;line:number;column:number;functionName?:string;location?:Location;sourceHash?:string}[];
  operationId?:string;operationCandidates?:string[];operationBasis?:string;
  background?:boolean;
  headers?:SafeValue;requestBody?:SafeValue;responseHeaders?:SafeValue;responseBody?:SafeValue;bodyReason?:string;
  resourceType?:string;finished?:'completed'|'failed'|'cancelled';
  responseObservedAt?:number;
  afterResponse?:AfterResponseWindow;
}
export interface AfterResponseCall {
  id:string;parentId:string;startOffsetMs?:number;endOffsetMs?:number;returnOnly?:boolean;asynchronous:boolean;completed:boolean;
}
export interface AfterResponseWindow {
  responseAt:number;lastActivityAt:number;deadline:number;closedAt?:number;reason?:'idle'|'limit'|'stopped';
  calls:AfterResponseCall[];
}
export interface StartupFailure {service:string;command:string;cwd:string;exitCode:number|null;output:string;reason?:string;logAvailable:boolean;port?:number;unitId?:string;owner?:{pid:number;name?:string};}
export interface ExecutionSession {
  contextId?:string;
  id:string;projectId:string;projectRoot:string;createdAt:string;stoppedAt?:string;state:'connecting'|'recording'|'stopped'|'failed';
  sourceVersion:string;frontendUrl:string;policy:CapturePolicy;plan:ObservationPlan;protocolVersion?:2;operations?:BrowserOperation[];
  spans:RecordedSpan[];requests:BrowserRequest[];dropped:number;bytes:number;warnings:string[];historical?:boolean;
  processes:{pid:number;role:string;startedAt:string}[];
  connectionStage?:string;
  thumbnailCapture?:boolean;
  operationVersion?:2;
  backgroundIdleSeconds?:number;
  startupFailure?:StartupFailure;
}
export interface ExecutionAPI {
  startup():Promise<import('./startup').StartupPlan>;
  confirmStartup(plan:import('./startup').StartupPlan):Promise<{token:string;plan:import('./startup').StartupPlan}>;
  forProject(projectId:string,sessionId?:string):ExecutionAPI;
  connection():Promise<{url:string;owned:boolean;environmentFile:string}>;
  configure(options:{url:string;owned:boolean}):Promise<void>;
  javaConnection():Promise<string>;
  current():Promise<ExecutionSession|undefined>;
  start(options:{url:string;policy:CapturePolicy;owned:boolean;startupToken?:string;thumbnails?:boolean;backgroundIdleSeconds?:number}):Promise<ExecutionSession>;
  stop():Promise<ExecutionSession|undefined>;
  stopEnvironment():Promise<void>;
  list():Promise<{id:string;createdAt:string;state:string;frontendUrl:string}[]>;
  open(id:string):Promise<ExecutionSession>;
  remove(id:string):Promise<void>;
  export(options:{hidden:boolean}):Promise<string>;
  bounds(bounds:{x:number;y:number;width:number;height:number;visible:boolean}):Promise<void>;
  reload():Promise<void>;
  onUpdate(fn:(session:ExecutionSession)=>void):()=>void;
  onOperation(fn:(operation:BrowserOperation)=>void):()=>void;
  thumbnail(operationId:string):Promise<string|undefined>;
  thumbnails(enabled:boolean):Promise<void>;
  backgroundIdle(seconds:number):Promise<void>;
  openStartupLog():Promise<void>;
  copyStartupLog():Promise<void>;
  suggestPort():Promise<number>;
  saveSetupFailure(failure:{service:string;command:string;cwd:string;output:string}):Promise<StartupFailure>;
  echoAnchor(anchor:{x:number;y:number;visible:boolean;operationId?:string;preview?:string;reducedMotion?:boolean}):Promise<void>;
}
