export interface ExecutionScope {projectId:string;sessionId?:string;contextId?:string}
export const projectPath=(root:string)=>root.replaceAll('\\','/').replace(/\/+$/,'').toLowerCase();
export function belongsToProject(value:{projectId:string;projectRoot:string},project:{id:string;root:string}){
  return value.projectId===project.id&&projectPath(value.projectRoot)===projectPath(project.root);
}
export function validScope(scope:ExecutionScope|undefined,projectId:string|undefined,sessionId?:string){
  return !!scope&&scope.projectId===projectId&&(!sessionId||scope.sessionId===sessionId);
}
