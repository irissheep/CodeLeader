import ts from 'typescript';
import path from 'node:path';
import type {ProjectIndex,Location,Evidence} from '../shared/model';
import type {FrontendHttpCall,FrontendPage,FrontendValue} from '../shared/frontend-model';
import policy from '../shared/frontend-policy.json';
import {FrontendContext,visit,unwrap,field,key,returns,type Ref,type Client} from './frontend-context';
import {kernelReader,type Http} from './frontend-kernels';

type Wrapper={parameter:number;input:'config'|'url';http:Http;terminal:ts.CallExpression};
const functionNode=(ref:Ref|undefined)=>ref?.kind==='node'&&ts.isFunctionLike(ref.node)&&'body'in ref.node&&ref.node.body?ref.node:undefined;
const combine=(parent:string,child:string)=>child.startsWith('/')?child:('/'+[parent,child].filter(Boolean).join('/')).replace(/\/+/g,'/');

/** Parse project text only. No imports, configuration functions, scripts or HTTP requests are executed. */
export function analyzeFrontend(index:ProjectIndex,texts:Map<string,string>,configs:Map<string,string>){
  const c=new FrontendContext(index,texts,configs),calls:ts.CallExpression[]=[];
  for(const doc of c.docs.values())visit(doc.sf,node=>{if(ts.isCallExpression(node))calls.push(node);});
  const clientDefaults=new Map<string,FrontendValue[]>();
  for(const node of calls)if(ts.isPropertyAccessExpression(node.expression)&&node.expression.name.text==='setConfig'){
    if(c.docs.get(node.getSourceFile().fileName)?.module.test)continue;
    const ref=c.ref(node.expression.expression);if(ref?.kind==='client'&&ref.client.factory&&returns(ref.client.factory).some(n=>field(unwrap(n),'setConfig'))){const values=c.values(field(node.arguments[0],'baseURL'));if(values.length)clientDefaults.set(ref.client.id,[...(clientDefaults.get(ref.client.id)||[]),...values]);}
  }
  const object=(node:ts.Node|undefined)=>{const ref=c.ref(node);return ref?.kind==='node'?ref.node:node;};
  const configHttp=(client:Client,config:ts.Node|undefined,basis:Evidence[]):Http=>{const source=object(config),methodNode=c.property(source,'method'),method=methodNode?c.value(methodNode).text.toUpperCase():source&&ts.isObjectLiteralExpression(source)&&!source.properties.some(ts.isSpreadAssignment)?'GET':'UNKNOWN';return{client,method:policy.methods.includes(method.toLowerCase())?method:'UNKNOWN',url:c.property(source,'url'),config:source,basis};};
  const direct=(node:ts.CallExpression):Http|undefined=>{
    const ref=c.ref(node.expression),args=c.arguments(node);
    if(ts.isPropertyAccessExpression(node.expression))for(const row of policy.clients.filter(r=>r.kind==='xhr')){const owner=c.ref(node.expression.expression);if(node.expression.name.text!==row.factory||owner?.kind!=='client'||owner.client.transport!=='xhr')continue;const active=calls.some(call=>{if(!ts.isPropertyAccessExpression(call.expression)||!('terminal'in row)||call.expression.name.text!==row.terminal||c.owner(call).id!==c.owner(node).id)return false;const target=c.ref(call.expression.expression);return target?.kind==='client'&&target.client.id===owner.client.id;});if(active)return{client:owner.client,method:c.value(args[0]).unknown?'UNKNOWN':c.value(args[0]).text.toUpperCase(),url:args[1],basis:owner.client.basis};}
    if(ref?.kind==='http')return{client:ref.client,method:ref.method,url:field(object(node.arguments[0]),'url')||node.arguments[0],config:ts.isObjectLiteralExpression(object(node.arguments[0])||node)?object(node.arguments[0]):object(node.arguments[['POST','PUT','PATCH'].includes(ref.method)?2:1]),basis:ref.client.basis};
    if(ref?.kind==='client'&&ref.client.transport!=='xhr')return configHttp(ref.client,node.arguments[0],ref.client.basis);
    if(ref?.kind==='external'&&policy.clients.some(row=>row.kind==='axios'&&row.module===ref.module&&[row.default,'request',...policy.methods].includes(ref.name))){
      const client:Client={id:'frontend:axios-default:'+c.packageRoot(node.getSourceFile().fileName),transport:'axios',baseURLs:[],basis:[c.evidence(node.expression,'axios HTTP 客户端'),...(ref.basis||[])],conditions:[]};
      return policy.methods.includes(ref.name)?{client,method:ref.name.toUpperCase(),url:node.arguments[0],config:object(node.arguments[['post','put','patch'].includes(ref.name)?2:1]),basis:client.basis}:ts.isStringLiteralLike(node.arguments[0])?{client,method:'GET',url:node.arguments[0],config:object(node.arguments[1]),basis:client.basis}:configHttp(client,node.arguments[0],client.basis);
    }
    if(ref?.kind==='external'&&policy.clients.some(row=>row.kind==='fetch'&&row.module===ref.module&&row.default===ref.name)){
      const config=object(args[1]),method=c.property(config,'method'),named=method&&c.value(method),empty=!args.some(ts.isSpreadElement)&&(!config||ts.isObjectLiteralExpression(config)&&!config.properties.some(ts.isSpreadAssignment));
      return{client:{id:'frontend:fetch',transport:'fetch',baseURLs:[],basis:[c.evidence(node.expression,'浏览器 fetch')],conditions:[]},method:named&&!named.unknown&&!/[{}]/.test(named.text)?named.text.toUpperCase():method||!empty?'UNKNOWN':'GET',url:args[0],config,basis:[c.evidence(node.expression,'浏览器 fetch')]};
    }
  };
  const primitives=new Map<ts.CallExpression,Http>();for(const call of calls){const http=direct(call);if(http)primitives.set(call,http);const target=functionNode(c.ref(call.expression));if(target){const to=c.functions.get(target),from=c.owner(call);if(to&&to.id!==from.id)c.model.calls.push({from:from.id,to:to.id,location:c.location(call)});}}
  const wrappers=new Map<ts.Node,Wrapper>();
  const parameter=(node:ts.Node|undefined,fn:ts.Node)=>{if(!node)return -1;const ref=c.ref(node);let part=ref?.kind==='node'?ref.node:node;while(ts.isPropertyAccessExpression(part)||ts.isElementAccessExpression(part))part=part.expression;const base=c.ref(part);const declaration=base?.kind==='node'?base.node:part;return ts.isFunctionLike(fn)?fn.parameters.findIndex(p=>p===declaration):-1;};
  const findWrapper=(call:ts.CallExpression,http:Http)=>{const owner=c.owner(call),fn=[...c.functions].find(([,s])=>s.id===owner.id)?.[0];if(!fn)return;
    const configIndex=parameter(http.config,fn),urlIndex=parameter(http.url,fn),terminal=http.wrapper?wrappers.get(http.wrapper)?.terminal||call:call;if(configIndex>=0&&!http.url)wrappers.set(fn,{parameter:configIndex,input:'config',http,terminal});else if(urlIndex>=0)wrappers.set(fn,{parameter:urlIndex,input:'url',http,terminal});
  };
  for(const [call,http] of primitives)findWrapper(call,http);
  for(const doc of c.docs.values())if(!doc.module.test)visit(doc.sf,node=>{
    if(!ts.isBinaryExpression(node)||node.operatorToken.kind!==ts.SyntaxKind.EqualsToken||!ts.isPropertyAccessExpression(node.left)||node.left.name.text!=='baseURL'||!ts.isPropertyAccessExpression(node.left.expression)||node.left.expression.name.text!=='defaults')return;
    const ref=c.ref(node.left.expression.expression),clientId=ref?.kind==='client'?ref.client.id:ref?.kind==='external'&&policy.clients.some(row=>row.kind==='axios'&&row.module===ref.module)?'frontend:axios-default:'+c.packageRoot(doc.file):undefined;
    if(clientId)clientDefaults.set(clientId,[...(clientDefaults.get(clientId)||[]),...c.values(node.right)]);
  });
  const wrapped=(node:ts.CallExpression):Http|undefined=>{const fn=functionNode(c.ref(node.expression)),summary=fn&&wrappers.get(fn);if(!summary)return;const arg=node.arguments[summary.parameter];return summary.input==='config'?{...configHttp(summary.http.client,arg,[...summary.http.basis,c.evidence(fn!,'包装函数继续调用 HTTP 客户端')]),wrapper:fn}:{...summary.http,url:arg,basis:[...summary.http.basis,c.evidence(fn!,'包装函数继续调用 HTTP 客户端')],wrapper:fn};};
  for(let n=0;n<policy.thresholds.referenceDepth.value;n++){const size=wrappers.size;for(const call of calls){const http=wrapped(call);if(http)findWrapper(call,http);}if(wrappers.size===size)break;}
  const reader=kernelReader(c,direct);
  for(const call of calls){const captured=reader.inspect(call),http=captured?.http||primitives.get(call)||wrapped(call);if(!http)continue;
    const value=captured?.value||c.value(http.url),url=value.text||'{url}',wholeParameter=/^\{[^}]+\}$/.test(url);
    const owner=c.owner(call),module=c.docs.get(call.getSourceFile().fileName)!.module;
    const methodNode=ts.isPropertyAccessExpression(call.expression)?call.expression.name:call.expression;
    const baseURLs=captured?.baseURLs||c.values(field(http.config,'baseURL'));if(!baseURLs.length||!c.property(http.config,'baseURL')&&clientDefaults.has(http.client.id))baseURLs.splice(0,baseURLs.length,...(clientDefaults.get(http.client.id)||http.client.baseURLs));
    const urlValues=captured?.urlValues||c.values(http.url),fixedRelativePath=(value:string)=>value.startsWith('/')&&!/^\/\{[^}]+\}/.test(value),unknown=(value.unknown&&!urlValues.length||urlValues.some(v=>v.unresolved&&!fixedRelativePath(v.value)))||wholeParameter||baseURLs.some(v=>v.unresolved);
    const record:FrontendHttpCall={id:`frontend:http:${module.file}:${call.getStart()}`,method:http.method,url,addressStatus:unknown?'unknown':/\{[^}]+\}/.test(url)?'parameterized':'known',...(unknown?{reason:value.reason||baseURLs.find(v=>v.unresolved)?.reason||'地址由调用参数提供'}:{}),expression:http.url?.getText()||http.config?.getText()||'',location:c.location(call),methodLocation:c.location(methodNode),moduleId:module.id,symbolId:owner.id,functionName:owner.name,baseURLs,urlValues,pageIds:[],componentModuleIds:[],basis:[c.evidence(call,'HTTP 调用位置','call'),...http.basis],conditions:[...http.client.conditions,...new Set([...baseURLs,...urlValues].flatMap(v=>v.conditions||[]))],test:module.test};
    let enclosing:ts.Node|undefined=call;let inFactory=false;while(enclosing){if(c.factories.has(enclosing)){inFactory=true;break;}enclosing=enclosing.parent;}
    const fn=[...c.functions].find(([,s])=>s.id===owner.id)?.[0],isTemplate=inFactory||captured?.template||!!fn&&wrappers.has(fn)&&c.model.calls.some(edge=>edge.to===owner.id);
    if(isTemplate)c.model.transports.push(record);else{const terminal=captured?.terminal||(http.wrapper?wrappers.get(http.wrapper)?.terminal:undefined);if(terminal&&terminal!==call)record.transportId=`frontend:http:${terminal.getSourceFile().fileName}:${terminal.getStart()}`;c.model.httpCalls.push(record);module.httpCallIds.push(record.id);}
  }
  extractPages(c);
  for(const doc of c.docs.values()){
    let jsx=false,store=false;visit(doc.sf,node=>{if(ts.isJsxElement(node)||ts.isJsxSelfClosingElement(node))jsx=true;if(ts.isCallExpression(node))for(const row of policy.stores)for(const name of row.exports)if(c.external(node.expression,row.module,name)){store=true;doc.module.basis.push(c.evidence(node,'状态容器来自 '+row.module));}});
    const pageIds=c.model.pages.filter(p=>p.componentModuleIds.includes(doc.module.id)).map(p=>p.id);doc.module.pageIds=pageIds;
    doc.component||=jsx;doc.module.role=pageIds.length?'page':doc.component?'component':store?'store':doc.module.httpCallIds.length||c.model.transports.some(t=>t.moduleId===doc.module.id)?'api':'utility';
    if(!doc.module.basis.length)doc.module.basis.push(c.evidence(doc.sf,pageIds.length?'路由指向这个页面':doc.component?'界面组件':doc.module.role==='api'?'包含 HTTP 客户端调用':'项目脚本文件'));
  }
  for(const doc of c.docs.values())if(doc.component){
    const link=(target:string,node:ts.Node)=>{if(target!==doc.module.id&&!c.model.componentUses.some(e=>e.from===doc.module.id&&e.to===target))c.model.componentUses.push({from:doc.module.id,to:target,location:c.location(node)});};
    visit(doc.sf,node=>{if(ts.isJsxSelfClosingElement(node)||ts.isJsxOpeningElement(node)){const ref=c.ref(node.tagName);if(ref?.kind==='node'){const target=c.docs.get(ref.node.getSourceFile().fileName);if(target?.component)link(target.module.id,node);}}});
    if(doc.file.endsWith('.vue')){const template=doc.raw.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,'').replace(/<!--[\s\S]*?-->/g,'');
      for(const statement of doc.sf.statements)if(ts.isImportDeclaration(statement)&&statement.importClause&&ts.isStringLiteral(statement.moduleSpecifier)){
        const file=c.resolveFile(doc.file,statement.moduleSpecifier.text),target=file?c.docs.get(file):undefined;if(!target?.component)continue;
        const names=[statement.importClause.name?.text,...statement.importClause.namedBindings&&ts.isNamedImports(statement.importClause.namedBindings)?statement.importClause.namedBindings.elements.map(e=>e.name.text):[]].filter((n):n is string=>!!n);
        if(names.some(n=>{const kebab=n.replace(/([a-z\d])([A-Z])/g,'$1-$2').toLowerCase();return new RegExp('<(?:'+n+'|'+kebab+')(?:\\s|/?>)').test(template);}))link(target.module.id,statement);
      }
    }
    const reachable=new Set(c.model.symbols.filter(s=>s.moduleId===doc.module.id).map(s=>s.id)),pending=[...reachable];while(pending.length){const id=pending.shift()!;for(const edge of c.model.calls.filter(e=>e.from===id))if(!reachable.has(edge.to)){reachable.add(edge.to);pending.push(edge.to);}}
    for(const http of c.model.httpCalls)if(reachable.has(http.symbolId))http.componentModuleIds.push(doc.module.id);
  }
  for(const page of c.model.pages){const components=new Set(page.componentModuleIds),queue=[...components];while(queue.length){const id=queue.shift()!;for(const edge of c.model.componentUses.filter(e=>e.from===id))if(!components.has(edge.to)){components.add(edge.to);queue.push(edge.to);}}
    for(const http of c.model.httpCalls)if(http.componentModuleIds.some(id=>components.has(id)))http.pageIds.push(page.id);
  }
  extractProxies(c);index.frontend=c.model;index.versions.frontend=policy.version;return c.model;
}

