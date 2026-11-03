import ts from 'typescript';
import {FrontendContext,unwrap} from './frontend-context';
import type {Client} from './frontend-context';
import type {Evidence} from '../shared/model';
import type {FrontendValue} from '../shared/frontend-model';
import policy from '../shared/frontend-policy.json';

export type Http={client:Client;method:string;url?:ts.Node;config?:ts.Node;basis:Evidence[];wrapper?:ts.Node};
export interface CapturedHttp {http:Http;value:ReturnType<FrontendContext['value']>;urlValues:FrontendValue[];baseURLs:FrontendValue[];template:boolean;terminal:ts.CallExpression}

/** Follow arguments to a real transport. Member names and generated filenames are irrelevant. */
export function kernelReader(c:FrontendContext,direct:(call:ts.CallExpression)=>Http|undefined){
 const materialize=(http:Http,root:ts.CallExpression,terminal:ts.CallExpression):CapturedHttp|undefined=>{
  const inside=(node:ts.Node)=>root.arguments.some(a=>a.getSourceFile()===node.getSourceFile()&&a.pos<=node.pos&&node.end<=a.end);
  let route:ts.Node|undefined,used=false,formal=false,prefix='',beforeRoute=true,authoredPath=false,fixedPath=false;
  const prefixInputs:ts.Node[]=[];
  const seen=new Set<ts.Node>();
  const parts=(raw:ts.Node|undefined,depth=0)=>{
   if(!raw||seen.has(raw)||depth>policy.thresholds.referenceDepth.value)return;seen.add(raw);const node=unwrap(raw),value=c.value(node);used||=inside(node);
   if(inside(node)&&value.text.startsWith('/')&&!value.text.startsWith('//')){route=node;beforeRoute=false;return;}
   const bound=c.bound(node);if(bound&&bound!==node){parts(bound,depth+1);return;}
   if(ts.isTemplateExpression(node)){authoredPath||=!inside(node)&&node.head.text.startsWith('/');fixedPath||=inside(node)&&[node.head.text,...node.templateSpans.map(s=>s.literal.text)].some(s=>s.startsWith('/'));if(beforeRoute)prefix+=node.head.text;for(const span of node.templateSpans){parts(span.expression,depth+1);if(beforeRoute)prefix+=span.literal.text;}return;}
   if(ts.isBinaryExpression(node)&&node.operatorToken.kind===ts.SyntaxKind.PlusToken){parts(node.left,depth+1);parts(node.right,depth+1);return;}
   const ref=c.ref(node);if(ref?.kind==='node'&&ref.node!==node&&!ts.isFunctionLike(ref.node)&&!c.parameter(node)){parts(ref.node,depth+1);return;}
   if(ts.isSpreadElement(node)){parts(node.expression,depth+1);return;}
   formal||=c.parameter(node);authoredPath||=!inside(node)&&ts.isStringLiteralLike(node)&&node.text.startsWith('/');if(beforeRoute){prefix+=value.text;prefixInputs.push(node);}
  };
  parts(http.url);
  if(root!==terminal&&(!used||!route&&authoredPath))return;
  if(!http.url&&http.config)formal||=c.parameter(http.config);
  const selected=root===terminal?undefined:route,value=c.value(selected||http.url),baseURLs=c.values(c.property(http.config,'baseURL'));
  if(selected&&prefix&&!baseURLs.length){const values=prefixInputs.length===1&&c.value(prefixInputs[0]).text===prefix?c.values(prefixInputs[0]):[];if(values.length)baseURLs.push(...values);else baseURLs.push({value:prefix,location:c.location(http.url!),expression:http.url!.getText(),unresolved:/\{[^}]+\}/.test(prefix),reason:/\{[^}]+\}/.test(prefix)?c.value(http.url).reason||'地址中的前缀没有固定值':undefined});}
  if(!baseURLs.length)baseURLs.push(...http.client.baseURLs);
  if(selected&&prefixInputs.some(n=>ts.isPropertyDeclaration(n.parent)))for(const base of baseURLs)base.conditions=[...base.conditions||[],'按类中写的默认地址；创建对象时可以更改'];
  return{http,value,urlValues:c.values(selected||http.url),baseURLs,template:formal&&!route&&!fixedPath,terminal};
 };
 const inspect=(root:ts.CallExpression):CapturedHttp|undefined=>{
  const active=new Set<ts.Node>();
  const trace=(call:ts.CallExpression,depth=0):CapturedHttp|undefined=>{
   if(depth>policy.thresholds.referenceDepth.value)return;
   const primitive=direct(call);if(primitive)return materialize(primitive,root,call);
   const ref=c.ref(call.expression),fn=ref?.kind==='node'?ref.node:undefined;
   if(!fn||!ts.isFunctionLike(fn)||!('body'in fn)||!fn.body||active.has(fn))return;
   active.add(fn);
   try{return c.withCall(fn,call,()=>{
    const calls:ts.CallExpression[]=[];const walk=(node:ts.Node)=>{if(node!==fn&&ts.isFunctionLike(node))return;if(ts.isCallExpression(node))calls.push(node);node.forEachChild(walk);};walk(fn.body!);
    for(const nested of calls){const found=trace(nested,depth+1);if(found){found.http={...found.http,basis:[...found.http.basis,c.evidence(fn,'参数继续传给 HTTP 客户端')]};return found;}}
   });}finally{active.delete(fn);}
  };
  return trace(root);
 };
 return{inspect};
}
