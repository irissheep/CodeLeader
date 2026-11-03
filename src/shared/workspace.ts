export type WorkspaceState='scanning'|'found'|'empty'|'cancelled'|'error';
export interface WorkspaceProject {id:string;root:string;name:string;type:string;files:number;evidence:{file:string;line:number;description:string}[];duplicateOf?:string;selected:boolean}
export interface WorkspaceScan {requestId:number;root:string;state:WorkspaceState;directories:number;files:number;sourceFiles:number;skipped:{rule:string;reason:string;count:number}[];projects:WorkspaceProject[];sharedConfigs:string[];limit?:string;errors:{path:string;reason:string}[];elapsedMs:number}
