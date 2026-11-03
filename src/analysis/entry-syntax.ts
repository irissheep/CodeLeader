import type Parser from 'web-tree-sitter';
import type { SymbolInfo, Location, EntryPoint } from '../shared/model';
import { offsetsRange } from '../shared/ranges';
import type {PyHttpFacts} from './python-http-facts';
import {javaAnnotation,javaFileValues,type JavaAnnotation,type JavaFileValues} from './java-annotation-values';
type Node=Parser.SyntaxNode;
export interface Binding {name:string;kind:'import'|'call'|'alias'|'other';value:string;offset:number;prefix?:string|null}
export interface Scope {id:string;parent?:string;bindings:Binding[]}
export interface RouteSyntax {scope:string;symbolId:string;object:string;method:string;path:string|null;offset:number;location:Location}
export interface AttachSyntax {scope:string;object:string;child:string;prefix:string|null;offset:number}
export interface SyntaxFacts {python?:PyHttpFacts;javaValues?:JavaFileValues;scopes:Scope[];routes:RouteSyntax[];attachments:AttachSyntax[];java:{symbolId:string;annotations:string;values:JavaAnnotation[]}[];mains:EntryPoint[];javaPackage:string;annotationNames:string[]}
export const sourceArea=(file:string)=>file.includes('/src/')?file.split('/src/')[0]:file.includes('/')?file.split('/')[0]:'项目根目录';
function literal(n:Node|null|undefined):string|null {
  if(!n||n.type!=='string'||n.descendantsOfType('interpolation').length)return null;
  const match=n.text.match(/^(['"])([\s\S]*)\1$/);return match?match[2]:null;
}
function argument(call:Node,name:string){return call.childForFieldName('arguments')?.namedChildren.find(n=>n.type==='keyword_argument'&&n.childForFieldName('name')?.text===name)?.childForFieldName('value');}
export function entrySyntax(tree:Node,text:string,file:string,symbols:SymbolInfo[]):SyntaxFacts {
  const module=`${file}:module`,facts:SyntaxFacts={scopes:[{id:module,bindings:[]}],routes:[],attachments:[],java:[],mains:[],javaPackage:tree.namedChildren.find(n=>n.type==='package_declaration')?.text.match(/package\s+([\w.]+)/)?.[1]||'',annotationNames:tree.descendantsOfType('annotation_type_declaration').map(n=>n.childForFieldName('name')?.text||'')};
  const byOffset=new Map(symbols.map(s=>[Number(s.id.split(':').at(-2)),s]));
  const location=(node:Node):Location=>({file,range:offsetsRange(text,node.startIndex,node.endIndex)});
  const scope=(id:string)=>facts.scopes.find(s=>s.id===id)!;
  function visit(node:Node,scopeId:string){
    const name=node.childForFieldName('name'),symbol=name&&byOffset.get(name.startIndex);
    if(file.endsWith('.java')){
      if(symbol){
        const modifiers=node.namedChildren.find(n=>n.type==='modifiers');
        const annotations=modifiers?.namedChildren.filter(n=>n.type.includes('annotation'))||[];
        facts.java.push({symbolId:symbol.id,annotations:annotations.map(n=>n.text).join('\n'),values:annotations.map(n=>javaAnnotation(n,text,file))});
        const parameters=node.childForFieldName('parameters')?.text||'';
        if(symbol.kind==='method'&&symbol.name==='main'&&modifiers?.children.some(n=>n.type==='public')&&modifiers.children.some(n=>n.type==='static')&&node.childForFieldName('type')?.text==='void'&&/^\(\s*(?:java\.lang\.)?String\s*(?:\[\s*\]|\.\.\.)\s+\w+\s*\)$/.test(parameters)){
          facts.mains.push({id:`main:${symbol.id}`,kind:'java-main',name:`main · ${symbols.find(s=>s.id===symbol.parent)?.name||symbol.name}`,symbolId:symbol.id,location:{file,range:symbol.selection},group:`main:${file}`,owner:symbol.qualifiedName,area:sourceArea(file),basis:'AST：public static void main(String[] / String...)',status:'resolved'});
        }
      }
    }else{
      if(['import_statement','import_from_statement'].includes(node.type)){
        const from=node.text.match(/^from\s+([\w.]+)\s+import\s+/)?.[1];
        const parts=node.text.replace(/^from\s+[\w.]+\s+import\s+/,'').replace(/^import\s+/,'').replace(/[()\r\n]/g,'').split(',');
        for(const part of parts){const [original,alias]=part.trim().split(/\s+as\s+/);if(original)scope(scopeId).bindings.push({name:alias||original.split('.')[0],kind:'import',value:from?`${from}:${original}`:`${original}:`,offset:node.startIndex});}
      }
      if(node.type==='assignment'){
        const left=node.childForFieldName('left'),right=node.childForFieldName('right');
        if(left?.type==='identifier'&&right){const call=right.type==='call';const p=call?argument(right,'prefix'):undefined;scope(scopeId).bindings.push({name:left.text,kind:call?'call':right.type==='identifier'?'alias':'other',value:call?right.childForFieldName('function')?.text||'':right.text,offset:node.startIndex,prefix:p?literal(p):''});}
      }
      if(node.type==='call'){
        const fn=node.childForFieldName('function')?.text.match(/^(\w+)\.include_router$/),args=node.childForFieldName('arguments');
        if(fn&&args){const p=argument(node,'prefix');facts.attachments.push({scope:scopeId,object:fn[1],child:args.namedChildren.find(n=>n.type!=='keyword_argument')?.text||'',prefix:p?literal(p):'',offset:node.startIndex});}
      }
      if(node.type==='if_statement'&&scopeId===module&&/^__name__\s*==\s*['"]__main__['"]$/.test(node.childForFieldName('condition')?.text||'')){
        facts.mains.push({id:`main:${file}:${node.startIndex}`,kind:'python-main',name:`__main__ · ${file.split('/').at(-1)}`,location:location(node),group:`main:${file}`,owner:file,area:sourceArea(file),basis:'AST：模块级 __name__ == "__main__"',status:'resolved',reason:'模块顶层调用尚未纳入具名函数调用图；从源码查看启动语句。'});
      }
      if(symbol){
        scope(scopeId).bindings.push({name:symbol.name,kind:'other',value:'definition',offset:node.startIndex});
        const decorated=node.parent?.type==='decorated_definition'?node.parent:undefined;
        for(const decorator of decorated?.namedChildren.filter(n=>n.type==='decorator')||[]){
          const call=decorator.namedChildren.find(n=>n.type==='call'),fn=call?.childForFieldName('function')?.text.match(/^(\w+)\.(get|post|put|delete|patch|options|head)$/);
          if(call&&fn){const positional=call.childForFieldName('arguments')?.namedChildren.find(n=>n.type!=='keyword_argument');facts.routes.push({scope:scopeId,symbolId:symbol.id,object:fn[1],method:fn[2].toUpperCase(),path:literal(positional||argument(call,'path')),offset:decorator.startIndex,location:location(decorator)});}
        }
        facts.scopes.push({id:symbol.id,parent:scopeId,bindings:[]});
        const params=node.childForFieldName('parameters');
        for(const p of params?.namedChildren||[]){const id=p.type==='identifier'?p:p.childForFieldName('name')||p.namedChildren.find(c=>c.type==='identifier');if(id)scope(symbol.id).bindings.push({name:id.text,kind:'other',value:'parameter',offset:node.startIndex});}
        scopeId=symbol.id;
      }
    }
    for(const child of node.namedChildren)visit(child,scopeId);
  }
  visit(tree,module);if(file.endsWith('.java'))facts.javaValues=javaFileValues(tree,text,file,symbols);return facts;
}
