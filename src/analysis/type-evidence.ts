import type Parser from 'web-tree-sitter';
import type {ProjectIndex} from '../shared/model';
import type {CodeFacts} from './code-facts';
import {offsetsRange} from '../shared/ranges';
// Retain existing AST facts for the dependency reader; do not change call resolution.
export function typeEvidence(index:ProjectIndex,file:string,namespace:string,root:Parser.SyntaxNode,facts:CodeFacts){
 const imports=Object.fromEntries(facts.imports.map(i=>[i.name,i.target]));
 const annotations=(text:string)=>[...text.matchAll(/@([\w.]+)/g)].map(m=>m[1]);
 (index.typeFiles||=[]).push({file,namespace,imports,importLocations:Object.fromEntries(facts.imports.map(i=>[i.name,i.location])),bindings:facts.assignments.filter(a=>a.scope===`file:${file}`&&a.value.callee&&!a.left.includes('.')).map(a=>({name:a.left,callee:a.value.callee!})),annotations:facts.definitions.flatMap(d=>annotations(d.annotations))});
 for(const node of root.descendantsOfType(['class_declaration','interface_declaration','record_declaration','enum_declaration','class_definition'])){
  const name=node.childForFieldName('name');if(!name)continue;const symbol=index.symbols.find(s=>s.file===file&&s.selection.start.line===name.startPosition.row&&s.selection.start.character===name.startPosition.column);if(!symbol)continue;
  const def=facts.definitions.find(d=>d.id===symbol.id),bases=def?.bases||node.namedChildren.filter(n=>['superclass','super_interfaces','extends_interfaces'].includes(n.type)).flatMap(n=>n.text.replace(/^(?:extends|implements)\s+/,'').split(/,(?![^<]*>)/).map(s=>s.trim()));
  const table=node.childForFieldName('superclasses')?.namedChildren.find(n=>n.type==='keyword_argument'&&n.childForFieldName('name')?.text==='table')?.childForFieldName('value')?.text==='True';
  const members=node.childForFieldName('body')?.namedChildren.filter(n=>['method_declaration','field_declaration'].includes(n.type))||[];
  const staticOnly=members.some(n=>n.type==='method_declaration')&&members.every(n=>/\bstatic\b/.test(n.namedChildren.find(c=>c.type==='modifiers')?.text||''));
  symbol.typeEvidence={annotations:annotations(def?.annotations||''),bases,table:table||undefined,staticOnly:staticOnly||undefined,returns:facts.definitions.filter(d=>index.symbols.find(s=>s.id===d.id)?.parent===symbol.id&&d.returnType).map(d=>({type:d.returnType!,annotations:annotations(d.annotations)}))};
 }
 index.versions.dependencyTypes='2';
}
export function mapperTypeEvidence(index:ProjectIndex,configs:Map<string,string>){
 index.typeMappings=[];for(const [file,text] of configs){if(!file.endsWith('.xml'))continue;const match=text.match(/<mapper\b[^>]*\bnamespace\s*=\s*["']([^"']+)["']/);if(match)index.typeMappings.push({typeName:match[1],entityNames:[...text.matchAll(/<(?:resultMap|select)\b[^>]*\b(?:type|resultType)\s*=\s*["']([\w.]+)["']/g)].map(m=>m[1]),location:{file,range:offsetsRange(text,match.index!,match.index!+match[0].length)}});}
}
