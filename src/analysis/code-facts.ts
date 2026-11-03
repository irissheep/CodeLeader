import type Parser from 'web-tree-sitter';
import type { Evidence, Location, SymbolInfo } from '../shared/model';
import { offsetsRange } from '../shared/ranges';
type Node=Parser.SyntaxNode;
export interface Value {text:string;literal?:string;callee?:string;args?:{name?:string;value:Value}[]}
export interface Assignment {scope:string;left:string;value:Value;location:Location;conditions:string[];offset?:number}
export interface CodeCall {scope:string;callee:string;args:{name?:string;value:Value}[];location:Location;conditions:string[];text:string}
export interface Definition {id:string;params:{name:string;type:string;annotation:string}[];annotations:string;location:Location;returnType?:string;bases?:string[];returns?:Value[]}
export interface CodeFacts {definitions:Definition[];fields:{owner:string;name:string;type:string;annotations:string;location:Location}[];assignments:Assignment[];calls:CodeCall[];imports:{scope:string;name:string;target:string;location:Location}[]}
export function codeFacts(root:Node,text:string,file:string,symbols:SymbolInfo[]):CodeFacts{
 const facts:CodeFacts={definitions:[],fields:[],assignments:[],calls:[],imports:[]};
 const location=(n:Node):Location=>({file,range:offsetsRange(text,n.startIndex,n.endIndex)});
 const value=(n:Node,depth=0):Value=>{
  const v:Value={text:n.text};
  if(['string','string_literal','text_block'].includes(n.type)&&!n.descendantsOfType('interpolation').length){const raw=n.text.replace(/^(?:[rub]+)?(?:"""|'''|"|')/i,'').replace(/(?:"""|'''|"|')$/,'');v.literal=raw.replace(/\\"/g,'"').replace(/\\n/g,'\n');}
  if(depth<8&&['call','object_creation_expression','method_invocation'].includes(n.type)){
   v.callee=n.childForFieldName('function')?.text||[n.childForFieldName('object')?.text,n.childForFieldName('name')?.text||n.childForFieldName('type')?.text].filter(Boolean).join('.');
   v.args=(n.childForFieldName('arguments')?.namedChildren||[]).map(a=>({name:a.type==='keyword_argument'?a.childForFieldName('name')?.text:undefined,value:value(a.childForFieldName('value')||a,depth+1)}));
  }return v;
 };
 function visit(n:Node,scope:string,conditions:string[]){
  const name=n.childForFieldName('name'),symbol=name&&symbols.find(s=>s.selection.start.line===location(name).range.start.line&&s.selection.start.character===location(name).range.start.character);
  if(symbol){
   const modifiers=n.namedChildren.find(c=>c.type==='modifiers');
   facts.definitions.push({id:symbol.id,location:location(n),annotations:modifiers?.namedChildren.filter(c=>c.type.includes('annotation')).map(c=>c.text).join('\n')||(n.parent?.type==='decorated_definition'?n.parent.namedChildren.filter(c=>c.type==='decorator').map(c=>c.text).join('\n'):''),params:(n.childForFieldName('parameters')?.namedChildren||[]).map(p=>({name:p.type==='identifier'?p.text:p.childForFieldName('name')?.text||p.namedChildren.find(c=>c.type==='identifier')?.text||'',type:p.childForFieldName('type')?.text||'',annotation:p.namedChildren.find(c=>c.type==='modifiers')?.text||''}))});
   facts.definitions.at(-1)!.returnType=n.childForFieldName('type')?.text;
   facts.definitions.at(-1)!.bases=n.childForFieldName('superclasses')?.namedChildren.filter(c=>c.type!=='keyword_argument').map(c=>c.text);
   const body=n.childForFieldName('body'),doc=body?.namedChildren[0],prev=n.previousNamedSibling||n.parent?.previousNamedSibling;
   const comment=file.endsWith('.py')&&doc?.type==='expression_statement'&&doc.firstNamedChild?.type==='string'?doc.text:prev?.type.includes('comment')?prev.text:'';
   symbol.summary=comment.replace(/^(?:\s*\/\*\*?|\s*#|\s*\/\/|\s*"""|\s*''')/,'').split(/\r?\n/).map(l=>l.replace(/^\s*\*\s?/,''))[0].replace(/(?:\*\/|"""|''')$/,'').trim().slice(0,100)||undefined;
   if(!symbol.summary&&body?.namedChildren.some(c=>c.type==='return_statement'&&/^return\s*\{\s*["']status["']\s*:/.test(c.text)))symbol.summary='返回健康状态与配置';
   symbol.auxiliary=/^(?:get[A-Z]|set[A-Z])/.test(symbol.name)||/^(?:__init__|authorize|configured|requireConfigured)$/.test(symbol.name)||/\/generated\//.test('/'+file);
   scope=symbol.id;
  }
  if(n.type==='if_statement'||n.type==='conditional_expression'||n.type==='ternary_expression'){
   const condition=n.childForFieldName('condition')?.text;
   if(condition){const conditionNode=n.childForFieldName('condition'),alternative=n.childForFieldName('alternative');for(const child of n.namedChildren)visit(child,scope,[...conditions,...(child.startIndex===conditionNode?.startIndex?[]:[child.startIndex===alternative?.startIndex?'!('+condition+')':condition])]);return;}
  }
  if(['assignment','assignment_expression','variable_declarator'].includes(n.type)){
   const left=n.childForFieldName('left')||n.childForFieldName('name'),right=n.childForFieldName('right')||n.childForFieldName('value');
   if(left&&right)facts.assignments.push({scope,left:left.text,value:value(right),location:location(n),conditions,offset:n.startIndex});
  }
  if(n.type==='field_declaration')for(const variable of n.namedChildren.filter(c=>c.type==='variable_declarator'))facts.fields.push({owner:scope,name:variable.childForFieldName('name')?.text||'',type:n.childForFieldName('type')?.text||'',annotations:n.namedChildren.find(c=>c.type==='modifiers')?.text||'',location:location(n)});
  if(n.type==='return_statement'&&n.firstNamedChild){const definition=facts.definitions.find(d=>d.id===scope);if(definition)(definition.returns||=[]).push(value(n.firstNamedChild));}
  if(n.type==='as_pattern'&&n.firstNamedChild?.type==='call'){const alias=n.childForFieldName('alias')||n.namedChildren.at(-1);if(alias)facts.assignments.push({scope,left:alias.text,value:value(n.firstNamedChild),location:location(n),conditions});}
  if(['call','method_invocation','object_creation_expression'].includes(n.type)){const v=value(n);facts.calls.push({scope,callee:v.callee||'',args:v.args||[],location:location(n),conditions,text:n.text});}
  if(['import_statement','import_from_statement','import_declaration'].includes(n.type)){
   const from=n.text.match(/^from\s+([\w.]+)\s+import\s+/)?.[1];
   for(const part of n.text.replace(/^from\s+[\w.]+\s+import\s+/,'').replace(/^import\s+(?:static\s+)?/,'').replace(/[();\r\n]/g,'').split(',')){const [original,alias]=part.trim().split(/\s+as\s+/);if(original)facts.imports.push({scope,name:alias||original.split('.').at(-1)!,target:from?`${from}.${original}`:original,location:location(n)});}
  }
  for(const child of n.namedChildren)visit(child,scope,conditions);
 }
 visit(root,`file:${file}`,[]);return facts;
}
export const basis=(kind:Evidence['kind'],location:Location,note:string):Evidence=>({kind,location,note});
