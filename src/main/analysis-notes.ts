import ts from 'typescript';
import type {Location,ProjectIndex,ProjectUnit} from '../shared/model';
import type {FrontendHttpCall} from '../shared/frontend-model';
import type {AddressVariable,AnalysisNotes,NoteEvidence} from '../shared/analysis-notes';
import policy from '../shared/analysis-notes-policy.json';

const normalized=(p:string)=>p.replace(/\\/g,'/').replace(/^\.\//,'').replace(/\/$/,'').toLowerCase();
const under=(file:string,root:string)=>!root||normalized(root)==='.'||normalized(file)===normalized(root)||normalized(file).startsWith(normalized(root)+'/');
const at=(file:string,line=0):Location=>({file,range:{start:{line,character:0},end:{line,character:1}}});
const point=(location:Location,label:string):NoteEvidence=>({location,label});
const lineAt=(text:string,offset:number)=>text.slice(0,offset).split('\n').length-1;
const uniqueEvidence=(items:NoteEvidence[])=>items.filter((v,i,a)=>a.findIndex(x=>x.location.file===v.location.file&&x.location.range.start.line===v.location.range.start.line)===i);

// This reads explanation evidence only. It never adds endpoints, resolves addresses or changes the index.
export async function collectAnalysisNotes(index:ProjectIndex,read:(file:string)=>Promise<string|undefined>):Promise<AnalysisNotes>{
 const notes:AnalysisNotes={projectId:index.id,version:index.createdAt,web:[],addresses:[],partial:[],unreadFiles:[]};
 const units=index.units||[],apps=units.filter(u=>u.kind==='application');
 const owner=(file:string,candidates=apps)=>candidates.filter(u=>under(file,u.root)).sort((a,b)=>b.root.length-a.root.length)[0];
 const files=[...index.files,...index.frontendFiles||[],...index.inputs||[]];
 const texts=new Map<string,string>();
 const queue=[...new Set(files.map(f=>f.path))];
 for(let i=0;i<queue.length;i+=policy.limits.readConcurrency.value)await Promise.all(queue.slice(i,i+policy.limits.readConcurrency.value).map(async file=>{
  try{const text=await read(file);if(text===undefined)notes.unreadFiles.push(file);else texts.set(file,text);}catch{notes.unreadFiles.push(file);}
 }));
 for(const unit of apps){
  const web=policy.webFrameworks.find(w=>new RegExp(w.pattern,'i').test(unit.framework||''));if(!web)continue;
  const entries=(index.entries||[]).filter(e=>e.kind==='http'&&owner(e.location.file)?.id===unit.id);if(entries.length)continue;
  const routeFiles=index.files.filter(f=>owner(f.path)?.id===unit.id&&new RegExp(web.files,'i').test(f.path)).map(f=>f.path);
  const basis=uniqueEvidence(unit.basis.map(b=>point(b.location,b.note)));
  const reasons:AnalysisNotes['web'][number]['reasons']=[];
  for(const file of routeFiles){
   const text=texts.get(file);if(!text)continue;
   if(web.legacyImport&&web.legacyCall&&new RegExp(web.legacyImport).test(text)){
    const call=new RegExp(web.legacyCall).exec(text);if(call)reasons.push({text:web.legacyText!,evidence:[point(at(file,lineAt(text,call.index)),'路由写法')]});
   }
  }
  const classViews=web.classBases?index.symbols.filter(s=>routeFiles.includes(s.file)&&s.kind==='class'&&s.typeEvidence?.bases.some(b=>new RegExp(web.classBases!).test(b))):[];
  if(classViews.length)reasons.push({text:`找到 ${classViews.length} 个按类处理请求的定义，还没有读出它们的接口。`,evidence:classViews.slice(0,policy.limits.webReasons.value).map(s=>point({file:s.file,range:s.selection},'处理请求的类'))});
  const unread=routeFiles.filter(f=>!texts.has(f));
  if(unread.length)reasons.push({text:`其中 ${unread.length} 个文件本次没能读取，不能据此判断没有接口。`,evidence:unread.map(f=>point(at(f),'未读到的文件'))});
  if(!reasons.length)reasons.push({text:routeFiles.length?`找到了 ${routeFiles.length} 个可能处理请求的文件，但还没从中读出接口。`:'已找到 Web 应用入口，但所选范围没有找到路由或视图文件；请检查所选目录是否完整。',evidence:routeFiles.slice(0,policy.limits.webReasons.value).map(f=>point(at(f),'已扫描文件'))});
  // Repeated route declarations share one cause while retaining every source position.
  const distinct=reasons.reduce<typeof reasons>((all,r)=>{const previous=all.find(v=>v.text===r.text);if(previous)previous.evidence=uniqueEvidence([...previous.evidence,...r.evidence]);else all.push(r);return all;},[]);
  notes.web.push({unitId:unit.id,name:unit.root||index.name,framework:web.name||unit.framework||'Web 服务',basis,files:routeFiles,reasons:distinct.slice(0,policy.limits.webReasons.value)});
 }
 const sourceCache=new Map<string,ts.SourceFile>();
 const source=(file:string)=>{let parsed=sourceCache.get(file);if(!parsed){let text=texts.get(file);if(text===undefined)return undefined;
  if(/\.(vue|html?)$/i.test(file)){let masked=text.replace(/[^\r\n]/g,' ');for(const match of text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)){const start=match.index+match[0].indexOf('>')+1;masked=masked.slice(0,start)+match[1]+masked.slice(start+match[1].length);}text=masked;}
  parsed=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,/\.tsx$/.test(file)?ts.ScriptKind.TSX:ts.ScriptKind.TS);sourceCache.set(file,parsed);}return parsed;};
 const calls=index.frontend?.httpCalls||[];
 const frontends=units.filter(u=>u.kind==='frontend');
 for(const unit of [...frontends,...apps]){
  const unknown=calls.filter(c=>{const linked=index.frontendLinks?.calls.find(l=>l.callId===c.id),uncertain=linked?.addresses.length?linked.addresses.some(a=>!a.known):c.addressStatus==='unknown',assigned=index.frontend?.modules.find(m=>m.id===c.moduleId)?.unitId||owner(c.location.file,frontends)?.id||owner(c.location.file)?.id;return uncertain&&assigned===unit.id;});
  if(!unknown.length)continue;
  const details=unknown.map(call=>({id:call.id,method:call.method,address:call.url,location:call.methodLocation||call.location,variables:addressVariables(call,unit,source,texts,index)})),commented=details.flatMap(c=>c.variables).find(v=>v.state==='commented'),where=commented?.evidence[0]?.location;
  notes.addresses.push({unitId:unit.id,count:unknown.length,...commented&&where?{summary:`前端没写明请求地址（${commented.name} 的赋值在 ${where.file}:${where.range.start.line+1} 被注释了）`}:{},calls:details.sort((a,b)=>Number(b.variables.some(v=>v.state==='commented'))-Number(a.variables.some(v=>v.state==='commented'))).slice(0,policy.limits.addressExamples.value)});
 }
 if(index.status==='partial'){
  for(const item of notes.web)notes.partial.push({id:'web:'+item.unitId,text:`${item.framework} 的接口没有读出来`,impact:`已扫描 ${item.files.length} 个路由/视图文件；接口列表还不能反映这个应用的请求入口。`,count:1,evidence:item.reasons.flatMap(r=>r.evidence).slice(0,policy.limits.webReasons.value)});
  for(const item of notes.addresses)notes.partial.push({id:'address:'+item.unitId,text:`${item.count} 处前端调用的地址没有确定`,impact:'还不能把这些调用连到具体后端。',count:item.count,evidence:item.calls.map(c=>point(c.location,`${c.method} ${c.address}`))});
  const categorized=new Set<number>();
  for(const category of policy.partialCategories){
   const matches=index.diagnostics.map((d,i)=>({d,i})).filter(({d,i})=>!categorized.has(i)&&new RegExp(category.pattern,'i').test(d.message));if(!matches.length)continue;
   for(const {i} of matches)categorized.add(i);
   let evidence=uniqueEvidence(matches.filter(({d})=>d.file).map(({d})=>{
    const file=d.file!,text=texts.get(file),importName=/Import ["']([^"']+)["']/.exec(d.message)?.[1];
    const found=text&&importName?text.split('\n').findIndex(line=>/^\s*(?:from|import)\s/.test(line)&&line.includes(importName)):-1;
    return point(at(file,found!==undefined&&found>=0?found:0),found!==undefined&&found>=0?'依赖引用':'涉及文件');
   }));
   if(!evidence.length)evidence=uniqueEvidence(units.flatMap(u=>u.basis.filter(b=>b.source==='entry'||b.source==='build').map(b=>point(b.location,b.note))));
   const impact=category.id==='frontend-scope'?`已读到 ${index.frontendFiles?.length||0} 个前端文件，所选范围没有 Java / Python 后端源码；可选择同时包含后端的目录。`:category.impact;
   notes.partial.push({id:category.id,text:`${category.text} · ${matches.length} 条记录`,impact,count:matches.length,evidence});
  }
  const remaining=index.diagnostics.filter((d,i)=>!categorized.has(i)&&d.severity!=='info');
  if(remaining.length)notes.partial.push({id:'other',text:`还有 ${remaining.length} 条未解决的读取记录`,impact:`涉及 ${new Set(remaining.map(d=>d.file).filter(Boolean)).size} 个文件；详细内容可在下方展开查看。`,count:remaining.length,evidence:uniqueEvidence(remaining.filter(d=>d.file).map(d=>point(at(d.file!),'涉及文件')))});
  if(!notes.partial.length)notes.partial.push({id:'unfinished',text:'这次分析尚未完成',impact:`已读出 ${index.files.length+(index.frontendFiles?.length||0)} 个源码文件；完整原因尚未返回，可重新分析或查看已有文件。`,count:1,evidence:[]});
  notes.partial=notes.partial.slice(0,policy.limits.partialGroups.value);
 }
 return notes;
}

