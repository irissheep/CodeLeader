import type Parser from 'web-tree-sitter';
import type {Evidence,Location,SymbolInfo} from '../shared/model';
import {offsetsRange} from '../shared/ranges';
type Node=Parser.SyntaxNode;
function referenceName(node:Node):string|undefined{
 if(['identifier','type_identifier'].includes(node.type))return node.text;
 if(!['field_access','scoped_identifier'].includes(node.type))return;
 const parts=node.namedChildren.filter(n=>!n.type.includes('comment')).map(referenceName);
 return parts.every(p=>p!==undefined)?parts.join('.'):undefined;
}
export type JavaExpression={kind:'string'|'reference'|'concat'|'array'|'unknown';text:string;location:Location;value?:string;items?:JavaExpression[]};
export interface JavaAnnotation {name:string;location:Location;args:Record<string,JavaExpression>}
export interface JavaFileValues {
 package:string;imports:{target:string;static:boolean;location:Location}[];
 types:{id:string;name:string;parent?:string}[];
 fields:{owner:string;name:string;constant:boolean;value?:JavaExpression;location:Location}[];
}
function stringValue(raw:string):string|undefined{
 if(!raw.startsWith('"')||raw.startsWith('"""'))return;
 let value='';const escapes:Record<string,string>={b:'\b',t:'\t',n:'\n',f:'\f',r:'\r',s:' ',"'":"'",'"':'"','\\':'\\'};
 for(let i=1;i<raw.length-1;i++){
  if(raw[i]!=='\\'){value+=raw[i];continue;}
  const rest=raw.slice(++i),unicode=rest.match(/^u+([\da-fA-F]{4})/),octal=rest.match(/^(?:[0-3][0-7]{0,2}|[4-7][0-7]?)/);
  if(unicode){value+=String.fromCharCode(parseInt(unicode[1],16));i+=unicode[0].length-1;}
  else if(octal){value+=String.fromCharCode(parseInt(octal[0],8));i+=octal[0].length-1;}
  else if(raw[i] in escapes)value+=escapes[raw[i]];else return;
 }
 return value;
}
export function javaExpression(node:Node,text:string,file:string):JavaExpression{
 const base={text:node.text,location:{file,range:offsetsRange(text,node.startIndex,node.endIndex)}};
 if(node.type==='string_literal'){const value=stringValue(node.text);return{...base,kind:value===undefined?'unknown':'string',value};}
 if(['identifier','field_access','scoped_identifier'].includes(node.type)){const value=referenceName(node);return{...base,kind:value===undefined?'unknown':'reference',value};}
 if(node.type==='parenthesized_expression'&&node.firstNamedChild)return javaExpression(node.firstNamedChild,text,file);
 if(node.type==='element_value_array_initializer')return{...base,kind:'array',items:node.namedChildren.filter(n=>!n.type.includes('comment')).map(n=>javaExpression(n,text,file))};
 if(node.type==='binary_expression'&&node.childForFieldName('operator')?.text==='+')return{...base,kind:'concat',items:[node.childForFieldName('left')!,node.childForFieldName('right')!].map(n=>javaExpression(n,text,file))};
 return{...base,kind:'unknown'};
}
export function javaAnnotation(node:Node,text:string,file:string):JavaAnnotation{
 const args:Record<string,JavaExpression>={};
 for(const arg of node.namedChildren.find(n=>n.type==='annotation_argument_list')?.namedChildren||[]){
  if(arg.type.includes('comment'))continue;
  const key=arg.childForFieldName('key'),value=arg.childForFieldName('value');
  args[key?.text||'value']=javaExpression(value||arg,text,file);
 }
 return{name:node.childForFieldName('name')?.text||'',location:{file,range:offsetsRange(text,node.startIndex,node.endIndex)},args};
}
export function javaFileValues(root:Node,text:string,file:string,symbols:SymbolInfo[]):JavaFileValues{
 const packageName=root.namedChildren.find(n=>n.type==='package_declaration')?.namedChildren.find(n=>['identifier','scoped_identifier'].includes(n.type));
 const facts:JavaFileValues={package:packageName?referenceName(packageName)||'':'',imports:[],types:symbols.filter(s=>['class','interface'].includes(s.kind)).map(s=>({id:s.id,name:s.qualifiedName,parent:s.parent})),fields:[]};
 const byOffset=new Map(symbols.map(s=>[Number(s.id.split(':').at(-2)),s]));
 const location=(n:Node):Location=>({file,range:offsetsRange(text,n.startIndex,n.endIndex)});
 function visit(node:Node,owner?:string){
  const symbol=byOffset.get(node.childForFieldName('name')?.startIndex??-1);
  if(symbol&&['class','interface'].includes(symbol.kind))owner=symbol.id;
  if(node.type==='annotation_type_declaration'){
   const name=node.childForFieldName('name')!,parent=facts.types.find(t=>t.id===owner),id=`annotation:${file}:${name.startIndex}`;
   facts.types.push({id,name:[parent?.name||facts.package,name.text].filter(Boolean).join('.'),parent:owner});owner=id;
  }
  if(node.type==='class_body'&&node.parent?.type==='object_creation_expression')return;
  if(node.type==='import_declaration'){
   const name=node.namedChildren.find(n=>['identifier','scoped_identifier'].includes(n.type)),target=name&&referenceName(name);
   if(target)facts.imports.push({target:target+(node.children.some(n=>n.type==='asterisk')?'.*':''),static:node.children.some(n=>n.type==='static'),location:location(node)});
  }
  if(owner&&['field_declaration','constant_declaration'].includes(node.type)){
   const modifiers=node.namedChildren.find(n=>n.type==='modifiers'),constant=node.type==='constant_declaration'||['static','final'].every(word=>modifiers?.children.some(n=>n.type===word));
   for(const variable of node.namedChildren.filter(n=>n.type==='variable_declarator'))facts.fields.push({owner,name:variable.childForFieldName('name')!.text,constant:constant&&['String','java.lang.String'].includes(node.childForFieldName('type')?.text||''),value:variable.childForFieldName('value')?javaExpression(variable.childForFieldName('value')!,text,file):undefined,location:location(variable)});
  }
  for(const child of node.namedChildren)visit(child,owner);
 }
 visit(root);return facts;
}
export interface JavaValue {value?:string;kind?:'string'|'enum';basis:Evidence[];issue?:{location:Location;expression:string;reason:string}}
export function annotationValues(files:Map<string,JavaFileValues>,symbols:SymbolInfo[],knownTypes:string[],enumType:{type:string;values:string[]},maxDepth:number){
 const byId=new Map(symbols.map(s=>[s.id,s])),types=[...files.values()].flatMap(f=>f.types),fields=[...files].flatMap(([file,f])=>f.fields.map(field=>({...field,file}))),known=new Set([...knownTypes,enumType.type,...types.map(t=>t.name)]);
 const chain=(owner:string):string[]=>{const found:string[]=[];for(let id:string|undefined=owner;id&&!found.includes(id);id=byId.get(id)?.parent||types.find(t=>t.id===id)?.parent)found.push(id);return found;};
 const unique=(names:string[])=>[...new Set(names)];
 function typeName(name:string,file:string,owner:string):string|undefined{
  if(known.has(name))return name;
  const f=files.get(file)!;
  for(const id of chain(owner)){const type=types.find(t=>t.id===id);if(!type)continue;const local=unique([type.name+'.'+name,...type.name.endsWith('.'+name.split('.')[0])?[type.name+name.slice(name.indexOf('.')===-1?name.length:name.indexOf('.'))]:[]].filter(n=>known.has(n)));if(local.length)return local.length===1?local[0]:undefined;}
  const head=name.split('.')[0],tail=name.slice(head.length),explicit=unique(f.imports.filter(i=>!i.static&&i.target.endsWith('.'+head)).map(i=>i.target+tail));
  if(explicit.length)return explicit.length===1?explicit[0]:undefined;
  const same=[f.package,name].filter(Boolean).join('.');if(known.has(same))return same;
  const wildcard=unique(f.imports.filter(i=>!i.static&&i.target.endsWith('.*')).map(i=>i.target.slice(0,-1)+name).filter(n=>known.has(n)));
  return wildcard.length===1?wildcard[0]:undefined;
 }
 const proof=(location:Location,note:string):Evidence=>({kind:'declaration',location,note});
 const failed=(e:JavaExpression,reason:string,basis:Evidence[]=[]):JavaValue=>({basis,issue:{location:e.location,expression:e.text,reason}});
 function evaluate(e:JavaExpression,file:string,owner:string,seen=new Set<string>()):JavaValue[]{
  if(seen.size>maxDepth)return[failed(e,'常量引用层数太多，未继续读取')];
  if(e.kind==='array')return(e.items||[]).flatMap(item=>evaluate(item,file,owner,seen));
  if(e.kind==='string')return[{value:e.value,kind:'string',basis:[proof(e.location,'注解中的字符串')]}];
  if(e.kind==='concat'){
   const parts=e.items!.map(item=>evaluate(item,file,owner,seen));
   if(parts.some(p=>p.length!==1||p[0].kind!=='string'||p[0].issue))return[failed(e,parts.flat().find(v=>v.issue)?.issue?.reason||'拼接中有不能作为字符串常量的值',parts.flatMap(p=>p.flatMap(v=>v.basis)))];
   return[{value:parts.map(p=>p[0].value).join(''),kind:'string',basis:parts.flatMap(p=>p[0].basis)}];
  }
  if(e.kind!=='reference')return[failed(e,'表达式不是可直接读取的字符串或枚举常量')];
  const name=e.value!,f=files.get(file)!,dot=name.lastIndexOf('.'),fieldName=dot<0?name:name.slice(dot+1);let candidates:typeof fields=[],imports:JavaFileValues['imports']=[];
  if(dot>=0){const type=typeName(name.slice(0,dot),file,owner);candidates=fields.filter(field=>types.find(t=>t.id===field.owner)?.name===type&&field.name===fieldName);}
  else{
   for(const id of chain(owner)){candidates=fields.filter(field=>field.owner===id&&field.name===name);if(candidates.length)break;}
   if(!candidates.length){const direct=f.imports.filter(i=>i.static&&i.target.endsWith('.'+name));imports=direct.length?direct:f.imports.filter(i=>i.static&&i.target.endsWith('.*'));candidates=fields.filter(field=>field.name===name&&imports.some(i=>i.target===(types.find(t=>t.id===field.owner)?.name+'.'+name)||i.target===(types.find(t=>t.id===field.owner)?.name+'.*')));}
  }
  const evidence=imports.map(i=>proof(i.location,'从这里静态导入'));
  if(candidates.length>1)return[failed(e,'同名常量有多个来源，不能选定一个',evidence)];
  if(candidates.length===1){const field=candidates[0],key=field.file+':'+field.owner+':'+field.name;
   if(!field.constant||!field.value)return[failed(e,`${name} 不是有固定值的 static final String`,[...evidence,proof(field.location,'字段在这里定义')])];
   if(seen.has(key))return[failed(e,'常量之间循环引用',[...evidence,proof(field.location,'循环引用的位置')])];
   return evaluate(field.value,field.file,field.owner,new Set([...seen,key])).map(value=>({...value,basis:[proof(e.location,'引用这个常量'),...evidence,proof(field.location,'常量在这里定义'),...value.basis]}));
  }
  const qualified=dot<0?unique(imports.map(i=>i.target.endsWith('.*')?i.target.slice(0,-1)+name:i.target)): [typeName(name.slice(0,dot),file,owner)+'.'+fieldName];
  if(qualified.length===1&&qualified[0]===enumType.type+'.'+fieldName&&enumType.values.includes(fieldName))return[{value:fieldName,kind:'enum',basis:[proof(e.location,'HTTP 方法的枚举引用'),...evidence,...f.imports.filter(i=>!i.static&&(i.target===enumType.type||i.target===enumType.type.slice(0,enumType.type.lastIndexOf('.'))+'.*')).map(i=>proof(i.location,'枚举类型从这里导入'))]}];
  return[failed(e,`${name} 在项目中没有可确认的常量或 HTTP 方法来源`,evidence)];
 }
 return{evaluate,typeName};
}
