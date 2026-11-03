import fs from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import {guard,root} from './common.mjs';

guard();
const policy=JSON.parse(await fs.readFile(path.join(root,'docs/ui-wording-policy.json'),'utf8'));
const phase=process.argv.includes('--before')?'before':'after',configArg=process.argv.find(a=>a.startsWith('--review-config='));
const config=configArg?JSON.parse(await fs.readFile(path.resolve(root,configArg.slice('--review-config='.length)),'utf8')):undefined;
const folder=path.join(root,config?.output||'.tmp/verification-u7-wording');await fs.mkdir(folder,{recursive:true});
const inventory=[],violations=[],files=[];
async function walk(dir){for(const e of await fs.readdir(path.join(root,dir),{withFileTypes:true})){if(e.isSymbolicLink())continue;const file=path.posix.join(dir,e.name);if(e.isDirectory())await walk(file);else if(/\.(?:tsx?|[cm]?js|json|html|css)$/.test(file))files.push(file);}}
await walk('src');
function inspect(file,text,position,value,kind){
 value=value.trim();if(!value)return;
 const line=text.slice(0,position).split('\n').length,entry={file,line,kind,text:value};inventory.push(entry);
 for(const term of policy.forbidden)if(value.toLowerCase().includes(term.toLowerCase()))violations.push({...entry,rule:'forbidden-word',term});
 const sentences=(value.match(/[。！？]/g)||[]).length;
 if(sentences>policy.maximumSentences)violations.push({...entry,rule:'sentence-budget',sentences});
}
for(const file of files){const text=await fs.readFile(path.join(root,file),'utf8');
 if(file.endsWith('.json')){
  const tree=ts.parseJsonText(file,text);
  function visit(node){if(ts.isPropertyAssignment(node)&&ts.isStringLiteral(node.initializer)&&!policy.nonDisplayKeys.includes(node.name.text)&&/[\u3400-\u9fff]/u.test(node.initializer.text))inspect(file,text,node.initializer.getStart(tree),node.initializer.text,'data-copy');ts.forEachChild(node,visit);}visit(tree);continue;
 }
 if(file.endsWith('.html')||file.endsWith('.css')){
  const re=file.endsWith('.html')?/>\s*([^<>]*[\u3400-\u9fff][^<>]*)</gu:/content\s*:\s*(['"])(.*?)\1/gu;for(const m of text.matchAll(re))inspect(file,text,m.index,file.endsWith('.html')?m[1]:m[2],'markup-copy');continue;
 }
 const tree=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,file.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
 function visit(node){
  if(ts.isJsxText(node)){inspect(file,text,node.getStart(tree),node.text,'jsx');return;}
  if(ts.isStringLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node)||ts.isTemplateHead(node)||ts.isTemplateMiddle(node)||ts.isTemplateTail(node)){
   const p=node.parent,isKey=ts.isPropertyAssignment(p)&&p.name===node||ts.isImportDeclaration(p)||ts.isExportDeclaration(p);
   const key=ts.isPropertyAssignment(p)&&p.name!==node?p.name.getText(tree):undefined;
   const displayAttribute=ts.isJsxAttribute(p)&&/^(?:title|aria-label|placeholder|alt|label)$/.test(p.name.getText(tree));
   if(!isKey&&!policy.nonDisplayKeys.includes(key)&&(/[\u3400-\u9fff]/u.test(node.text)||displayAttribute))inspect(file,text,node.getStart(tree),node.text,'literal');
  }
  ts.forEachChild(node,visit);
 }visit(tree);
}
const result={phase,version:policy.version,files:files.length,strings:inventory.length,violations,counts:Object.fromEntries(policy.forbidden.map(term=>[term,violations.filter(v=>v.term===term).length])),scope:policy.scope,technicalLiteralReason:policy.technicalLiteralReason};
const target=path.join(folder,'wording-'+phase+'.json');if(phase==='before'&&await fs.stat(target).catch(()=>false))throw Error('Before wording result already frozen');
await fs.writeFile(target,JSON.stringify(result,null,2));await fs.writeFile(path.join(folder,'wording-inventory-'+phase+'.json'),JSON.stringify(inventory,null,2));
console.log(JSON.stringify({phase,files:files.length,strings:inventory.length,violations:violations.length,counts:result.counts,output:path.relative(root,target)}));
if(violations.length)process.exitCode=1;
if(process.argv.includes('--ui'))await import('./verify-wording.mjs');
