import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import Parser from 'web-tree-sitter';
import type { ProjectIndex, SymbolInfo, Language } from '../shared/model';
import { offsetsRange } from '../shared/ranges';
import { entrySyntax, type SyntaxFacts } from './entry-syntax';
import { codeFacts, type CodeFacts } from './code-facts';
import {discoverProject} from './project-discovery';
import { redact } from '../shared/redact';
import {typeEvidence,mapperTypeEvidence} from './type-evidence';
import {discoverUnits} from './unit-discovery';
import {discoverResources} from './resource-discovery';
import {analyzeFrontend} from './frontend';
import {pythonHttpFacts} from './python-http-facts';
import workspacePolicy from '../../resources/workspace-discovery-policy.json';
type Node = Parser.SyntaxNode;
export interface CallSite { from:string; text:string; file:string; range:SymbolInfo['range']; selection:SymbolInfo['range'] }
export interface StructureResult { index:ProjectIndex; calls:CallSite[]; texts:Map<string,string>; syntax:Map<string,SyntaxFacts>; facts:Map<string,CodeFacts>; configs:Map<string,string>; frontendTexts?:Map<string,string> }
const ignored = new Set(workspacePolicy.ignoredDirectories.map(rule=>rule.name.toLowerCase()));
const hash = (s:string) => crypto.createHash('sha256').update(s).digest('hex');
const normalized = (s:string) => s.replaceAll('\\','/');
export async function structure(root:string, resources:string, progress:(phase:string,current:number,total:number)=>void,projectRoots?:string[],sharedConfigs:string[]=[],onPartial?:(index:ProjectIndex)=>void): Promise<StructureResult> {
  await Parser.init({ locateFile: () => path.join(resources,'grammars/tree-sitter.wasm') });
  const index:ProjectIndex = {schema:1,id:hash(root.toLowerCase()).slice(0,20),root,name:path.basename(root),createdAt:new Date().toISOString(),status:'structure',languages:[],symbols:[],files:[],relations:[],diagnostics:[],versions:{structure:'web-tree-sitter 0.24.7 / tree-sitter-wasms 0.1.13',java:'JavaParser 3.27.1',python:'Pyright 1.1.414'},sourceRoots:[],jars:[]};
  const files:string[] = [],frontend:string[]=[];
  const configFiles:string[]=[],configs=new Map<string,string>(),frontendTexts=new Map<string,string>();
  const buildRoots:string[]=[];
  const selected=projectRoots?.map(value=>normalized(value).replace(/^\.\/?$/,'').replace(/\/$/,'').toLowerCase());
  const inScope=(relative:string)=>!selected||selected.some(value=>!value||relative===value||relative.startsWith(value+'/'));
  const leadsToScope=(relative:string)=>!selected||selected.some(value=>!value||relative===value||relative.startsWith(value+'/')||value.startsWith(relative+'/'));
  async function walk(folder:string) {
    let entries;try{entries=await fs.readdir(folder,{withFileTypes:true});}catch{index.diagnostics.push({file:normalized(path.relative(root,folder)),message:'目录无法读取，其他文件仍会继续。',severity:'warning'});return;}
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const file = path.join(folder,entry.name);
      if (entry.isDirectory() && !ignored.has(entry.name.toLowerCase())) {const relative=normalized(path.relative(root,file)).toLowerCase();if(!leadsToScope(relative))continue;try{if((await fs.stat(path.join(file,'pyvenv.cfg'))).isFile())continue;}catch{}await walk(file);}
      else if(entry.isFile()&&!inScope(normalized(path.relative(root,file)).toLowerCase()))continue;
      else if (entry.isFile() && /\.(java|py)$/.test(entry.name)) files.push(file);
      else if(entry.isFile()&&/\.(?:tsx?|jsx?|mjs|cjs|vue|html|css|scss|sass|less)$/.test(entry.name)){frontend.push(file);if(/^(?:vite|vue)\.config\.[cm]?[jt]s$/.test(entry.name))configFiles.push(file);}
      else if(entry.isFile()&&(/^(?:docker-)?compose[^/]*\.ya?ml$/i.test(entry.name)||/^application(?:-[\w-]+)?\.(?:ya?ml|properties)$/.test(entry.name)||/^Dockerfile(?:\..*)?$/.test(entry.name)||/\.xml$/.test(entry.name)&&entry.name!=='pom.xml'||/^(?:package\.json|(?:ts|js)config(?:\.[^/]*)?\.json|requirements[^/]*\.txt|pyproject\.toml|Pipfile|setup\.cfg|settings\.gradle(?:\.kts)?|\.env[^/]*)$/.test(entry.name)||/^(?:vite|vue)\.config\.[cm]?[jt]s$/.test(entry.name)))configFiles.push(file);
      else if (entry.isFile() && entry.name.endsWith('.jar')) index.jars.push(file);
      else if(entry.isFile()&&['pom.xml','build.gradle','build.gradle.kts'].includes(entry.name)) {
        buildRoots.push(folder);configFiles.push(file);
        let config;try{config=await fs.readFile(file,'utf8');}catch{index.diagnostics.push({file:normalized(path.relative(root,file)),message:'项目声明无法读取，保留已发现源码。',severity:'warning'});continue;}
        index.diagnostics.push({file:normalized(path.relative(root,file)),message:`已识别 ${entry.name}；仅读取声明，未执行构建或下载依赖。`,severity:'info'});
        if(entry.name==='pom.xml')for(const match of config.matchAll(/<sourceDirectory>\s*([^<]+)\s*<\/sourceDirectory>/g)) {
          const value=match[1].trim();
          if(value.includes('${'))index.diagnostics.push({file:normalized(path.relative(root,file)),message:'自定义 sourceDirectory 含变量，未求值；仍从实际源码包路径识别可用源码根。',severity:'warning'});
          else {const sourceRoot=path.resolve(folder,value);try{if((sourceRoot.toLowerCase()===root.toLowerCase()||sourceRoot.toLowerCase().startsWith(root.toLowerCase()+path.sep))&&(await fs.stat(sourceRoot)).isDirectory())index.sourceRoots.push(sourceRoot);}catch{index.diagnostics.push({file:normalized(path.relative(root,file)),message:`声明的源码目录不存在：${value}`,severity:'warning'});}}
        }
      }
    }
  }
  await walk(root);
  for(const relative of sharedConfigs){const file=path.resolve(root,relative),inside=path.relative(root,file);if(inside!=='..'&&!inside.startsWith('..'+path.sep)&&!path.isAbsolute(inside)&&!configFiles.includes(file))configFiles.push(file);}
  index.frontendFiles=[];
  for(const absolute of frontend){try{const stat=await fs.stat(absolute);if(stat.size>2*1024*1024)continue;const text=await fs.readFile(absolute,'utf8'),extension=path.extname(absolute),file=normalized(path.relative(root,absolute));frontendTexts.set(file,text);index.frontendFiles.push({path:file,hash:hash(text),size:stat.size,language:/tsx?/.test(extension)?'typescript':/jsx?/.test(extension)?'javascript':extension==='.vue'?'vue':/^\.(?:css|scss|sass|less)$/.test(extension)?'css':'html'});}catch{index.diagnostics.push({file:normalized(path.relative(root,absolute)),message:'前端文件无法读取，已跳过。',severity:'warning'});}}
  const texts = new Map<string,string>(); const calls:CallSite[]=[];const syntax=new Map<string,SyntaxFacts>(),facts=new Map<string,CodeFacts>();
  for (const lang of ['java','python'] as Language[]) {
    if(!files.some(file=>file.endsWith(lang==='java'?'.java':'.py')))continue;
    const parser = new Parser(); parser.setLanguage(await Parser.Language.load(path.join(resources,`grammars/tree-sitter-${lang}.wasm`)));
    for (const absolute of files.filter(f=>f.endsWith(lang==='java'?'.java':'.py'))) {
      const file = normalized(path.relative(root,absolute));
      try{
      const stat = await fs.stat(absolute);
      if (stat.size > 2*1024*1024) {index.diagnostics.push({file,message:'文件超过 2 MB，已跳过；分析结果不完整。',severity:'warning'});continue;}
      const text = await fs.readFile(absolute,'utf8'); texts.set(file,text);
      const tree = parser.parse(text);
      let module = normalized(path.dirname(file)); if(module==='.') module='根目录';
      let namespace=lang==='python'?file.replace(/\.py$/,'').replaceAll('/','.').replace(/\.__init__$/,''):'';
      if (lang==='java') {
        const pkg = tree.rootNode.namedChildren.find(n=>n.type==='package_declaration')?.text.match(/package\s+([\w.]+)/)?.[1];
        if(pkg) {
          module=namespace=pkg;
          const suffix = pkg.replaceAll('.',path.sep);
          const dir=path.dirname(absolute);
          if(dir.toLowerCase().endsWith(suffix.toLowerCase())) index.sourceRoots.push(dir.slice(0,-suffix.length));
        } else index.sourceRoots.push(path.dirname(absolute));
      }
      if(lang==='java'&&buildRoots.length>1){const buildRoot=buildRoots.filter(dir=>absolute.toLowerCase().startsWith(dir.toLowerCase()+path.sep)).sort((a,b)=>b.length-a.length)[0];if(buildRoot)module=`${normalized(path.relative(root,buildRoot))||'根模块'} · ${module}`;}
      index.files.push({path:file,language:lang,module,hash:hash(text),size:stat.size,parsed:!tree.rootNode.hasError});
      if (!index.languages.includes(lang)) index.languages.push(lang);
      if(tree.rootNode.hasError) index.diagnostics.push({file,message:'存在语法错误，已保留可解析结构。',severity:'warning'});
      const range = (n:Node) => offsetsRange(text,n.startIndex,n.endIndex);
      const imports: Record<string,string> = {};
      let unscopedCalls=0;
      if(lang==='python') {
        for(const n of tree.rootNode.descendantsOfType(['import_statement','import_from_statement'])) {
          const from = n.text.match(/^from\s+([\w.]+)\s+import\s+/)?.[1];
          const names = n.text.replace(/^from\s+[\w.]+\s+import\s+/,'').replace(/^import\s+/,'').replace(/[()\r\n]/g,'').split(',');
          for(const name of names) {const parts=name.trim().split(/\s+as\s+/);if(parts[0]) imports[parts[1]||parts[0].split('.').at(-1)!]=from?`${from}.${parts[0]}`:parts[0];}
        }
      } else {
        for(const n of tree.rootNode.descendantsOfType('import_declaration')) {
          const target=n.text.replace(/^import\s+(static\s+)?/,'').replace(/;$/,'').trim(); imports[target.split('.').at(-1)!]=target;
        }
      }
      function walkNode(node:Node, parent?:SymbolInfo) {
        let symbol=parent;
        const kinds: Record<string,SymbolInfo['kind']> = lang==='java'?{class_declaration:'class',interface_declaration:'interface',enum_declaration:'class',record_declaration:'class',method_declaration:'method',constructor_declaration:'constructor'}:{class_definition:'class',function_definition:parent?.kind==='class'?'method':'function'};
        const kind=kinds[node.type];
        if(kind) {
          const name=node.childForFieldName('name');
          if(name) {
            const params=node.childForFieldName('parameters')?.text||'';
            const qualifiedName=parent?`${parent.qualifiedName}.${name.text}`:`${namespace?namespace+'.':''}${name.text}`;
            const decorated=node.parent?.type==='decorated_definition'?node.parent:node;
            const annotations=lang==='java'?node.childForFieldName('modifiers')?.text||node.namedChildren.find(n=>n.type==='modifiers')?.text||'':decorated.namedChildren.filter(n=>n.type==='decorator').map(n=>n.text).join('\n');
            let role:string|undefined; const routes:string[]=[];
            if(lang==='java') {
              for(const [annotation,label] of [['RestController','Controller'],['Controller','Controller'],['Service','Service'],['Repository','Repository']] as const) {
                if(new RegExp(`@(?:[\\w.]+\\.)?${annotation}\\b`).test(annotations) && (imports[annotation]?.startsWith('org.springframework.') || annotations.includes(`@org.springframework.`))) role=label;
              }
            }
            symbol={id:`${lang}:${file}:${name.startIndex}:${kind}`,name:name.text,qualifiedName,signature:name.text+params,kind,language:lang,module,file,parent:parent?.id,range:range(node),selection:range(name),role,routes,declaration:node.type};
            index.symbols.push(symbol);
          }
        }
        if((lang==='java'&&['method_invocation','object_creation_expression','explicit_constructor_invocation'].includes(node.type)) || (lang==='python'&&node.type==='call')) {
          if(parent && !['class','interface'].includes(parent.kind)) {
            const name=node.childForFieldName(lang==='python'?'function':'name')||node.childForFieldName('type')||node;
            calls.push({from:parent.id,text:name.text,file,range:range(node),selection:range(name)});
          } else unscopedCalls++;
        }
        if((lang==='python'&&['import_statement','import_from_statement'].includes(node.type))||(lang==='java'&&node.type==='import_declaration')) {
          index.relations.push({id:`import:${file}:${node.startIndex}`,from:`file:${file}`,target:node.text,type:'IMPORTS',source:'tree-sitter',status:'unresolved',locations:[{file,range:range(node)}],reason:'静态导入声明；仅在可确认本地模块后建立模块关系。'});
        }
        for(const child of node.namedChildren) walkNode(child,symbol);
      }
      walkNode(tree.rootNode);
      syntax.set(file,entrySyntax(tree.rootNode,text,file,index.symbols.filter(s=>s.file===file)));
      if(lang==='python')syntax.get(file)!.python=pythonHttpFacts(tree.rootNode,text,file,index.symbols.filter(s=>s.file===file));
      facts.set(file,codeFacts(tree.rootNode,text,file,index.symbols.filter(s=>s.file===file)));
      typeEvidence(index,file,namespace,tree.rootNode,facts.get(file)!);
      if(unscopedCalls)index.diagnostics.push({file,message:`有 ${unscopedCalls} 处模块或字段初始化调用，不属于具名函数调用图；可查看源码与已识别的框架结构。`,severity:'warning'});
      tree.delete();
      progress('正在读取项目结构',index.files.length,files.length);
      }catch{index.diagnostics.push({file,message:'这个文件无法读取或解析，其他文件仍会继续。',severity:'warning'});}
    }
    parser.delete();
  }
  index.sourceRoots=[...new Set(index.sourceRoots.map(p=>path.resolve(p)))];
  if(!index.files.length) index.diagnostics.push({message:'没有找到 Java 或 Python 源文件。',severity:'warning'});
  index.schema=2;index.versions.rules='cross-project/10';
  index.analysis={scanned:files.length,parsed:index.files.filter(f=>f.parsed).length,partialFiles:index.files.filter(f=>!f.parsed).length,callPositions:0,semanticInternal:0,ruleUnique:0,external:0,implicit:0,candidate:0,unknown:0,excludedInitializations:index.diagnostics.reduce((n,d)=>n+Number(d.message.match(/^有 (\d+) 处模块或字段初始化/)?.[1]||0),0)};
  index.inputs=[];
  for(const absolute of configFiles){try{const stat=await fs.stat(absolute);if(stat.size>2*1024*1024)continue;const file=normalized(path.relative(root,absolute)),raw=await fs.readFile(absolute,'utf8');configs.set(file,redact(raw));index.inputs.push({path:file,hash:hash(raw),size:stat.size,kind:'config'});}catch{index.diagnostics.push({file:normalized(path.relative(root,absolute)),message:'配置文件无法读取，已保留源码与入口。',severity:'warning'});}}
  mapperTypeEvidence(index,configs);
  const result={index,calls,texts,syntax,facts,configs,frontendTexts};discoverProject(result);discoverUnits(result);discoverResources(result);onPartial?.(index);
  progress('正在整理前端内容',0,0);try{analyzeFrontend(index,frontendTexts,configs);}catch(error){index.diagnostics.push({message:'前端文件的部分内容没读出来，其他结构仍可查看。'+String(error),severity:'warning'});}
  return result;
}