function addressVariables(call:FrontendHttpCall,unit:ProjectUnit,source:(file:string)=>ts.SourceFile|undefined,texts:Map<string,string>,index:ProjectIndex):AddressVariable[]{
 const expression=[call.expression,...(call.baseURLs||[]).map(v=>v.expression||v.value)].join(' ');
 const environments=[...expression.matchAll(/(?:import\.meta\.env|process\.env)\.([A-Za-z_$][\w$]*)/g)].map(m=>m[1]);
 if(environments.length)return [...new Set(environments)].map(name=>{
  const matches:NoteEvidence[]=[];for(const [file,text]of texts)if(under(file,unit.root)){
   if(/(?:^|\/)\.env[^/]*$/i.test(file)){const line=text.split('\n').findIndex(l=>new RegExp('^\\s*(?:export\\s+)?'+name+'\\s*=').test(l));if(line>=0)matches.push(point(at(file,line),'环境设置'));}
   else if(/\.[cm]?[jt]sx?$/i.test(file)){const parsed=source(file);if(!parsed)continue;const references=['import.meta.env.'+name,'process.env.'+name];
    const visit=(node:ts.Node)=>{if(ts.isPropertyAssignment(node)&&ts.isStringLiteral(node.name)&&references.includes(node.name.text)||ts.isBinaryExpression(node)&&node.operatorToken.kind===ts.SyntaxKind.EqualsToken&&references.includes(node.left.getText(parsed)))matches.push(point(at(file,parsed.getLineAndCharacterOfPosition(node.getStart(parsed)).line),'地址设置'));ts.forEachChild(node,visit);};visit(parsed);
   }
  }
  return{name,state:matches.length?'unresolved':'missing',text:matches.length?'找到了赋值，但这个地址还不能确定。':'在已读取的项目文件里没有找到直接赋值。',evidence:uniqueEvidence(matches)};
 });
 const foundNames=new Set<string>();
 for(const value of [call.expression,...(call.baseURLs||[]).filter(v=>v.unresolved&&v.expression).map(v=>v.expression!)]){
  const parsed=ts.createSourceFile('address.ts','('+value.replace(/^\s*\.\.\./,'')+')',ts.ScriptTarget.Latest,true);
  const visit=(node:ts.Node)=>{if(ts.isIdentifier(node)&&(!ts.isPropertyAccessExpression(node.parent)||node.parent.name!==node||node.parent.expression.kind===ts.SyntaxKind.ThisKeyword))foundNames.add(node.text);ts.forEachChild(node,visit);};visit(parsed);
 }
 const names=[...foundNames].filter(n=>!['undefined','import','meta','env','process'].includes(n));
 if(!names.length)names.push(...[...call.url.matchAll(/\{([A-Za-z_$][\w$]*)\}/g)].map(m=>m[1]));
 const sf=source(call.location.file),offset=sf?.getPositionOfLineAndCharacter(call.location.range.start.line,call.location.range.start.character)||0;
 const scopeOf=(node:ts.Node)=>{let scope=node.parent;while(scope&&!ts.isSourceFile(scope)&&!ts.isBlock(scope)&&!ts.isFunctionLike(scope))scope=scope.parent;return scope;};
 const visible=(node:ts.Node)=>{const scope=scopeOf(node);return !scope||scope.pos<=offset&&offset<=scope.end;};
 const find=(file:ts.SourceFile,name:string,imported=false)=>{
  const matches:NoteEvidence[]=[];
  const visit=(node:ts.Node)=>{
   if((ts.isVariableDeclaration(node)&&node.initializer||ts.isParameter(node)&&!imported||ts.isFunctionDeclaration(node)&&node.body)&&node.name&&ts.isIdentifier(node.name)&&node.name.text===name&&(imported?ts.isSourceFile(scopeOf(node)!):visible(node)))matches.push(point(at(file.fileName,file.getLineAndCharacterOfPosition(node.getStart(file)).line),'地址来源'));
   ts.forEachChild(node,visit);
  };visit(file);return matches;
 };
 return names.map(name=>{
  let evidence=sf?find(sf,name):[];
  if(!evidence.length&&sf)for(const statement of sf.statements){
   if(!ts.isImportDeclaration(statement)||!ts.isStringLiteral(statement.moduleSpecifier))continue;
   if(statement.importClause?.isTypeOnly)continue;
   const bindings=statement.importClause?.namedBindings,element=bindings&&ts.isNamedImports(bindings)?bindings.elements.find(e=>e.name.text===name&&!e.isTypeOnly):undefined,namespace=bindings&&ts.isNamespaceImport(bindings)&&bindings.name.text===name;
   if(!element&&!namespace&&statement.importClause?.name?.text!==name)continue;
   const specifier=statement.moduleSpecifier.text,imported=index.frontend?.imports.find(i=>i.from===call.moduleId&&i.specifier===specifier);
   const target=index.frontend?.modules.find(m=>m.id===imported?.to),targetSource=target&&source(target.file);
   if(targetSource&&!namespace)evidence=find(targetSource,element?.propertyName?.text||name,true);
   if(!evidence.length)evidence=[point(at(sf.fileName,sf.getLineAndCharacterOfPosition(statement.getStart(sf)).line),'导入来源')];
  }
  if(!evidence.length)for(const [file]of texts){if(!under(file,unit.root)||!/\.(?:vue|[cm]?[jt]sx?)$/i.test(file))continue;const parsed=source(file);if(!parsed)continue;const scanner=ts.createScanner(ts.ScriptTarget.Latest,false,ts.LanguageVariant.Standard,parsed.text);let token:ts.SyntaxKind;
   while((token=scanner.scan())!==ts.SyntaxKind.EndOfFileToken)if(token===ts.SyntaxKind.SingleLineCommentTrivia||token===ts.SyntaxKind.MultiLineCommentTrivia){const raw=scanner.getTokenText(),text=raw.replace(/^\/[/\*]/,'').replace(/\*\/$/,''),candidate=ts.createSourceFile('comment.ts',text,ts.ScriptTarget.Latest,true);if((candidate as ts.SourceFile&{parseDiagnostics:ts.Diagnostic[]}).parseDiagnostics.length)continue;
    const statement=candidate.statements[0],expr=statement&&ts.isExpressionStatement(statement)?statement.expression:undefined;
    if(expr&&ts.isBinaryExpression(expr)&&expr.operatorToken.kind===ts.SyntaxKind.EqualsToken&&ts.isPropertyAccessExpression(expr.left)&&expr.left.name.text===name){const location=at(file,parsed.getLineAndCharacterOfPosition(scanner.getTokenPos()).line);return{name,state:'commented' as const,text:'赋值被注释了，没有作为地址使用。',evidence:[point(location,'被注释的赋值')]};}
   }
  }
  return{name,state:evidence.length?'unresolved':'missing',text:evidence.length?'找到了来源，但要等页面运行才能确定这个地址。':'在这里及已关联的项目文件里没有找到赋值。',evidence};
 });
}
