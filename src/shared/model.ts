export type Language = 'java' | 'python';
export type Position = { line: number; character: number };
export type Range = { start: Position; end: Position };
export type Location = { file: string; range: Range };
export type Resolution = 'resolved' | 'candidate' | 'unresolved';
export type RelationType = 'CALLS' | 'IMPORTS' | 'EXTENDS' | 'IMPLEMENTS' | 'HTTP' | 'READS' | 'WRITES' | 'INJECTS' | 'MAPS';
export interface Evidence {kind:'call'|'definition'|'assignment'|'config'|'declaration';location:Location;note:string}
export interface RuleInformation {kind:'branch'|'precondition'|'configuration'|'analysis'|'uncertainty';text:string;code?:string;location?:Location;branchGroup?:string;branch?:'then'|'else'}
export interface RuleEvidence {id:string;version:string;outcome:'unique'|'candidate'|'unknown';basis:Evidence[];conditions:string[];information?:RuleInformation[];configuration?:string;applicability?:'included'|'excluded'|'conditional';alternatives?:{conditions:string[];basis:Evidence[]}[]}
export interface Entity {
  id:string;kind:'service'|'domain'|'resource';name:string;summary:string;location?:Location;
  serviceId?:string;parentId?:string;sourceRoots?:string[];entryIds?:string[];
  resourceKind?:'database'|'table'|'vector'|'cache'|'queue'|'search'|'file'|'model'|'external';
  conditions?:string[];basis:Evidence[];discoveredOnly?:boolean;
}
export interface Configuration {id:string;name:string;kind:'defaults'|'compose';locations:Location[]}
export interface SymbolInfo {
  typeEvidence?:{annotations:string[];bases:string[];table?:boolean;staticOnly?:boolean;returns?:{type:string;annotations:string[]}[]};
  id: string; name: string; qualifiedName: string; signature: string;
  kind: 'class' | 'interface' | 'function' | 'method' | 'constructor';
  language: Language; module: string; file: string; parent?: string;
  range: Range; selection: Range; role?: string; routes: string[];
  declaration?: string; summary?:string; serviceId?:string; auxiliary?:boolean;
}
export interface EntryPoint {
  frameworkMapping?:{name:string;version:string;declaredVersions:string[];approximate:boolean;basis:Evidence[]};
  moduleName?:string;moduleParent?:{id:string;name:string;location:Location};
  pathEvidence?:{method:string;path:string;basis:Evidence[];defaults:boolean;issues:{location:Location;expression:string;reason:string}[];conditions:Location[];aliases?:{path:string;basis:Evidence[];issues:{location:Location;expression:string;reason:string}[]}[]};
  id:string; kind:'http'|'java-main'|'python-main'|'scheduled'; name:string; symbolId?:string;
  location:Location; group:string; owner:string; area:string; basis:string;
  status:Resolution; reason?:string;
}
export interface Relation {
  id: string; from: string; to?: string; target: string; type: RelationType;
  source: 'tree-sitter' | 'JavaSymbolSolver' | 'Pyright' | 'framework-rules' | 'TypeScript';
  status: Resolution; locations: Location[]; reason?: string;
  rule?:RuleEvidence; invocation?:'sync'|'async'|'scheduled'; auxiliary?:boolean;
  http?:{method:string;path:string;baseKey?:string;baseUrl?:string;serviceId?:string};
  data?:{operation:'read'|'write';table?:string;sql?:string};
}
export interface FileInfo {
  path: string; language: Language; module: string; hash: string; size: number;
  parsed?:boolean;
}
export interface Diagnostic { file?: string; message: string; severity: 'info' | 'warning' | 'error' }
export interface DiscoveryEvidence {
  source:'build'|'entry'|'dependency'|'configuration'|'connection'|'compose'|'import';
  location:Location; note:string; context?:string;
}
export interface BuildDeclaration {
  id:string; root:string; file:string; tool:'maven'|'gradle'|'npm'|'python';
  kind:'aggregator'|'module'|'package'; name:string; dependencies:string[]; basis:DiscoveryEvidence[];
  declaredDependencies:{name:string;basis:DiscoveryEvidence}[];
}
export interface ProjectUnit {
  id:string; root:string; kind:'application'|'library'|'frontend'|'tool';
  language:'java'|'python'|'javascript'; framework:string; buildIds:string[];
  usedBy:string[]; basis:DiscoveryEvidence[]; serviceId?:string;
}
export interface DiscoveredResource {
  id:string; engine:string; kind:'database'|'cache'|'queue'|'search'|'vector';
  unitIds:string[]; basis:DiscoveryEvidence[]; usages:{unitId:string;basis:DiscoveryEvidence[]}[];
  /** Discovery of an engine/capability, not proof of a shared instance or a runtime access. */
  identity:'engine';
}
export interface ProjectIndex {
  frontendLinks?:import('./frontend-links').FrontendLinks;
  frontend?:import('./frontend-model').FrontendModel;
  httpModules?:{id:string;name:string;parentId?:string;entryIds:string[];location:Location}[];
  buildDeclarations?:BuildDeclaration[];
  units?:ProjectUnit[];
  resources?:DiscoveredResource[];
  typeMappings?:{typeName:string;entityNames?:string[];location:Location}[];
  typeFiles?:{file:string;namespace:string;imports:Record<string,string>;importLocations?:Record<string,Location>;bindings:{name:string;callee:string}[];annotations:string[]}[];
  contextId?:string;
  sourceSets?:{path:string;role:'production'|'test';source:string;language?:Language}[];
  components?:{id:string;kind:'java'|'python'|'frontend';root:string;framework:string;location:Location;port?:number}[];
  frontendFiles?:{path:string;hash:string;size:number;language:'typescript'|'javascript'|'vue'|'html'|'css'}[];
  schema: 1 | 2; id: string; root: string; name: string; createdAt: string;
  status: 'structure' | 'analyzing' | 'complete' | 'partial' | 'failed' | 'cancelled';
  languages: Language[]; symbols: SymbolInfo[]; files: FileInfo[]; relations: Relation[];
  diagnostics: Diagnostic[]; versions: Record<string,string>; stale?: boolean;
  sourceRoots: string[]; jars: string[];
  entries?:EntryPoint[];
  entities?:Entity[]; configurations?:Configuration[]; configurationId?:string;
  inputs?:{path:string;hash:string;kind:'config';size:number}[];
  analysis?:{scanned:number;parsed:number;partialFiles:number;callPositions:number;semanticInternal:number;ruleUnique:number;external:number;implicit:number;candidate:number;unknown:number;excludedInitializations:number};
}
export interface Progress { phase: string; current: number; total: number }
export interface SourceResult { text: string; stale: boolean; file: string }
export interface ViewState {
  frontendTargets?:Record<string,import('./frontend-links').FrontendTarget>;
  dependencyScope?:'chain'|'module'|'project';
  dependencyEntryId?:string;
  exploration?:{serviceId?:string;domainId?:string;entryId?:string;stage:'interfaces'|'chain';base:ExplorationSnapshot;interfaces?:ExplorationSnapshot};
  cameraRevision?:number;
  locateRequest?:{id:string;token:number};
  level: 'main' | 'guide' | 'overview' | 'module' | 'file' | 'class' | 'function'; focus?: string; expanded: string[];
  positions: Record<string,{x:number;y:number}>;
  viewport: {x:number;y:number;zoom:number}; filter: 'all' | Language | 'frontend';
  source?: Location; selected?: string; query: string;
  direction?: 'both' | 'callers' | 'callees';
  entryId?:string; density?:'compact'|'detail'; showTests?:boolean;
  inspector?:'details'|'source'|'relations'|'analysis'|'connections'; relationIds?:string[]; panelWidth?:number;
  showAll?:boolean; relationFilter?:'calls'|'types'|'imports'|'all'; fullDependencies?:boolean;
  relationSelection?:string;
  reading?:{types?:string[];target?:string;scope?:string;isolate?:'relation'|'path';origin?:string;viewport?:{x:number;y:number;zoom:number};viewportWidth?:number};
}
export type ExplorationSnapshot=Pick<ViewState,'level'|'focus'|'positions'|'viewport'|'expanded'|'reading'|'selected'|'entryId'|'direction'|'filter'|'density'|'showAll'|'relationSelection'>;
export interface CodeLeaderAPI {
  execution:import('./execution').ExecutionAPI;
  chooseProject(): Promise<string | undefined>;
  analyze(root: string, options?: { sourceRoots: string[]; jars: string[]; configuration?:string;projectRoots?:string[];sharedConfigs?:string[] }): Promise<void>;
  discoverWorkspace(root:string,requestId:number):Promise<import('./workspace').WorkspaceScan>;
  cancelDiscovery():Promise<void>;
  onWorkspaceProgress(fn:(scan:import('./workspace').WorkspaceScan)=>void):()=>void;
  chooseSource():Promise<string|undefined>;
  cancel(): Promise<void>;
  source(file: string,projectId?:string,contextId?:string): Promise<SourceResult>;
  analysisNotes(projectId?:string,contextId?:string):Promise<import('./analysis-notes').AnalysisNotes>;
  copyAnalysisNotes(unitId:string,projectId?:string,contextId?:string):Promise<void>;
  openSource(file:string,line:number,editor:import('./source-editor').SourceEditor,projectId?:string,contextId?:string):Promise<boolean>;
  copySource(file:string,line:number,projectId?:string,contextId?:string):Promise<void>;
  checkStale(projectId?:string,contextId?:string): Promise<boolean>;
  chooseJavaPaths(): Promise<{sourceRoots:string[];jars:string[]} | undefined>;
  saveView(view: ViewState,projectId?:string,contextId?:string): Promise<void>;
  loadView(projectId?:string,contextId?:string): Promise<ViewState | undefined>;
  setFrontendTargets(targets:Record<string,import('./frontend-links').FrontendTarget>,projectId?:string,contextId?:string):Promise<void>;
  onIndex(fn: (index:ProjectIndex)=>void): ()=>void;
  onProgress(fn: (progress:Progress)=>void): ()=>void;
  onError(fn: (message:string)=>void): ()=>void;
  droppedPath(file: File): string;
  runtime(): Promise<Record<string,unknown>>;
  windowFocused():Promise<boolean>;
  onWindowFocus(fn:(focused:boolean)=>void):()=>void;
}
declare global { interface Window { codeleader: CodeLeaderAPI } }
export function contains(range: Range, p: Position) {
  const compare = (a:Position,b:Position) => a.line - b.line || a.character - b.character;
  return compare(range.start,p) <= 0 && compare(p,range.end) < 0;
}