function extractPages(c:FrontendContext){
  const handled=new Set<ts.Node>();
  const components=(raw:ts.Node|undefined,seen=new Set<ts.Node>()):{name:string;file:string;node:ts.Node}[]=>{
    if(!raw||seen.has(raw))return[];seen.add(raw);const ref=c.ref(raw),node=ref?.kind==='node'?ref.node:raw;
    if(ts.isJsxElement(node)||ts.isJsxSelfClosingElement(node))return components(ts.isJsxElement(node)?node.openingElement.tagName:node.tagName,seen);
    if(ts.isCallExpression(node)&&node.expression.kind===ts.SyntaxKind.ImportKeyword&&ts.isStringLiteral(node.arguments[0])){const file=c.resolveFile(node.getSourceFile().fileName,node.arguments[0].text);return file?[{name:path.posix.basename(file).replace(/\.[^.]+$/,''),file,node:c.docs.get(file)!.sf}]:[];}
    if(ts.isFunctionLike(node)&&'body'in node&&node.body){const imports:ts.CallExpression[]=[];visit(node,n=>{if(ts.isCallExpression(n)&&n.expression.kind===ts.SyntaxKind.ImportKeyword)imports.push(n);});if(imports.length)return imports.flatMap(n=>components(n,seen));const file=node.getSourceFile().fileName;return[{name:c.nodeName(node),file,node}];}
    if(ts.isCallExpression(node)){const result=node.arguments.flatMap(arg=>components(arg,seen));if(result.length)return result;}
    if(ref?.kind==='node'&&node!==raw)return components(node,seen);
    if(ref?.kind==='node'&&(ts.isObjectLiteralExpression(node)||ts.isSourceFile(node)||ts.isClassDeclaration(node))){const file=node.getSourceFile().fileName;return[{name:c.value(field(node,'name')).unknown?path.posix.basename(file).replace(/\.[^.]+$/,''):c.value(field(node,'name')).text,file,node}];}
    return[];
  };
  const add=(node:ts.Node,paths:string[],rawPaths:string[],component:ts.Node|undefined,framework:string)=>{
    if(handled.has(node))return;handled.add(node);const targets=components(component);if(!targets.length){c.model.diagnostics.push({location:c.location(node),reason:'路由的页面组件没有静态定位'});return;}
    const page:FrontendPage={id:`frontend:page:${node.getSourceFile().fileName}:${node.getStart()}`,name:paths.join(' / ')+' · '+targets.map(t=>t.name).join(' / '),paths,rawPaths,componentNames:targets.map(t=>t.name),componentModuleIds:[...new Set(targets.map(t=>'file:'+t.file))],location:c.location(node),framework,test:c.docs.get(node.getSourceFile().fileName)?.module.test,basis:[c.evidence(node,'路由声明'),...targets.map(t=>c.evidence(t.node,'路由指向的组件','definition'))]};c.model.pages.push(page);
  };
  const object=(node:ts.Node|undefined)=>{const ref=c.ref(node);return ref?.kind==='node'?ref.node:node;};
  const array=(raw:ts.Node|undefined):ts.Node[]=>{const node=object(raw);return node&&ts.isArrayLiteralExpression(node)?node.elements.flatMap(n=>ts.isSpreadElement(n)?array(n.expression):[object(n)||n]):[];};
  const routes=(raw:ts.Node|undefined,parent='',framework='')=>{for(const item of array(raw)){
    if(!ts.isObjectLiteralExpression(item))continue;const route=field(item,'path'),values=ts.isArrayLiteralExpression(route||item)?array(route).map(n=>c.value(n).text):route?[c.value(route).text]:field(item,'index')?['']:[];
    const children=field(item,'children'),component=field(item,'component')||field(item,'element')||field(item,'Component');
    if(children&&array(children).length){routes(children,combine(parent,values[0]||''),framework);continue;}
    if(!component||!values.length)continue;const aliases=field(item,'alias'),rawPaths=[...values,...aliases?(ts.isArrayLiteralExpression(aliases)?array(aliases).map(n=>c.value(n).text):[c.value(aliases).text]):[]];add(item,rawPaths.map(value=>combine(parent,value)),rawPaths,component,framework);
  }};
  const jsxAttribute=(node:ts.JsxOpeningLikeElement,name:string)=>{const attr=node.attributes.properties.find(p=>ts.isJsxAttribute(p)&&p.name.getText()===name);return attr&&ts.isJsxAttribute(attr)&&attr.initializer?(ts.isJsxExpression(attr.initializer)?attr.initializer.expression:attr.initializer):undefined;};
  const jsxRoutes=(node:ts.Node,parent='')=>{
    if(ts.isJsxElement(node)||ts.isJsxSelfClosingElement(node)){const opening=ts.isJsxElement(node)?node.openingElement:node;
      const match=policy.routers.find(r=>r.kind==='jsx'&&r.functions.some(name=>c.external(opening.tagName,r.module,name)));
      if(match){const route=jsxAttribute(opening,'path'),rawPaths=route?(ts.isArrayLiteralExpression(route)?route.elements.map(n=>c.value(n).text):[c.value(route).text]):[''];const paths=rawPaths.map(value=>combine(parent,value)),component=jsxAttribute(opening,'component')||jsxAttribute(opening,'element');
        const nested=ts.isJsxElement(node)&&node.children.some(child=>ts.isJsxElement(child)||ts.isJsxSelfClosingElement(child));
        if(component&&!nested)add(node,paths,rawPaths,component,match.module);if(ts.isJsxElement(node))for(const child of node.children)jsxRoutes(child,paths[0]);return;
      }
    }node.forEachChild(child=>jsxRoutes(child,parent));
  };
  for(const doc of c.docs.values()){
    jsxRoutes(doc.sf);
    let routerModule=false;
    visit(doc.sf,node=>{
      if(ts.isCallExpression(node)||ts.isNewExpression(node))for(const row of policy.routers.filter(r=>r.kind==='object'))for(const name of row.functions)if(c.external(node.expression,row.module,name)){
        routerModule=true;
        const first=object(node.arguments?.[0]);routes(ts.isArrayLiteralExpression(first||node)?first:field(first,'routes'),'',row.module);
      }
      if(ts.isCallExpression(node)&&ts.isCallExpression(node.expression))for(const row of policy.routers.filter(r=>r.kind==='file'))for(const name of row.functions)if(c.external(node.expression.expression,row.module,name)){
        const component=field(object(node.arguments[0]),'component'),targets=components(component);let layout=false;for(const target of targets)visit(target.node,n=>{if((ts.isJsxSelfClosingElement(n)||ts.isJsxOpeningElement(n))&&c.external(n.tagName,row.module,'Outlet'))layout=true;});if(!layout){const rawPath=c.value(node.expression.arguments[0]).text;add(node,[rawPath],[rawPath],component,row.module);}
      }
    });
    // Exported route tables in the same router module include permission-gated routes registered later.
    if(routerModule)for(const statement of doc.sf.statements)if(ts.isVariableStatement(statement)&&statement.modifiers?.some(m=>m.kind===ts.SyntaxKind.ExportKeyword))for(const declaration of statement.declarationList.declarations)if(declaration.initializer&&ts.isArrayLiteralExpression(unwrap(declaration.initializer)))routes(declaration.initializer,'','路由表');
  }
}

