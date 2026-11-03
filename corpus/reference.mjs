// Independent reference inventory. Never imports CodeLeader analysis/model code.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import Parser from 'web-tree-sitter';
import ts from 'typescript';
import {repository} from './acquire.mjs';
export const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
export const slash=value=>value.replaceAll('\\','/');
const excluded=new Set(['.git','node_modules','target','dist','build','.venv','venv','__pycache__','.tools','.cache','.tmp','.appdata','.idea']);
export async function inventory(root){const files=[];async function walk(folder){for(const entry of await fs.readdir(folder,{withFileTypes:true})){if(entry.isSymbolicLink()||excluded.has(entry.name))continue;const absolute=path.join(folder,entry.name);if(entry.isDirectory())await walk(absolute);else if(entry.isFile())files.push(slash(path.relative(root,absolute)));}}await walk(root);return files.sort();}
export async function evidence(root,file,line=1){const raw=await fs.readFile(path.join(root,file));return {file,line,sha256:sha(raw)};}
const strings=text=>[...text.matchAll(/['"]([^'"]*)['"]/g)].map(m=>m[1]);
const join=(...parts)=>('/'+parts.join('/')).replace(/\/{2,}/g,'/');
function paths(args){const named=args.match(/(?:^|[,\s])(?:path|value)\s*=\s*(\{[^}]*\}|"[^"]*")/s);return named?strings(named[1]):args.trim().startsWith('"')?[strings(args)[0]]:args.trim().startsWith('{')?strings(args.slice(0,args.indexOf('}')+1)):[''];}
const methodVerb={GetMapping:'GET',PostMapping:'POST',PutMapping:'PUT',PatchMapping:'PATCH',DeleteMapping:'DELETE'};
function annotations(text){return [...text.matchAll(/@(?:\w+\.)*(GetMapping|PostMapping|PutMapping|PatchMapping|DeleteMapping|RequestMapping)\b(?:\s*\(([^)]*)\))?/gs)].map(m=>({type:m[1],args:m[2]||''}));}
function frontAST(file,text){if(file.endsWith('.vue'))text=text.replace(/^[\s\S]*?<script[^>]*>/,m=>m.replace(/[^\n\r]/g,' ')).replace(/<\/script>[\s\S]*$/,'');if(file.endsWith('.html')){const chunks=[...text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)],chars=[...text].map(c=>/[\r\n]/.test(c)?c:' ');for(const match of chunks){const start=match.index+match[0].indexOf('>')+1;for(let i=0;i<match[1].length;i++)chars[start+i]=match[1][i];}text=chars.join('').replace(/\{\{[\s\S]*?\}\}/g,m=>m.replace(/['"]/g,' ')).replace(/\{%[\s\S]*?%\}/g,m=>m.replace(/[^\r\n]/g,' '));}return ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,/tsx|jsx/.test(path.extname(file))?ts.ScriptKind.TSX:ts.ScriptKind.TS);}
const literal=(node,source)=>{if(!node)return undefined;if(ts.isStringLiteralLike(node))return node.text;if(ts.isTemplateExpression(node))return node.getText(source).slice(1,-1).replace(/\$\{[^}]+\}/g,'{value}');if(ts.isBinaryExpression(node)&&node.operatorToken.kind===ts.SyntaxKind.PlusToken){const left=literal(node.left,source);if(left!==undefined)return left+(literal(node.right,source)??'{value}');}return undefined;};
const properties=node=>ts.isObjectLiteralExpression(node)?Object.fromEntries(node.properties.filter(ts.isPropertyAssignment).map(p=>[p.name.getText().replace(/['"]/g,''),p.initializer])):{};
export async function reference(root,profile){
 const files=await inventory(root),routes=[],classes=[],pages=[],api=[];
 await Parser.init({locateFile:()=>path.join(repository,'resources/grammars/tree-sitter.wasm')});
 for(const language of ['java','python']){
  const parser=new Parser();parser.setLanguage(await Parser.Language.load(path.join(repository,`resources/grammars/tree-sitter-${language}.wasm`)));
  for(const file of files.filter(f=>f.endsWith(language==='java'?'.java':'.py')&&(language==='java'?!/\/src\/test\//.test('/'+f):!/(?:^|\/)(?:tests|test)\//.test(f)&&!/(?:^|\/)test_[^/]*\.py$/.test(f)))){
   const text=await fs.readFile(path.join(root,file),'utf8'),tree=parser.parse(text);
   function walk(node,owner){
    if(['class_declaration','interface_declaration','class_definition'].includes(node.type)){const name=node.childForFieldName('name')?.text||'';classes.push({file,line:node.startPosition.row+1,name});if(language==='java')owner={name,modifiers:node.namedChildren.find(c=>c.type==='modifiers')?.text||''};}
    if(language==='java'&&node.type==='method_declaration'&&owner&&/@(?:\w+\.)*(?:RestController|Controller)\b/.test(owner.modifiers)){
     const mods=node.namedChildren.find(c=>c.type==='modifiers')?.text||'',prefixes=annotations(owner.modifiers).flatMap(a=>paths(a.args)),name=node.childForFieldName('name')?.text;
     for(const a of annotations(mods)){const verbs=a.type==='RequestMapping'?[...a.args.matchAll(/RequestMethod\.(\w+)/g)].map(m=>m[1]):[methodVerb[a.type]];for(const prefix of prefixes.length?prefixes:[''])for(const route of paths(a.args))for(const method of verbs.length?verbs:['ANY'])routes.push({method,path:join(prefix,route),module:owner.name,name,file,line:node.startPosition.row+1});}
    }
    if(language==='python'&&node.type==='decorated_definition'){
     const definition=node.namedChildren.find(c=>c.type==='function_definition'),prefix=profile.pythonPrefixes?.[file]||'',local=text.match(/\b(?:APIRouter|Blueprint)\([^)]*\bprefix\s*=\s*['"]([^'"]*)/s)?.[1]||'';
     if(definition)for(const decorator of node.namedChildren.filter(c=>c.type==='decorator')){const m=decorator.text.match(/^@\w+\.(get|post|put|patch|delete|head|options|route|api_route)\s*\(\s*['"]([^'"]*)['"]([\s\S]*)/);if(!m)continue;const methods=['route','api_route'].includes(m[1])?strings(m[3].match(/methods\s*=\s*\[([^\]]*)\]/)?.[1]||"'GET'"):[m[1].toUpperCase()];for(const method of methods)routes.push({method,path:join(prefix,local,m[2]),module:file,name:definition.childForFieldName('name')?.text,file,line:definition.startPosition.row+1,decoratorLine:decorator.startPosition.row+1});}
    }
    for(const child of node.namedChildren)walk(child,owner);
   }walk(tree.rootNode);tree.delete();
  }parser.delete();
 }
 for(const file of files.filter(f=>profile.frontendScan?.some(prefix=>f.startsWith(prefix))&&/\.(?:[jt]sx?|vue|html)$/.test(f)&&!/(?:^|\/)(?:tests?|core)\//.test(f)&&!f.endsWith('routeTree.gen.ts'))){
  const text=await fs.readFile(path.join(root,file),'utf8'),source=frontAST(file,text),line=node=>source.getLineAndCharacterOfPosition(node.getStart(source)).line+1;
  function walk(node){
   if(ts.isClassDeclaration(node))classes.push({file,line:line(node),name:node.name?.text||''});
   if(ts.isObjectLiteralExpression(node)&&profile.pageFiles?.includes(file)){const p=properties(node),route=literal(p.path,source);if(route!==undefined&&p.component&&!p.children&&!p.redirect&&!['Layout','ParentView','InnerLink'].includes(p.component.getText(source)))pages.push({file,line:line(node),path:route});}
   if((ts.isJsxSelfClosingElement(node)||ts.isJsxOpeningElement(node))&&node.tagName.getText(source)==='Route'&&profile.pageFiles?.includes(file)){const props=Object.fromEntries(node.attributes.properties.filter(ts.isJsxAttribute).map(p=>[p.name.getText(),p.initializer]));if(props.component||props.element)pages.push({file,line:line(node),path:props.path?.getText(source)||'(index)'});}
   if(ts.isCallExpression(node)){
    const expression=node.expression,callee=expression.getText(source),p=properties(node.arguments[0]||source),verb=ts.isPropertyAccessExpression(expression)?expression.name.text.toUpperCase():undefined;
    let method,url;if(profile.apiFiles?.some(prefix=>file.startsWith(prefix))){
     if(verb&&/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(verb)){method=verb;url=literal(p.url,source)||literal(node.arguments[0],source);}
     else if(/^(?:request|http|axios|__request|fetch)$/.test(callee)){method=literal(p.method,source)?.toUpperCase()||'GET';url=literal(p.url,source)||literal(node.arguments[0],source);}
     if(method&&url!==undefined)api.push({file,line:line(node),method,path:url.includes('{{')?null:url,...(url.includes('{{')?{expression:text.slice(node.getStart(source),node.end)}:{})});
    }
    if(profile.fileRoutes?.some(prefix=>file.startsWith(prefix))&&callee==='createFileRoute'&&!/\/(?:__root|_layout)\.tsx$/.test(file))pages.push({file,line:line(node),path:literal(node.arguments[0],source)});
   }
   ts.forEachChild(node,walk);
  }walk(source);
 }
 const unique=(rows,key)=>[...new Map(rows.map(r=>[key(r),r])).values()];
 const endpoints=unique(routes,r=>`${r.file}:${r.name}:${r.method}:${r.path}`),modules=Object.entries(Object.groupBy(endpoints,r=>r.module)).map(([name,items])=>({name,count:items.length,files:[...new Set(items.map(r=>r.file))]}));
 return {files,classes,endpoints,modules,pages:unique(pages,p=>`${p.file}:${p.line}`),api:unique(api,p=>`${p.file}:${p.line}:${p.method}:${p.path}`)};
}
