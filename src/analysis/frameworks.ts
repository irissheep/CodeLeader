import type { ProjectIndex } from '../shared/model';
import type { StructureResult } from './structure';
import { extractEntries } from './entry-frameworks';
import {isTestFile} from '../shared/source-roles';
export function frameworks(result:StructureResult) {
  extractEntries(result);
  resolveImports(result.index);
  const {index,facts,texts}=result;
  for(const source of index.symbols.filter(s=>s.language==='java'&&['class','interface'].includes(s.kind)&&!isTestFile(s.file,index))){
    const text=(texts.get(source.file)||'').split(/\r?\n/).slice(source.range.start.line,source.range.end.line+1).join('\n').split('{')[0].replace(/<[^<>]*(?:<[^<>]*>[^<>]*)*>/g,'');
    for(const clause of text.matchAll(/\b(extends|implements)\s+([\w.,\s]+?)(?=\bimplements\b|$)/g))for(const name of clause[2].split(',').map(n=>n.trim()).filter(Boolean)){
      const imports=facts.get(source.file)?.imports||[],targets=index.symbols.filter(s=>['class','interface'].includes(s.kind)&&(s.qualifiedName===name||s.name===name&&(imports.some(i=>i.target===s.qualifiedName)||s.file===source.file||s.qualifiedName===source.qualifiedName.slice(0,source.qualifiedName.lastIndexOf('.')+1)+name)));
      if(targets.length===1)index.relations.push({id:`structure-type:${source.id}:${targets[0].id}`,from:source.id,to:targets[0].id,target:targets[0].qualifiedName,type:clause[1]==='implements'?'IMPLEMENTS':'EXTENDS',source:'tree-sitter',status:'resolved',locations:[{file:source.file,range:source.selection}]});
    }
  }
  for(const entry of index.entries||[])if(entry.kind==='java-main'){
    const method=index.symbols.find(s=>s.id===entry.symbolId),owner=index.symbols.find(s=>s.id===method?.parent),program=owner&&facts.get(owner.file),boot=owner&&program?.definitions.find(d=>d.id===owner.id)?.annotations.includes('@SpringBootApplication')&&program.imports.some(i=>i.target==='org.springframework.boot.autoconfigure.SpringBootApplication');
    entry.name=(boot?'Spring 启动 · ':'辅助程序 · ')+(owner?.name||entry.owner);
  }
}
function resolveImports(index:ProjectIndex) {
  for(const relation of index.relations.filter(r=>r.type==='IMPORTS')) {
    const file=relation.locations[0].file;
    const info=index.files.find(f=>f.path===file)!;
    if(info.language==='java') {
      const target=relation.target.replace(/^import\s+(static\s+)?/,'').replace(/;$/,'').trim();
      const matches=index.symbols.filter(s=>s.language==='java'&&s.qualifiedName===target);
      if(matches.length===1){relation.to=matches[0].id;relation.status='resolved';relation.reason=undefined;}
      else if(matches.length>1){relation.status='candidate';relation.reason='多个源码模块提供相同限定名，无法仅凭导入声明确定唯一目标。';}
    } else {
      const module=relation.target.match(/^from\s+([\w.]+)\s+import/)?.[1]||relation.target.match(/^import\s+([\w.]+)/)?.[1];
      if(!module)continue;
      const dots=module.match(/^\.+/)?.[0].length||0;
      const base=file.split('/').slice(0,-1);
      const target=dots?[...base.slice(0,base.length-dots+1),...module.slice(dots).split('.').filter(Boolean)].join('/'):module.replaceAll('.','/');
      const found=index.files.find(f=>f.language==='python'&&(f.path===target+'.py'||f.path===target+'/__init__.py'));
      if(found){relation.to=`file:${found.path}`;relation.status='resolved';relation.reason=undefined;}
    }
  }
}
