import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {managedPath} from './managed-path.mjs';
import {scopedTermAllowance} from '../corpus/term-allowances.mjs';
import {readCorpusLayers} from '../corpus/public/layers.mjs';
import ts from 'typescript';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const layers=await readCorpusLayers(path.join(root,'corpus/public/manifest.json'),path.join(root,'corpus/private/manifest.json'));
if(layers.privateMissing)console.log('已跳过（未找到私有语料）');
const manifest={projects:[...layers.publicProjects,...layers.privateProjects]};
const corpus=process.env.CODELEADER_CORPUS||path.join(root,'.cache','corpus'),output=managedPath(path.resolve(root,process.argv.find(a=>a.startsWith('--output='))?.slice(9)||'.tmp/verification-no-project-terms'));
const allow=JSON.parse(await fs.readFile(path.join(root,'corpus/project-term-allowlist.json'),'utf8'));
for(const entry of allow)if(!entry.reason||entry.file&&!entry.contains)throw Error('Whitelist reason/context missing');
const allowed=new Map(allow.filter(a=>!a.file).map(a=>[a.term.toLowerCase(),a.reason]));
const terms=new Map(),add=(term,kind,project,file)=>{if(!term||term.includes('${')||term.length<2)return;const key=kind+':'+term.toLowerCase();if(!terms.has(key))terms.set(key,{term,kind,sources:[]});const t=terms.get(key);if(!t.sources.some(s=>s.project===project&&s.file===file))t.sources.push({project,file});};
async function walk(folder,ignore=new Set()){const files=[];for(const e of await fs.readdir(folder,{withFileTypes:true}).catch(()=>[])){if(e.isSymbolicLink()||ignore.has(e.name))continue;const file=path.join(folder,e.name);if(e.isDirectory())files.push(...await walk(file,ignore));else files.push(file);}return files;}
const ignored=new Set(['.git','node_modules','.venv','venv','target','build','dist','.cache','.tmp','__pycache__']);
const sqlLiterals=(rel,text)=>/\.sql$/.test(rel)?[{value:text,offset:0}]:/\.xml$/.test(rel)?[...text.matchAll(/<(?:select|insert|update|delete)\b[^>]*>([\s\S]*?)<\/(?:select|insert|update|delete)>/gi)].map(m=>({value:m[1],offset:m.index+m[0].indexOf(m[1])})):[...text.matchAll(/"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g)].map(m=>({value:m[0].replace(/^["']+|["']+$/g,''),offset:m.index}));
const sqlStatement=q=>/^\s*(?:SELECT\b[\s\S]*\bFROM\b|INSERT\s+INTO\b|UPDATE\s+[\w.`"]+\s+SET\b|DELETE\s+FROM\b|CREATE\s+TABLE\b)/i.test(q);
let missingPrivate=0;
for(const p of manifest.projects){
 if(!await fs.stat(path.join(corpus,p.id)).then(stat=>stat.isDirectory()).catch(()=>false)){
  if(layers.privateProjects.includes(p))missingPrivate++;
  else console.log(`公开语料 ${p.id}：已跳过（未找到目录）`);
  continue;
 }
 add(p.id,'name',p.id,'manifest');const source=p.source||p.url;if(source)add(source.replace(/\.git$/,'').split('/').at(-1),'name',p.id,'manifest');
 const base=path.join(corpus,p.id),files=await walk(base,ignored),packages=[],pythonRoots=files.filter(f=>/(?:requirements[^/\\]*\.txt|pyproject\.toml|Pipfile)$/.test(f)).map(f=>path.dirname(f));
 for(const file of files){const rel=path.relative(base,file).replaceAll('\\','/');if(!/\.(?:java|py|xml|ya?ml|properties|sql|toml|json|txt)$|(?:^|\/)\.env[^/]*$/.test(rel))continue;const stat=await fs.stat(file);if(stat.size>2*1024*1024)continue;const text=await fs.readFile(file,'utf8');
  if(rel.endsWith('pom.xml')){const own=text.replace(/<(parent|dependencies|dependencyManagement|build|profiles)>[\s\S]*?<\/\1>/g,'');add(own.match(/<groupId>\s*([^<]+)\s*<\/groupId>/)?.[1],'namespace',p.id,rel);}
  if(rel.endsWith('.java')){const pkg=text.match(/\bpackage\s+([\w.]+)\s*;/)?.[1];if(pkg)packages.push({pkg,file:rel});}
  if(rel.endsWith('__init__.py')){const packageRoot=pythonRoots.filter(r=>file.startsWith(r+path.sep)).sort((a,b)=>b.length-a.length)[0]||base;add(path.relative(packageRoot,path.dirname(file)).replaceAll(path.sep,'.'),'python-package',p.id,rel);}
  for(const {value:query} of sqlLiterals(rel,text).filter(q=>sqlStatement(q.value)))for(const m of query.matchAll(/(?:\bFROM|\bJOIN|\bINTO|\bUPDATE|\bTABLE(?:\s+IF\s+NOT\s+EXISTS)?)\s+[`"']?([\w]+(?:\.[\w]+)?)/gi))if(!['if','select','set','where','information_schema','values'].includes(m[1].toLowerCase()))add(m[1],'table',p.id,rel);
  for(const m of text.matchAll(/(?:@TableName\s*\(|__tablename__\s*=|\bTable\s*\()[ \t]*["']([\w.]+)["']/g))add(m[1],'table',p.id,rel);
  for(const m of text.matchAll(/(?:jdbc:)?(?:mysql|postgres(?:ql)?):\/\/[^\s/"']+\/([\w-]+)/gi))add(m[1],'database',p.id,rel);
  if(!/\.(?:java|py|sql)$/.test(rel)){
   for(const m of text.matchAll(/(?:\bport|PORT|server\.port)\s*[=:]\s*["']?(\d{2,5})\b/g))add(m[1],'port',p.id,rel);
   for(const m of text.matchAll(/(?:https?|redis|postgres(?:ql)?|mysql):\/\/([^\s/"'<>]+)/gi)){const authority=m[1].split('@').at(-1),host=authority.split(':')[0];if(/^[\w.-]+$/.test(host))add(host,'domain',p.id,rel);const port=authority.match(/:(\d{2,5})$/)?.[1];if(port)add(port,'port',p.id,rel);}
  }
 }
 if(packages.length){const groups=new Map();for(const item of packages){const key=item.pkg.split('.').slice(0,2).join('.');if(!groups.has(key))groups.set(key,[]);groups.get(key).push(item);}for(const items of groups.values()){let prefix=items[0].pkg.split('.');for(const item of items){const parts=item.pkg.split('.');while(prefix.length&&!prefix.every((v,i)=>parts[i]===v))prefix.pop();}if(prefix.length>=2)add(prefix.join('.'),'namespace',p.id,items[0].file);}}
}
const termsAll=[...terms.values()].sort((a,b)=>a.term.localeCompare(b.term)),active=termsAll.filter(t=>!allowed.has(t.term.toLowerCase())),hits=[],files=[],scopedAllowed=[];
const escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
for(const folder of ['src','analyzers','runtime','scripts'])for(const file of await walk(path.join(root,folder),ignored)){
 if(!/\.(?:[cm]?[jt]sx?|json|java|py|ps1|cmd|bat|xml|properties|ya?ml)$/.test(file))continue;const rel=path.relative(root,file).replaceAll('\\','/');files.push(rel);const text=await fs.readFile(file,'utf8'),lines=text.split('\n'),queries=sqlLiterals(rel,text).filter(q=>sqlStatement(q.value));
 for(const term of active){const re=new RegExp(`(?<![\\w])${escape(term.term)}(?![\\w])`,'i');for(let line=0;line<lines.length;line++){if(!re.test(lines[line]))continue;
   // A common table/schema identifier is project-specific only in an SQL/table declaration.
   if(term.kind==='table'&&!queries.some(q=>re.test(q.value)&&text.slice(0,q.offset).split('\n').length-1<=line&&text.slice(0,q.offset+q.value.length+3).split('\n').length-1>=line)&&!new RegExp(`(?:TableName|__tablename__|table|tableName)\\s*[:=(]\\s*["']${escape(term.term)}["']`,'i').test(lines[line]))continue;
   if(term.kind==='database'&&!new RegExp(`(?:jdbc:)?(?:mysql|postgres(?:ql)?):/{2}[^\\s/"']+/${escape(term.term)}(?:[?"'\\s]|$)`,'i').test(lines[line]))continue;
   if(term.kind==='domain'&&!term.term.includes('.')&&!new RegExp(`://(?:[^\\s/@]+@)?${escape(term.term)}(?=[:/"'\\s]|$)`,'i').test(lines[line]))continue;
   if(term.kind==='port'&&!new RegExp(`(?::|--port[=\\s]+|\\b[\\w.-]*port["']?\\s*[:=]\\s*["']?)${escape(term.term)}\\b`,'i').test(lines[line]))continue;
   const allowance=scopedTermAllowance(allow,term.term,rel,lines[line]);if(allowance){scopedAllowed.push({file:rel,line:line+1,term:term.term,reason:allowance.reason});continue;}
   hits.push({file:rel,line:line+1,term:term.term,kind:term.kind,sources:term.sources});
 }}
}
if(missingPrivate)console.log(`已跳过（未找到私有语料）：${missingPrivate} 项`);
const layoutFiles=['src/main/workspace-discovery.ts','src/analysis/structure.ts','src/analysis/project-discovery.ts','src/analysis/unit-discovery.ts','src/analysis/resource-discovery.ts','src/shared/source-roles.ts'],layoutHits=[];
for(const rel of layoutFiles){const text=await fs.readFile(path.join(root,rel),'utf8'),source=ts.createSourceFile(rel,text,ts.ScriptTarget.Latest,true),forbidden=/^(?:backend|frontend|server|client|web|api)(?:\/|$)|^src\/main(?:\/|$)/i;
 function inspect(node){if(ts.isStringLiteralLike(node)||node.kind===ts.SyntaxKind.RegularExpressionLiteral){const value=(ts.isStringLiteralLike(node)?node.text:node.getText(source)).replaceAll('\\/','/').replace(/^\.\//,'');const parent=node.parent,importPath=ts.isImportDeclaration(parent)||ts.isExportDeclaration(parent),semanticKind=ts.isPropertyAssignment(parent)&&parent.name.getText(source)==='kind'||ts.isBinaryExpression(parent)&&/\.kind$/.test((parent.left===node?parent.right:parent.left).getText(source))||ts.isConditionalExpression(parent)&&(ts.isCallExpression(parent.parent)&&parent.parent.expression.getText(source)==='create'||ts.isVariableDeclaration(parent.parent)&&parent.parent.name.getText(source)==='kind');if(!importPath&&!semanticKind&&forbidden.test(value)){const pos=source.getLineAndCharacterOfPosition(node.getStart(source));layoutHits.push({file:rel,line:pos.line+1,value});}}ts.forEachChild(node,inspect);}inspect(source);
}
await fs.mkdir(output,{recursive:true});const result={files:files.length,terms:termsAll.length,activeTerms:active.length,allowed:termsAll.filter(t=>allowed.has(t.term.toLowerCase())).map(t=>({...t,reason:allowed.get(t.term.toLowerCase())})),scopedAllowed,hits,layoutFiles,layoutHits};
await fs.writeFile(path.join(output,'no-project-terms.json'),JSON.stringify(result,null,2));
console.log(`Scanned ${files.length} files; extracted ${termsAll.length} terms; ${hits.length} hits; layout ${layoutHits.length} hits`);for(const h of hits)console.log(`${h.file}:${h.line}\t${h.kind}\t${h.term}`);for(const h of layoutHits)console.log(`${h.file}:${h.line}\tlayout\t${h.value}`);
process.exitCode=hits.length||layoutHits.length?1:0;
