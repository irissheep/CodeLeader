import type {ProjectIndex} from './model';
import workspacePolicy from '../../resources/workspace-discovery-policy.json';
export const sourcePath=(file:string)=>file.replaceAll('\\','/').replace(/^\.\//,'').replace(/\/+$/,'').toLowerCase();
export function isTestFile(file:string,index?:Pick<ProjectIndex,'sourceSets'>){
  const normalized=sourcePath(file),language=normalized.endsWith('.java')?'java':normalized.endsWith('.py')?'python':undefined,sets=index?.sourceSets?.filter(root=>(!root.language||root.language===language)&&(sourcePath(root.path)==='.'||normalized===sourcePath(root.path)||normalized.startsWith(sourcePath(root.path)+'/'))).sort((a,b)=>b.path.length-a.path.length);
  if(sets?.length)return sets[0].role==='test';
  if(language==='java'&&new RegExp(workspacePolicy.javaRolePatterns.production).test(normalized))return false;
  if(language==='java'&&new RegExp(workspacePolicy.javaRolePatterns.test).test(normalized))return true;
  if(normalized.endsWith('.py'))return /(?:^|\/)(?:tests?|conftest\.py)(?:\/|$)|(?:^|\/)test_[^/]+\.py$|_test\.py$/.test(normalized);
  if(normalized.endsWith('.java'))return /^(?:test|tests)\//.test(normalized)||/Tests?\.java$/.test(file.replaceAll('\\','/'));
  return /(?:^|\/)(?:__tests__|tests?)(?:\/|$)|\.(?:test|spec)\.[cm]?[jt]sx?$/.test(normalized);
}