function extractProxies(c:FrontendContext){
  for(const [file,text] of c.configs){
    if(/(?:vite|vue)\.config\.[cm]?[jt]s$/.test(file)){
      const sf=c.docs.get(file)?.sf||ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true);
      visit(sf,node=>{if(!ts.isPropertyAssignment(node)||key(node.name)!=='proxy')return;const config=unwrap(node.initializer);if(!ts.isObjectLiteralExpression(config))return;
        for(const prop of config.properties)if(ts.isPropertyAssignment(prop)){const target=field(prop.initializer,'target')||prop.initializer,rewrite=field(prop.initializer,'rewrite')||field(prop.initializer,'pathRewrite'),prefixes=ts.isComputedPropertyName(prop.name)?c.values(prop.name.expression):[{value:key(prop.name)||prop.name.getText(),location:c.location(prop.name)}];for(const prefix of prefixes)for(const value of c.values(target))c.model.proxies.push({prefix:prefix.value,prefixSource:prefix,target:value,location:c.location(prop),unitId:c.unit(file)?.id,...rewrite?{rewrite:{expression:rewrite.getText(),location:c.location(rewrite)}}:{}});}
      });
    }
    if(path.posix.basename(file)==='package.json'){try{const json=JSON.parse(text);if(typeof json.proxy==='string'){const start=text.slice(0,text.indexOf('"proxy"')).split('\n').length-1,location={file,range:{start:{line:start,character:0},end:{line:start,character:0}}};c.model.proxies.push({prefix:'/',target:{value:json.proxy,location},location,unitId:c.unit(file)?.id});}}catch{/* Package diagnostics belong to discovery. */}}
  }
}
