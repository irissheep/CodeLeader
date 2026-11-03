import type Parser from 'web-tree-sitter';
import type {Location,SymbolInfo} from '../shared/model';
import {offsetsRange} from '../shared/ranges';
type Node=Parser.SyntaxNode;
export interface PyExpression {
 kind:'literal'|'ref'|'join'|'list'|'dict'|'call'|'unknown';text:string;location:Location;
 value?:string|number|boolean|null;name?:string;items?:PyExpression[];
 callee?:PyExpression;args?:{name?:string;value:PyExpression}[];
 sequence?:string;pairs?:{key:PyExpression;value:PyExpression}[];
}
export interface PyHttpBinding {name:string;scope:string;offset:number;expression:PyExpression}
export interface PyHttpCall {scope:string;expression:PyExpression;conditions:Location[]}
export interface PyHttpFacts {bindings:PyHttpBinding[];calls:PyHttpCall[];decorators:{symbolId:string;scope:string;expression:PyExpression;location:Location}[]}
export function pythonHttpFacts(root:Node,text:string,file:string,symbols:SymbolInfo[]):PyHttpFacts{
 const facts:PyHttpFacts={bindings:[],calls:[],decorators:[]},byOffset=new Map(symbols.map(s=>[Number(s.id.split(':').at(-2)),s]));
 const loc=(node:Node):Location=>({file,range:offsetsRange(text,node.startIndex,node.endIndex)});
 const decode=(value:string,raw=false)=>raw?value:value.replace(/\\(?:x([0-9a-f]{2})|u([0-9a-f]{4})|([\\'"nrt]))/gi,(_,hex,unicode,c)=>hex||unicode?String.fromCodePoint(parseInt(hex||unicode,16)):({n:'\n',r:'\r',t:'\t'} as Record<string,string>)[c]||c);
 function expression(node:Node):PyExpression{
  const value:PyExpression={kind:'unknown',text:node.text,location:loc(node)};
  if(['identifier','attribute'].includes(node.type))return{...value,kind:'ref',name:node.text};
  if(['true','false','none','integer'].includes(node.type))return{...value,kind:'literal',value:node.type==='true'?true:node.type==='false'?false:node.type==='none'?null:Number(node.text)};
  if(node.type==='string'){
   const raw=/^[rubf]*r/i.test(node.text),interpolated=node.descendantsOfType('interpolation').length>0;
   if(!interpolated){const m=node.text.match(/^[rubf]*("""|'''|"|')([\s\S]*)\1$/i);if(m)return{...value,kind:'literal',value:decode(m[2],raw)};}
   const items:PyExpression[]=[];for(const child of node.children){if(child.type==='string_content')items.push({kind:'literal',text:child.text,location:loc(child),value:decode(child.text,raw).replaceAll('{{','{').replaceAll('}}','}')});if(child.type==='interpolation'){const inner=child.namedChildren.find(c=>!['format_specifier','type_conversion'].includes(c.type));if(inner)items.push(child.namedChildren.some(c=>['format_specifier','type_conversion'].includes(c.type))?{kind:'unknown',name:inner.text,text:child.text,location:loc(child)}:expression(inner));}}
   return{...value,kind:'join',items};
  }
  if(node.type==='concatenated_string')return{...value,kind:'join',items:node.namedChildren.map(expression)};
  if(['list','tuple','set','expression_list'].includes(node.type))return{...value,kind:'list',sequence:node.type,items:node.namedChildren.map(expression)};
  if(node.type==='dictionary')return{...value,kind:'dict',pairs:node.namedChildren.filter(n=>n.type==='pair').map(n=>({key:expression(n.childForFieldName('key')!),value:expression(n.childForFieldName('value')!)}))};
  if(node.type==='parenthesized_expression'&&node.namedChildren[0])return expression(node.namedChildren[0]);
  if(node.type==='binary_operator'&&node.children.some(c=>c.type==='+'))return{...value,kind:'join',items:node.namedChildren.map(expression)};
  if(node.type==='call'){const fn=node.childForFieldName('function')!,args=node.childForFieldName('arguments');return{...value,kind:'call',callee:expression(fn),args:(args?.namedChildren||[]).map(arg=>arg.type==='keyword_argument'?{name:arg.childForFieldName('name')?.text,value:expression(arg.childForFieldName('value')!)}:{value:expression(arg)})};}
  return value;
 }
 function visit(node:Node,scope:string,conditions:Location[]){
  const name=node.childForFieldName('name'),symbol=name&&byOffset.get(name.startIndex);
  if(node.type==='assignment'){const left=node.childForFieldName('left'),right=node.childForFieldName('right');if(left?.type==='identifier')facts.bindings.push({name:left.text,scope,offset:node.startIndex,expression:right?expression(right):{kind:'unknown',text:left.text,location:loc(left)}});}
  if(node.type==='call'&&node.parent?.type!=='decorator')facts.calls.push({scope,expression:expression(node),conditions});
  if(symbol){for(const decorator of node.parent?.type==='decorated_definition'?node.parent.namedChildren.filter(n=>n.type==='decorator'):[]){const call=decorator.namedChildren[0];if(call)facts.decorators.push({symbolId:symbol.id,scope,expression:expression(call),location:loc(decorator)});}scope=symbol.id;}
  if(node.type==='if_statement')conditions=[...conditions,loc(node.childForFieldName('condition')||node)];
  for(const child of node.namedChildren)visit(child,scope,conditions);
 }
 visit(root,`${file}:module`,[]);return facts;
}
