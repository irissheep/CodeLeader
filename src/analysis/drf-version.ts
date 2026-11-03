import type {Evidence} from '../shared/model';
import type {StructureResult} from './structure';
import rules from '../shared/drf-http-rules.json';
export function drfVersion(result:StructureResult,file:string){
 const unit=result.index.units?.filter(u=>u.language==='python'&&(!u.root||file.startsWith(u.root+'/'))).sort((a,b)=>b.root.length-a.root.length)[0];
 const candidates:{version:string;exact:boolean;basis:Evidence}[]=[];
 for(const[path,text]of result.configs){if(unit?.root&&path!==unit.root&&!path.startsWith(unit.root+'/'))continue;
  const expression=/\bdjangorestframework\b\s*(?:=\s*["']|["']?\s*)(?:==|~=|>=|\^|=)?\s*(\d+\.\d+(?:\.\d+)?)/gi;for(const match of text.matchAll(expression)){const line=text.slice(0,match.index).split('\n').length-1;candidates.push({version:match[1],exact:!/[~^><*!]/.test(match[0]),basis:{kind:'config',location:{file:path,range:{start:{line,character:0},end:{line,character:text.split('\n')[line].length}}},note:'这里声明了 DRF 版本 '+match[1]}});}
 }
 const declared=[...new Set(candidates.map(v=>v.version))],distance=(v:string,w:string)=>{const a=v.split('.').map(Number),b=w.split('.').map(Number);return a.map((n,i)=>Math.abs(n-(b[i]||0)));};
 const table=declared.length===1?(rules.versions.find(v=>v.version===declared[0])||[...rules.versions].sort((a,b)=>{const left=distance(a.version,declared[0]),right=distance(b.version,declared[0]);for(let i=0;i<left.length;i++)if(left[i]!==right[i])return left[i]-right[i];return 0;})[0]):rules.versions.at(-1)!;
 const approximate=declared.length!==1||declared[0]!==table.version||candidates.some(c=>!c.exact);
 return{table,basis:candidates.map(c=>c.basis),declared,approximate,label:!approximate?'DRF '+table.version:'按 DRF '+table.version+' 映射'};
}
