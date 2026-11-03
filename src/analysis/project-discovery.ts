import type {StructureResult} from './structure';
import {isTestFile} from '../shared/source-roles';
import path from 'node:path';
import workspacePolicy from '../../resources/workspace-discovery-policy.json';
const normalize=(value:string)=>value.replaceAll('\\','/').replace(/^\.\//,'').replace(/\/$/,'');
export function discoverProject(result:StructureResult){
  const {index,configs}=result;index.components=[];index.sourceSets=[];
  for(const [file,text] of configs){
    const root=file.includes('/')?file.slice(0,file.lastIndexOf('/')):'';
    const location={file,range:{start:{line:0,character:0},end:{line:0,character:1}}};
    const addRoot=(value:string,role:'production'|'test')=>{
      value=value.replaceAll('${project.basedir}',path.join(index.root,root)).replaceAll('${basedir}',path.join(index.root,root));
      const absolute=path.resolve(index.root,root,value),relative=path.relative(index.root,absolute);
      if(value.includes('${')||relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative)){index.diagnostics.push({file,message:'有源码目录需要进一步确认，已保留实际发现的文件。',severity:'warning'});return;}
      index.sourceSets!.push({path:normalize(relative)||'.',role,source:file,language:'java'});
    };
    if(/(?:^|\/)(?:pom\.xml|build\.gradle(?:\.kts)?)$/.test(file)){
      const framework=/spring-boot|org\.springframework\.boot/.test(text)?'Spring Boot':'Java';
      index.components.push({id:`component:java:${root}`,kind:'java',root,framework,location});
      for(const source of workspacePolicy.javaSourceSets)addRoot(source.path,source.role as 'production'|'test');
      for(const m of text.matchAll(/<(sourceDirectory|testSourceDirectory)>\s*([^<]+)\s*<\//g))addRoot(m[2].trim(),m[1]==='sourceDirectory'?'production':'test');
      for(const m of text.matchAll(/\b(main|test)\s*\{[^}]*?(?:java\.)?srcDirs?\s*(?:=|\()?\s*\[?([^}\n]+)/g))for(const value of m[2].matchAll(/["']([^"']+)["']/g))addRoot(value[1],m[1]==='main'?'production':'test');
    }
    if(/(?:^|\/)package\.json$/.test(file))try{
      const pkg=JSON.parse(text),deps={...pkg.dependencies,...pkg.devDependencies},framework=deps.vite?'Vite':deps['@vue/cli-service']?'Vue CLI':deps.vue?'Vue':deps.react?'React':undefined;
      if(framework)index.components.push({id:`component:frontend:${root}`,kind:'frontend',root,framework,location});
    }catch{index.diagnostics.push({file,message:'无法读取前端项目声明，已有文件仍可浏览。',severity:'warning'});}
  }
  for(const component of index.components)if(component.kind==='frontend'){
    const candidates=[...configs].filter(([file])=>file.startsWith(component.root?component.root+'/':'')&&/^(?:vite|vue)\.config\.[cm]?[jt]s$/.test(file.split('/').at(-1)!));
    const ports=candidates.flatMap(([,text])=>[...text.replace(/\/\*[^]*?\*\//g,'').matchAll(/(?:server|devServer)\s*:\s*\{[^{}]*?\bport\s*:\s*(\d+)/g)].map(m=>Number(m[1])));
    if(new Set(ports).size===1&&ports[0]>0&&ports[0]<65536)component.port=ports[0];
  }
  for(const s of index.symbols)if(isTestFile(s.file,index))s.auxiliary=true;
  if(index.frontendFiles?.length&&!index.files.length)index.diagnostics.push({message:'当前目录只发现前端文件；后端可能在所选目录以外。',severity:'info'});
}
