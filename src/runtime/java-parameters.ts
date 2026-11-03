import type {ProjectIndex,SymbolInfo} from '../shared/model';
// Conservative fallback for declarations whose imported parameter types are explicit.
// It never guesses a wildcard import, type variable or overloaded target.
export function declaredParameters(symbol:SymbolInfo,text:string,index:ProjectIndex):{types:string[];names:string[]}|undefined{
 const body=text.split(/\r?\n/).slice(symbol.range.start.line,symbol.range.end.line+1).join('\n'),start=body.search(new RegExp('\\b'+symbol.name+'\\s*\\('));if(start<0)return;
 const header=body.slice(start),open=header.indexOf('(');let depth=1,end=open+1;for(;end<header.length&&depth;end++){if(header[end]==='(')depth++;if(header[end]===')')depth--;}if(depth)return;
 const raw=header.slice(open+1,end-1).replace(/@[\w.]+(?:\([^)]*\))?\s*/g,'').replace(/\bfinal\s+/g,''),parts:string[]=[];let angle=0,from=0;for(let i=0;i<=raw.length;i++){if(raw[i]==='<')angle++;if(raw[i]==='>')angle--;if(i===raw.length||raw[i]===','&&!angle){if(raw.slice(from,i).trim())parts.push(raw.slice(from,i).trim());from=i+1;}}
 const types:string[]=[],names:string[]=[],pkg=text.match(/\bpackage\s+([\w.]+)\s*;/)?.[1],imports=[...text.matchAll(/\bimport\s+(?!static\b)([\w.]+)\s*;/g)].map(m=>m[1]);
 for(const part of parts){const m=part.match(/^([\w.<>?,\s\[\]]+(?:\.\.\.)?)\s+(\w+)\s*(\[\])?$/);if(!m)return;let type=m[1].replace(/<[^<>]*(?:<[^<>]*>[^<>]*)*>/g,'').replace(/\s/g,'').replace(/\.\.\./,'[]')+(m[3]||''),array='';while(type.endsWith('[]')){array+='[]';type=type.slice(0,-2);}
  if(!/^(?:byte|short|int|long|float|double|boolean|char)$/.test(type)){
   if(type.includes('.')){if(!/^[a-z]/.test(type))return;}
   else{const imported=imports.filter(i=>i.split('.').at(-1)===type),local=index.symbols.filter(s=>['class','interface'].includes(s.kind)&&s.name===type&&s.qualifiedName===pkg+'.'+type);if(imported.length===1)type=imported[0];else if(local.length===1)type=local[0].qualifiedName;else if(['String','Object','Boolean','Byte','Character','Short','Integer','Long','Float','Double','Number','Throwable','Exception','RuntimeException'].includes(type))type='java.lang.'+type;else return;}
  }types.push(type+array);names.push(m[2]);
 }return {types,names};
}
