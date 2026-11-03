import ts from 'typescript';
import path from 'node:path';
import type {Evidence,Location,ProjectIndex} from '../shared/model';
import type {FrontendModel,FrontendModule,FrontendSymbol,FrontendValue} from '../shared/frontend-model';
import policy from '../shared/frontend-policy.json';
import {isTestFile} from '../shared/source-roles';

export const normalized=(value:string)=>value.replace(/\\/g,'/');
export const visit=(node:ts.Node,fn:(node:ts.Node)=>void)=>{fn(node);node.forEachChild(child=>visit(child,fn));};
export const unwrap=(node:ts.Node):ts.Node=>ts.isParenthesizedExpression(node)||ts.isAsExpression(node)||ts.isTypeAssertionExpression(node)||ts.isNonNullExpression(node)||ts.isAwaitExpression(node)?unwrap(node.expression):node;
export const key=(node:ts.Node|undefined)=>node&&(ts.isIdentifier(node)||ts.isStringLiteralLike(node)||ts.isNumericLiteral(node))?node.text:undefined;
export const field=(node:ts.Node|undefined,name:string):ts.Expression|undefined=>node&&ts.isObjectLiteralExpression(unwrap(node))?(unwrap(node) as ts.ObjectLiteralExpression).properties.flatMap(p=>ts.isPropertyAssignment(p)&&key(p.name)===name?[p.initializer]:ts.isShorthandPropertyAssignment(p)&&p.name.text===name?[p.name]:[]).at(-1):undefined;
export const returns=(node:ts.Node):ts.Expression[]=>{if(ts.isArrowFunction(node)&&!ts.isBlock(node.body))return[node.body];const found:ts.Expression[]=[];const walk=(part:ts.Node)=>{if(part!==node&&ts.isFunctionLike(part))return;if(ts.isReturnStatement(part)&&part.expression)found.push(part.expression);part.forEachChild(walk);};walk(node);return found;};
export type Client={id:string;transport:'axios'|'fetch'|'xhr';baseURLs:FrontendValue[];basis:Evidence[];conditions:string[];factory?:ts.Node};
export type Ref={kind:'node';node:ts.Node}|{kind:'external';module:string;name:string;basis?:Evidence[]}|{kind:'namespace';file:string}|{kind:'client';client:Client}|{kind:'http';client:Client;method:string};
export interface FrontDocument {file:string;raw:string;sf:ts.SourceFile;module:FrontendModule;component:boolean}

