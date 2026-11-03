import fs from 'node:fs/promises';
import path from 'node:path';
import {guard,root} from './common.mjs';
guard();
const base=path.join(root,'.tools/runtime/environments'),rows=[];
for(const entry of await fs.readdir(base,{withFileTypes:true}).catch(()=>[])){
 if(!entry.isDirectory()||entry.isSymbolicLink())continue;const source=path.join(base,entry.name,'source'),sourceStat=await fs.lstat(source).catch(()=>undefined);if(!sourceStat?.isDirectory()||sourceStat.isSymbolicLink())continue;const realBase=await fs.realpath(base),realSource=await fs.realpath(source),relative=path.relative(realBase,realSource);if(!relative||relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))continue;
 const start=Date.now(),stack=[{dir:source,category:'source'}],row={id:entry.name,files:0,bytes:0,byKind:{source:{files:0,bytes:0},dependencies:{files:0,bytes:0},build:{files:0,bytes:0},git:{files:0,bytes:0}},links:0,errors:0,limited:false};
 while(stack.length){if(row.files>=100000||Date.now()-start>20000){row.limited=true;break;}const current=stack.pop();let entries;try{entries=await fs.readdir(current.dir,{withFileTypes:true});}catch{row.errors++;continue;}
  for(const item of entries){const file=path.join(current.dir,item.name);if(item.isSymbolicLink()){row.links++;continue;}if(item.isDirectory()){const name=item.name.toLowerCase(),category=name==='node_modules'||name==='venv'||name==='.venv'?'dependencies':name==='target'||name==='build'||name==='dist'?'build':name==='.git'?'git':current.category;stack.push({dir:file,category});continue;}if(!item.isFile())continue;try{const stat=await fs.stat(file);row.files++;row.bytes+=stat.size;row.byKind[current.category].files++;row.byKind[current.category].bytes+=stat.size;}catch{row.errors++;}if(row.files>=100000){row.limited=true;break;}}
 }
 row.elapsedMs=Date.now()-start;rows.push(row);
}
await fs.writeFile(path.join(root,'.tmp/verification-p1-resources/RUNTIME-COPIES.json'),JSON.stringify(rows,null,2));console.log(JSON.stringify(rows));