export class FrontendContext {
  docs=new Map<string,FrontDocument>();checker:ts.TypeChecker;
  model:FrontendModel={version:policy.version,modules:[],symbols:[],pages:[],httpCalls:[],transports:[],imports:[],calls:[],componentUses:[],proxies:[],diagnostics:[],scanned:{scripts:0,components:0,html:0,styles:0,parsed:0}};
  functions=new Map<ts.Node,FrontendSymbol>();exports=new Map<string,Map<string,ts.Node>>();
  writes=new Map<ts.Symbol,ts.Node[]>();
  aliases:{root:string;name:string;target:string}[]=[];globals=new Map<string,ts.Expression[]>();
  factories=new Set<ts.Node>();private resolving=new Set<ts.Node>();
  private factoryProof=new Map<ts.Node,boolean>();
  private bindings=new Map<ts.Node,ts.Node>();
  private tuples=new Map<ts.Node,readonly ts.Expression[]>();
  constructor(readonly index:ProjectIndex,readonly texts:Map<string,string>,readonly configs:Map<string,string>){
    this.aliases=this.readAliases();
    for(const [file,raw] of texts){
      if(/\.(?:css|scss|sass|less)$/i.test(file)){this.model.scanned.styles++;continue;}
      const component=file.endsWith('.vue'),html=file.endsWith('.html');let source=raw;
      if(component||html){const buffer:string[]=raw.split('').map(c=>c==='\n'||c==='\r'?c:' ');
        for(const match of raw.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)){
          if(/\bsrc\s*=|(?:application\/(?:ld\+)?json)/i.test(match[1]))continue;
          const start=match.index!+match[0].indexOf('>')+1;let body=match[2];
          if(html)body=body.replace(/\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\}/g,s=>s.replace(/[^\r\n]/g,' '));
          for(let n=0;n<body.length;n++)buffer[start+n]=body[n];
        }source=buffer.join('');
      }
      let sf=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,/\.[jt]sx$/i.test(file)||component&&/<script\b[^>]*\blang\s*=\s*["'](?:t|j)sx["']/i.test(raw)?ts.ScriptKind.TSX:html||file.endsWith('.js')?ts.ScriptKind.JS:ts.ScriptKind.TS);
      const parseErrors=(file:ts.SourceFile)=>(file as ts.SourceFile&{parseDiagnostics:ts.Diagnostic[]}).parseDiagnostics;
      if(component&&parseErrors(sf).length){const jsx=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);if(parseErrors(jsx).length<parseErrors(sf).length)sf=jsx;}
      const loc=this.location(sf),module:FrontendModule={id:'file:'+file,file,name:path.posix.basename(file),role:'utility',unitId:this.unit(file)?.id,test:isTestFile(file,index),location:loc,basis:[],symbolIds:[],pageIds:[],httpCallIds:[]};
      this.docs.set(file,{file,raw,sf,module,component});this.model.modules.push(module);
      if(component)this.model.scanned.components++;else if(html)this.model.scanned.html++;else this.model.scanned.scripts++;
      const errors=(sf as ts.SourceFile&{parseDiagnostics:ts.Diagnostic[]}).parseDiagnostics;
      if(errors.length)for(const error of errors)this.model.diagnostics.push({location:this.location(sf,error.start||0,(error.start||0)+(error.length||0)),reason:ts.flattenDiagnosticMessageText(error.messageText,' ')});
      else this.model.scanned.parsed++;
    }
    const host:ts.CompilerHost={getSourceFile:file=>this.docs.get(normalized(file))?.sf,getDefaultLibFileName:()=>'',writeFile:()=>{},getCurrentDirectory:()=>'',getDirectories:()=>[],fileExists:file=>this.docs.has(normalized(file)),readFile:file=>this.docs.get(normalized(file))?.sf.text,getCanonicalFileName:normalized,useCaseSensitiveFileNames:()=>true,getNewLine:()=>'\n',resolveModuleNames:(names,from)=>names.map(name=>{const resolved=this.resolveFile(normalized(from),name);return resolved?{resolvedFileName:resolved,extension:ts.Extension.Ts}:undefined;})};
    const program=ts.createProgram([...this.docs.keys()],{noLib:true,noResolve:false,allowJs:true,allowNonTsExtensions:true,jsx:ts.JsxEmit.Preserve,target:ts.ScriptTarget.Latest,module:ts.ModuleKind.ESNext},host);
    this.checker=program.getTypeChecker();
    for(const doc of this.docs.values()){
      this.exports.set(doc.file,new Map());
      visit(doc.sf,node=>{
        if(ts.isBinaryExpression(node)&&node.operatorToken.kind>=ts.SyntaxKind.FirstAssignment&&node.operatorToken.kind<=ts.SyntaxKind.LastAssignment&&ts.isIdentifier(node.left)||((ts.isPrefixUnaryExpression(node)||ts.isPostfixUnaryExpression(node))&&[ts.SyntaxKind.PlusPlusToken,ts.SyntaxKind.MinusMinusToken].includes(node.operator)&&ts.isIdentifier(node.operand))){const target=ts.isBinaryExpression(node)?node.left:(node as ts.PrefixUnaryExpression).operand,symbol=this.checker.getSymbolAtLocation(target);if(symbol)this.writes.set(symbol,[...(this.writes.get(symbol)||[]),node]);}
        if(ts.isFunctionLike(node)&&'body'in node&&node.body||ts.isClassDeclaration(node)){
          const name=this.nodeName(node),symbol:FrontendSymbol={id:`frontend:symbol:${doc.file}:${node.getStart()}:${name}`,name,kind:ts.isClassDeclaration(node)?'class':ts.isMethodDeclaration(node)?'method':'function',moduleId:doc.module.id,location:this.location(node)};
          this.functions.set(node,symbol);doc.module.symbolIds.push(symbol.id);this.model.symbols.push(symbol);
        }
        if(ts.isImportDeclaration(node)&&ts.isStringLiteral(node.moduleSpecifier))this.addImport(doc,node.moduleSpecifier.text,node,false,!!node.importClause?.isTypeOnly);
        if(ts.isExportDeclaration(node)&&node.moduleSpecifier&&ts.isStringLiteral(node.moduleSpecifier))this.addImport(doc,node.moduleSpecifier.text,node,false,!!node.isTypeOnly);
        if(ts.isCallExpression(node)&&node.expression.kind===ts.SyntaxKind.ImportKeyword&&ts.isStringLiteral(node.arguments[0]))this.addImport(doc,node.arguments[0].text,node,true,false);
        if(ts.isExportAssignment(node))this.exports.get(doc.file)!.set('default',node.expression);
        if(ts.canHaveModifiers(node)&&ts.getModifiers(node)?.some(m=>m.kind===ts.SyntaxKind.ExportKeyword)){
          if(ts.isVariableStatement(node)){for(const d of node.declarationList.declarations)if(ts.isIdentifier(d.name))this.exports.get(doc.file)!.set(d.name.text,d.initializer||d);}
          else if((ts.isFunctionDeclaration(node)||ts.isClassDeclaration(node))&&node.name)this.exports.get(doc.file)!.set(ts.getModifiers(node)?.some(m=>m.kind===ts.SyntaxKind.DefaultKeyword)?'default':node.name.text,node);
        }
      });
      const symbol:FrontendSymbol={id:doc.module.id,name:doc.module.name,kind:'module',moduleId:doc.module.id,location:doc.module.location};this.model.symbols.push(symbol);
    }
    for(const [node,symbol] of this.functions){const parent=this.owner(node.parent);if(parent.id!==symbol.moduleId)symbol.parentId=parent.id;}
    // Vue global properties belong to the frontend unit, rather than to every file in the repository.
    const collectGlobal=(doc:FrontDocument,node:ts.Node)=>{if(!ts.isBinaryExpression(node)||node.operatorToken.kind!==ts.SyntaxKind.EqualsToken||!ts.isPropertyAccessExpression(node.left))return;
      for(const rule of policy.globalBindings){let base:ts.Expression=node.left.expression,valid=true;for(const name of [...rule.chain].reverse()){if(!ts.isPropertyAccessExpression(base)||base.name.text!==name){valid=false;break;}base=base.expression;}if(!valid)continue;
        const app=this.ref(base),proven=rule.kind==='factory'?app?.kind==='node'&&ts.isCallExpression(app.node)&&this.external(app.node.expression,rule.module,rule.export):this.external(base,rule.module,rule.export);if(!proven)continue;
        const id=`${doc.module.unitId||this.packageRoot(doc.file)}:${node.left.name.text}`,items=this.globals.get(id)||[];if(!items.includes(node.right))this.globals.set(id,[...items,node.right]);
      }
    };
    for(const doc of this.docs.values())if(!doc.module.test)visit(doc.sf,node=>collectGlobal(doc,node));
    for(const doc of this.docs.values())if(!doc.module.test)visit(doc.sf,node=>{if(!ts.isCallExpression(node)||!ts.isPropertyAccessExpression(node.expression))return;for(const rule of policy.globalBindings){if(!('pluginMethod'in rule)||node.expression.name.text!==rule.pluginMethod||!this.external(node.expression.expression,rule.module,rule.export))continue;const hook=this.member(this.ref(node.arguments[0]),rule.hook!,0),fn=hook?.kind==='node'?hook.node:undefined;if(fn&&ts.isFunctionLike(fn)&&'body'in fn&&fn.body)this.withArguments(fn,[node.expression.expression],()=>visit(fn.body!,part=>collectGlobal(this.docs.get(normalized(part.getSourceFile().fileName))!,part)));}});
  }
  location(node:ts.Node,start=node.getStart(),end=node.getEnd()):Location{const sf=node.getSourceFile()||node as ts.SourceFile;return{file:normalized(sf.fileName),range:{start:sf.getLineAndCharacterOfPosition(start),end:sf.getLineAndCharacterOfPosition(end)}} as unknown as Location;}
  // TypeScript calls its UTF-16 column "character" and its row "line" (the same convention as Location).
  evidence(node:ts.Node,note:string,kind:Evidence['kind']='declaration'):Evidence{return{kind,location:this.location(node),note};}
  unit(file:string){return this.index.units?.filter(u=>u.kind==='frontend'&&(u.root==='.'||file===u.root||file.startsWith(u.root+'/'))).sort((a,b)=>b.root.length-a.root.length)[0];}
  packageRoot(file:string){return [...this.configs.keys()].filter(f=>path.posix.basename(f)==='package.json'&&(path.posix.dirname(f)==='.'||file.startsWith(path.posix.dirname(f)+'/'))).sort((a,b)=>b.length-a.length).map(f=>path.posix.dirname(f))[0]||'.';}
  nodeName(node:ts.Node):string {if('name'in node&&key(node.name as ts.Node))return key(node.name as ts.Node)!;if(ts.isVariableDeclaration(node.parent)||ts.isPropertyAssignment(node.parent))return key(node.parent.name)||'匿名方法';return'匿名方法';}
  owner(node:ts.Node):FrontendSymbol {for(let current:ts.Node|undefined=node;current;current=current.parent){const fn=this.functions.get(current);if(fn&&fn.kind!=='class')return fn;}const doc=this.docs.get(normalized(node.getSourceFile().fileName))!;return this.model.symbols.find(s=>s.id===doc.module.id)!;}
  resolveFile(from:string,specifier:string):string|undefined {
    let candidate=specifier.startsWith('.')?path.posix.join(path.posix.dirname(from),specifier):undefined;
    if(!candidate){const alias=this.aliases.filter(a=>(a.root==='.'||from.startsWith(a.root+'/'))&&(specifier===a.name||specifier.startsWith(a.name+'/'))).sort((a,b)=>b.name.length-a.name.length||b.root.length-a.root.length)[0];if(alias)candidate=path.posix.join(alias.target,specifier.slice(alias.name.length));}
    if(!candidate)return;candidate=path.posix.normalize(candidate);const choices=[candidate,...['.ts','.tsx','.js','.jsx','.vue','.mjs','.cjs'].map(ext=>candidate+ext),...['.ts','.tsx','.js','.jsx'].map(ext=>candidate+'/index'+ext)];
    if(candidate.endsWith('.js'))choices.push(candidate.slice(0,-3)+'.ts');return choices.find(file=>this.texts.has(file)&&!file.endsWith('.css'));
  }
  addImport(doc:FrontDocument,specifier:string,node:ts.Node,dynamic:boolean,typeOnly:boolean){this.model.imports.push({id:`frontend:import:${doc.file}:${node.getStart()}`,from:doc.module.id,to:this.resolveFile(doc.file,specifier)?'file:'+this.resolveFile(doc.file,specifier):undefined,specifier,location:this.location(node),dynamic,typeOnly});}
  exportRef(file:string,name:string,depth:number):Ref|undefined {
    if(depth>policy.thresholds.referenceDepth.value)return;
    const direct=this.exports.get(file)?.get(name);if(direct)return this.ref(direct,depth+1);
    const doc=this.docs.get(file);if(!doc)return;
    for(const item of doc.sf.statements)if(ts.isExportDeclaration(item)&&item.moduleSpecifier&&ts.isStringLiteral(item.moduleSpecifier)){
      const target=this.resolveFile(file,item.moduleSpecifier.text);if(!target)continue;
      if(!item.exportClause){const found=this.exportRef(target,name,depth+1);if(found)return found;}
      else if(ts.isNamedExports(item.exportClause)){const part=item.exportClause.elements.find(e=>e.name.text===name);if(part)return this.exportRef(target,(part.propertyName||part.name).text,depth+1);}
    }
  }
  external(node:ts.Node,module:string,name?:string){const ref=this.ref(node);return ref?.kind==='external'&&ref.module===module&&(!name||ref.name===name);}
  clientFactory(node:ts.CallExpression){const callee=node.expression;return ts.isPropertyAccessExpression(callee)?policy.clients.find(row=>row.kind==='axios'&&callee.name.text===row.factory&&this.external(callee.expression,row.module)):undefined;}
  ref(raw:ts.Node|undefined,depth=0):Ref|undefined {
    if(!raw||depth>policy.thresholds.referenceDepth.value)return;const node=unwrap(raw);if(this.resolving.has(node))return;
    this.resolving.add(node);try{return this.resolve(node,depth);}finally{this.resolving.delete(node);}
  }
  private resolve(node:ts.Node,depth:number):Ref|undefined {
    if(ts.isIdentifier(node)){
      const bound=this.bound(node);if(bound&&bound!==node)return this.ref(bound,depth+1);
      let symbol=this.checker.getSymbolAtLocation(node),decl=symbol?.valueDeclaration||symbol?.declarations?.[0];
      if(decl&&ts.isShorthandPropertyAssignment(decl)){symbol=this.checker.getShorthandAssignmentValueSymbol(decl);decl=symbol?.valueDeclaration||symbol?.declarations?.[0];}
      if(!decl){const builtin=policy.clients.find(row=>row.module==='global'&&row.default===node.text);return builtin?{kind:'external',module:builtin.module,name:builtin.default}:{kind:'node',node};}
      if(ts.isImportSpecifier(decl)||ts.isImportClause(decl)||ts.isNamespaceImport(decl)){
        let parent:ts.Node=decl;while(!ts.isImportDeclaration(parent)&&parent.parent)parent=parent.parent;
        if(!ts.isImportDeclaration(parent)||!ts.isStringLiteral(parent.moduleSpecifier))return;
        const module=parent.moduleSpecifier.text,name=ts.isImportSpecifier(decl)?(decl.propertyName||decl.name).text:ts.isNamespaceImport(decl)?'*':'default',file=this.resolveFile(normalized(node.getSourceFile().fileName),module);
        return file?name==='*'?{kind:'namespace',file}:this.exportRef(file,name,depth+1):{kind:'external',module,name};
      }
      if(ts.isVariableDeclaration(decl)&&decl.initializer&&(!symbol||!this.writes.has(symbol)))return this.ref(decl.initializer,depth+1);
      if(decl&&ts.isParameter(decl)&&decl.initializer)return this.ref(decl.initializer,depth+1);
      if(ts.isBindingElement(decl)&&ts.isObjectBindingPattern(decl.parent)&&ts.isVariableDeclaration(decl.parent.parent)){
        const object=this.ref(decl.parent.parent.initializer,depth+1);return this.member(object,key(decl.propertyName||decl.name)||'',depth+1);
      }
      if(ts.isVariableDeclaration(decl)&&decl.type&&ts.isTypeReferenceNode(decl.type)&&policy.clients.some(row=>row.types.some(type=>this.external((decl.type as ts.TypeReferenceNode).typeName,row.module,type))))return{kind:'client',client:{id:'frontend:client:'+this.location(decl).file+':'+decl.getStart(),transport:'axios',baseURLs:[],basis:[this.evidence(decl.type,'声明的类型来自 HTTP 客户端')],conditions:['客户端在运行时赋值']}};
      return{kind:'node',node:decl};
    }
    if(ts.isPropertyAccessExpression(node)||ts.isElementAccessExpression(node)){
      const property=ts.isPropertyAccessExpression(node)?node.name.text:key(node.argumentExpression);if(!property)return;
      if(node.expression.kind===ts.SyntaxKind.ThisKeyword){const doc=this.docs.get(normalized(node.getSourceFile().fileName))!,items=this.globals.get(`${doc.module.unitId||this.packageRoot(doc.file)}:${property}`)||[];if(items.length===1){const ref=this.ref(items[0],depth+1),basis=this.evidence(items[0].parent,'同一前端应用的全局属性赋值','assignment');if(ref?.kind==='external')return{...ref,basis:[...(ref.basis||[]),basis]};if(ref?.kind==='client')return{...ref,client:{...ref.client,basis:[...ref.client.basis,basis]}};return ref;}}
      const object=this.ref(node.expression,depth+1),member=this.member(object,property,depth+1);if(member)return member;
      const symbol=this.checker.getSymbolAtLocation(ts.isPropertyAccessExpression(node)?node.name:node),decl=symbol?.valueDeclaration;
      if(decl&&(ts.isMethodDeclaration(decl)||ts.isPropertyAssignment(decl)))return this.ref(ts.isPropertyAssignment(decl)?decl.initializer:decl,depth+1);
      return{kind:'node',node};
    }
    if(node.kind===ts.SyntaxKind.ThisKeyword){for(let parent=node.parent;parent;parent=parent.parent)if(ts.isClassDeclaration(parent))return{kind:'node',node:parent};}
    if(ts.isBinaryExpression(node)&&[ts.SyntaxKind.QuestionQuestionToken,ts.SyntaxKind.BarBarToken].includes(node.operatorToken.kind)){
      const left=this.ref(node.left,depth+1),right=this.ref(node.right,depth+1),client=[left,right].find(r=>r?.kind==='client');
      if(client?.kind==='client')return{kind:'client',client:{...client.client,conditions:[...client.client.conditions,'按源码默认客户端；调用参数可替换客户端']}};
      if(right?.kind==='external'&&policy.clients.some(row=>row.module===right.module&&row.default===right.name))return right;
    }
    if(ts.isNewExpression(node)){const ref=this.ref(node.expression,depth+1);if(ref?.kind==='external'&&policy.clients.some(row=>row.kind==='xhr'&&row.module===ref.module&&row.default===ref.name))return{kind:'client',client:{id:'frontend:xhr:'+this.location(node).file+':'+node.getStart(),transport:'xhr',baseURLs:[],basis:[this.evidence(node,'浏览器 HTTP 客户端')],conditions:[]}};return ref;}
    if(ts.isCallExpression(node)){
      if(this.clientFactory(node))return{kind:'client',client:{id:`frontend:client:${node.getSourceFile().fileName}:${node.getStart()}`,transport:'axios',baseURLs:this.values(field(node.arguments[0],'baseURL')),basis:[this.evidence(node,'HTTP 客户端配置','assignment')],conditions:[]}};
      const fn=this.ref(node.expression,depth+1);
      if(fn?.kind==='node'&&ts.isFunctionLike(fn.node)&&'body'in fn.node&&fn.node.body){
        const outputs=returns(fn.node);if(outputs.length===1){const object=unwrap(outputs[0]);
          if(ts.isObjectLiteralExpression(object)&&policy.methods.filter(m=>field(object,m)).length>1){
            const constructors:ts.CallExpression[]=[];visit(fn.node,n=>{if(ts.isCallExpression(n)&&this.clientFactory(n))constructors.push(n);});
            if(constructors.length){let proven=this.factoryProof.get(fn.node);if(proven===undefined){proven=policy.methods.filter(m=>field(object,m)).every(m=>this.reachesHttp(field(object,m),new Set()));this.factoryProof.set(fn.node,proven);}
              if(proven){this.factories.add(fn.node);return{kind:'client',client:{id:`frontend:client:${node.getSourceFile().fileName}:${node.getStart()}`,transport:'axios',baseURLs:constructors.flatMap(n=>this.values(field(n.arguments[0],'baseURL'))),basis:[this.evidence(node,'调用客户端工厂'),...constructors.map(n=>this.evidence(n,'工厂创建 axios 客户端','assignment')),this.evidence(object,'返回的 HTTP 方法继续调用客户端')],conditions:['按工厂默认客户端；调用参数可覆盖配置'],factory:fn.node}};}}
          }
          return this.ref(object,depth+1);
        }
      }
    }
    return{kind:'node',node};
  }
  private reachesHttp(raw:ts.Node|undefined,seen:Set<ts.Node>):boolean {
    if(!raw||seen.has(raw)||seen.size>policy.thresholds.referenceDepth.value)return false;seen.add(raw);const ref=this.ref(raw);
    if(ref?.kind!=='node')return ref?.kind==='client'||ref?.kind==='http';
    let found=false;visit(ref.node,node=>{if(found||!ts.isCallExpression(node))return;const target=this.ref(node.expression);
      if(target?.kind==='client'||target?.kind==='http'||target?.kind==='external'&&policy.clients.some(row=>row.module===target.module&&(target.name===row.default||row.kind==='axios'&&['request',...policy.methods].includes(target.name))))found=true;
      else if(target?.kind==='node'&&ts.isFunctionLike(target.node))found=this.reachesHttp(target.node,seen);
    });return found;
  }
  member(ref:Ref|undefined,name:string,depth:number):Ref|undefined {
    if(!ref)return;if(ref.kind==='namespace')return this.exportRef(ref.file,name,depth+1);
    if(ref.kind==='external')return ref.name==='*'||ref.name==='default'?{kind:'external',module:ref.module,name}:undefined;
    if(ref.kind==='client'&&policy.methods.includes(name))return{kind:'http',client:ref.client,method:name.toUpperCase()};
    if(ref.kind==='client'&&name==='request')return ref;
    if(ref.kind==='node'){
      if(ts.isObjectLiteralExpression(ref.node)){const value=field(ref.node,name);if(value)return this.ref(value,depth+1);const method=ref.node.properties.find(p=>ts.isMethodDeclaration(p)&&key(p.name)===name);if(method)return{kind:'node',node:method};}
      if(ts.isClassDeclaration(ref.node)){const member=ref.node.members.find(m=>key(m.name)===name);if(member)return this.ref(ts.isPropertyDeclaration(member)?member.initializer:member,depth+1);for(const clause of ref.node.heritageClauses||[])for(const base of clause.types){const found=this.member(this.ref(base.expression,depth+1),name,depth+1);if(found)return found;}}
    }
  }
  withCall<T>(fn:ts.SignatureDeclaration,call:ts.CallExpression,run:()=>T):T{
    return this.withArguments(fn,this.arguments(call),run);
  }
  withArguments<T>(fn:ts.SignatureDeclaration,args:readonly ts.Expression[],run:()=>T):T{
    const bindings=this.bindings,tuples=this.tuples;this.bindings=new Map(bindings);this.tuples=new Map(tuples);
    fn.parameters.forEach((p,i)=>{if(p.dotDotDotToken)this.tuples.set(p,args.slice(i));else if(args[i]||p.initializer)this.bindings.set(p,args[i]||p.initializer!);});
    try{return run();}finally{this.bindings=bindings;this.tuples=tuples;}
  }
  bound(node:ts.Node):ts.Node|undefined{
    if(!ts.isIdentifier(node))return;const symbol=this.checker.getSymbolAtLocation(node),decl=symbol?.valueDeclaration||symbol?.declarations?.[0];if(!decl)return;
    const parameter=symbol?.declarations?.find(ts.isParameter),local=symbol?.declarations?.find(d=>ts.isVariableDeclaration(d)&&!!d.initializer) as ts.VariableDeclaration|undefined;
    if(parameter&&local?.initializer){const rhs=local.initializer;if(rhs.pos<=node.pos&&node.end<=rhs.end)return this.bindings.get(parameter)||parameter;return rhs;}
    if(ts.isParameter(decl))return this.bindings.get(decl);
    if(ts.isBindingElement(decl)&&ts.isObjectBindingPattern(decl.parent)&&ts.isParameter(decl.parent.parent)){
      const actual=this.bindings.get(decl.parent.parent);if(!actual)return;
      return decl.dotDotDotToken?actual:this.property(actual,key(decl.propertyName||decl.name)||'')||decl.initializer;
    }
  }
  parameter(node:ts.Node):boolean{const ref=this.ref(node),target=ref?.kind==='node'?ref.node:node;return ts.isParameter(target)||ts.isBindingElement(target)&&ts.isParameter(target.parent.parent);}
  arguments(call:ts.CallExpression):readonly ts.Expression[]{return call.arguments.flatMap(arg=>{if(!ts.isSpreadElement(arg))return[arg];const ref=this.ref(arg.expression),node=ref?.kind==='node'?ref.node:undefined;return node&&this.tuples.has(node)?[...this.tuples.get(node)!]:[arg];});}
  property(raw:ts.Node|undefined,name:string,depth=0):ts.Node|undefined{
    if(!raw||depth>policy.thresholds.referenceDepth.value)return;const bound=this.bound(raw);if(bound&&bound!==raw)return this.property(bound,name,depth+1);
    if(ts.isIdentifier(raw)){const symbol=this.checker.getSymbolAtLocation(raw),decl=symbol?.valueDeclaration;if(decl&&ts.isVariableDeclaration(decl)&&decl.initializer&&!this.writes.has(symbol!))return this.property(decl.initializer,name,depth+1);}
    if(ts.isCallExpression(raw)){const target=this.ref(raw.expression),fn=target?.kind==='node'?target.node:undefined;if(fn&&ts.isFunctionLike(fn)&&'body'in fn&&fn.body){const values=returns(fn);if(values.length===1)return this.withCall(fn,raw,()=>this.property(values[0],name,depth+1));}}
    const ref=this.ref(raw),node=ref?.kind==='node'?ref.node:raw;
    if(ts.isObjectLiteralExpression(node)){for(const p of [...node.properties].reverse()){
      if(ts.isPropertyAssignment(p)&&key(p.name)===name)return p.initializer;
      if(ts.isShorthandPropertyAssignment(p)&&p.name.text===name)return p.name;
      if(ts.isSpreadAssignment(p)){const found=this.property(p.expression,name,depth+1);if(found)return found;}
    }}
    if(ts.isBinaryExpression(node)&&[ts.SyntaxKind.BarBarToken,ts.SyntaxKind.QuestionQuestionToken].includes(node.operatorToken.kind))return this.property(node.left,name,depth+1)||this.property(node.right,name,depth+1);
    if(node!==raw)return this.property(node,name,depth+1);
  }
  values(node:ts.Node|undefined,depth=0):FrontendValue[]{if(!node)return[];if(depth>policy.thresholds.referenceDepth.value)return[{value:'{value}',location:this.location(node),unresolved:true,reason:'地址引用过深或循环'}];node=unwrap(node);const bound=this.bound(node);if(bound&&bound!==node)return this.values(bound,depth+1);const env=node.getText().match(/^(?:import\.meta\.env|process\.env)\.([A-Za-z_\d]+)$/)?.[1];
    if(env){const file=normalized(node.getSourceFile().fileName),root=this.packageRoot(file),found:FrontendValue[]=[];
      for(const [name,text] of this.configs){if(!/^\.env(?:\..*)?$/.test(path.posix.basename(name)))continue;const folder=path.posix.dirname(name);if(folder!=='.'&&folder!==root)continue;
        for(const match of text.matchAll(new RegExp('^\\s*(?:export\\s+)?'+env+'\\s*=\\s*([^\\r\\n]*)','gm'))){const offset=match.index!,before=text.slice(0,offset).split('\n');found.push({value:match[1].replace(/^(['"])([\s\S]*)\1$/,'$2').trim(),profile:path.posix.basename(name),location:{file:name,range:{start:{line:before.length-1,character:0},end:{line:before.length-1,character:match[0].length}}},expression:node.getText()});}
      }
      return found.length?found:[{value:'{'+env+'}',location:this.location(node),expression:node.getText(),unresolved:true,reason:'环境中的地址没有固定值'}];
    }
    const join=(a:FrontendValue[],b:FrontendValue[])=>{const all=a.flatMap(left=>b.filter(right=>!left.profile||!right.profile||left.profile===right.profile).map(right=>({...left,value:left.value+right.value,profile:left.profile||right.profile,unresolved:left.unresolved||right.unresolved,reason:left.reason||right.reason,conditions:[...left.conditions||[],...right.conditions||[]],location:left.profile?left.location:right.profile?right.location:left.location})));return all.length<=policy.thresholds.valueCandidates.value?all:[{value:'{address}',location:this.location(node),unresolved:true,reason:'地址组合过多，无法确定'}];};
    if(ts.isBinaryExpression(node)&&node.operatorToken.kind===ts.SyntaxKind.PlusToken)return join(this.values(node.left,depth+1),this.values(node.right,depth+1));
    if(ts.isTemplateExpression(node)){let parts:FrontendValue[]=[{value:node.head.text,location:this.location(node)}];for(const span of node.templateSpans)parts=join(parts,this.values(span.expression,depth+1).map(v=>({...v,value:v.value+span.literal.text})));return parts;}
    if(ts.isBinaryExpression(node)&&[ts.SyntaxKind.BarBarToken,ts.SyntaxKind.QuestionQuestionToken].includes(node.operatorToken.kind)){const left=this.values(node.left,depth+1),known=left.filter(v=>!v.unresolved&&(node.operatorToken.kind===ts.SyntaxKind.QuestionQuestionToken||v.value));return known.length?known:this.values(node.right,depth+1).map(v=>({...v,conditions:[...v.conditions||[],node.left.getText()+' 未提供时采用源码默认值']}));}
    const ref=this.ref(node);if(ref?.kind==='node'&&ref.node!==node&&!ts.isParameter(ref.node)&&!ts.isBindingElement(ref.node))return this.values(ref.node,depth+1);
    const value=this.value(node);return[{value:value.text,location:this.location(node),expression:node.getText(),...(value.unknown?{unresolved:true,reason:value.reason}:{})}];
  }
  value(raw:ts.Node|undefined,depth=0):{text:string;unknown:boolean;reason?:string}{
    if(!raw)return{text:'',unknown:true,reason:'没有地址表达式'};if(depth>policy.thresholds.referenceDepth.value)return{text:'{value}',unknown:true,reason:'表达式引用过深或循环'};const node=unwrap(raw);
    const bound=this.bound(node);if(bound&&bound!==node)return this.value(bound,depth+1);
    if(ts.isStringLiteralLike(node)){const original=this.docs.get(normalized(node.getSourceFile().fileName))?.raw.slice(node.getStart(),node.end)||node.getText();if(/\{[{%]/.test(original))return{text:original.slice(1,-1).replace(/\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\}/g,'{template}'),unknown:true,reason:'地址由服务端页面模板生成'};return{text:node.text,unknown:false};}
    if(ts.isNumericLiteral(node))return{text:node.text,unknown:false};
    if(node.kind===ts.SyntaxKind.TrueKeyword||node.kind===ts.SyntaxKind.FalseKeyword)return{text:node.kind===ts.SyntaxKind.TrueKeyword?'true':'false',unknown:false};
    if(ts.isIdentifier(node)){const symbol=this.checker.getSymbolAtLocation(node);if(symbol&&this.writes.has(symbol))return{text:'{'+node.text+'}',unknown:true,reason:'变量在其他位置有赋值，不能当作固定地址'};}
    if(/^(?:import\.meta\.env|process\.env)\.[A-Za-z_\d]+$/.test(node.getText())){const values=this.values(node),unique=[...new Set(values.filter(v=>!v.unresolved).map(v=>v.value))];if(unique.length===1)return{text:unique[0],unknown:false};return{text:'{'+node.getText().split('.').at(-1)+'}',unknown:true,reason:unique.length?'不同配置中的地址不一致':'环境中的地址没有固定值'};}
    if(ts.isTemplateExpression(node)){let text=node.head.text,unknown=false,reason:string|undefined;for(const part of node.templateSpans){const v=this.value(part.expression,depth+1);text+=v.text+part.literal.text;unknown||=v.unknown;reason||=v.reason;}return{text,unknown,reason};}
    if(ts.isBinaryExpression(node)&&node.operatorToken.kind===ts.SyntaxKind.PlusToken){const a=this.value(node.left,depth+1),b=this.value(node.right,depth+1);return{text:a.text+b.text,unknown:a.unknown||b.unknown,reason:a.reason||b.reason};}
    if(ts.isBinaryExpression(node)&&[ts.SyntaxKind.BarBarToken,ts.SyntaxKind.QuestionQuestionToken,ts.SyntaxKind.AmpersandAmpersandToken].includes(node.operatorToken.kind)){const a=this.value(node.left,depth+1);if(node.operatorToken.kind===ts.SyntaxKind.AmpersandAmpersandToken)return a.unknown?a:a.text?this.value(node.right,depth+1):a;return !a.unknown&&a.text?a:this.value(node.right,depth+1);}
    if(ts.isIdentifier(node)){const declaration=this.checker.getSymbolAtLocation(node)?.valueDeclaration;if(declaration&&ts.isBindingElement(declaration)&&ts.isParameter(declaration.parent.parent)&&this.bindings.has(declaration.parent.parent)&&!this.bound(node))return{text:'',unknown:false};}
    const ref=this.ref(node,depth+1);if(ref?.kind==='node'&&ref.node!==node&&!ts.isParameter(ref.node)&&!ts.isBindingElement(ref.node))return this.value(ref.node,depth+1);
    if(ts.isParameter(ref?.kind==='node'?ref.node:node)){const parameter=ref?.kind==='node'?ref.node:node;return{text:'{'+(key((parameter as ts.ParameterDeclaration).name)||'param')+'}',unknown:false};}
    if(ts.isCallExpression(node)&&ts.isIdentifier(node.expression)&&['encodeURIComponent','encodeURI','String'].includes(node.expression.text))return this.value(node.arguments[0],depth+1);
    const name=ts.isIdentifier(node)?node.text:ts.isPropertyAccessExpression(node)?node.name.text:'value';return{text:'{'+name+'}',unknown:true,reason:node.getText()+' 在项目里没有找到可用的赋值'};
  }
  private readAliases(){const aliases:{root:string;name:string;target:string}[]=[];
    for(const [file,text] of this.configs){const root=path.posix.dirname(file);
      if(/(?:ts|js)config(?:\.[^/]*)?\.json$/.test(file)){const config=ts.parseConfigFileTextToJson(file,text).config;for(const [name,targets] of Object.entries(config?.compilerOptions?.paths||{}))if(Array.isArray(targets))for(const target of targets)if(typeof target==='string')aliases.push({root,name:name.replace(/\/\*$/,''),target:path.posix.join(root,config.compilerOptions.baseUrl||'.',target.replace(/\/\*$/,''))});}
      if(/(?:vite|vue)\.config\.[cm]?[jt]s$/.test(file)){const sf=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true);visit(sf,node=>{if(!ts.isPropertyAssignment(node)||key(node.name)!=='alias'||!ts.isObjectLiteralExpression(node.initializer))return;for(const prop of node.initializer.properties){if(!ts.isPropertyAssignment(prop))continue;const name=key(prop.name);if(!name)continue;const strings:ts.StringLiteralLike[]=[];visit(prop.initializer,n=>{if(ts.isStringLiteralLike(n))strings.push(n);});const target=strings.at(-1)?.text;if(target)aliases.push({root,name,target:path.posix.join(root,target)});}});}
      if(path.posix.basename(file)==='package.json'){try{const pkg=JSON.parse(text);if(pkg.dependencies?.['@vue/cli-service']||pkg.devDependencies?.['@vue/cli-service'])aliases.push({root,name:'@',target:path.posix.join(root,'src')});}catch{/* Build discovery reports invalid package files. */}}
    }return aliases;
  }
}
