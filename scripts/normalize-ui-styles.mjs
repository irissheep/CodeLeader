import fs from 'node:fs/promises';
import path from 'node:path';
import postcss from 'postcss';
import {guard,root} from './common.mjs';
guard();
const folder=path.join(root,'src/renderer');
for(const file of await fs.readdir(folder)){
 if(!file.endsWith('.css'))continue;
 const full=path.join(folder,file),before=await fs.readFile(full,'utf8'),sheet=postcss.parse(before);
 sheet.walkDecls(decl=>{
  if(decl.prop==='font-size')decl.value=decl.value.replace(/([\d.]+)px/g,(_all,size)=>`var(--font-${+size<=12?'small':+size<=14?'body':'title'})`);
  if(decl.prop==='font-family')decl.value=decl.value.includes('monospace')?'var(--font-mono)':'var(--font-family)';
  if(decl.prop==='font')decl.value=decl.value.replace(/([\d.]+)px/g,(_all,size)=>`var(--font-${decl.value.includes('monospace')?'code':+size<=12?'small':+size<=14?'body':'title'})`);
  if(decl.prop==='border-radius')decl.value=decl.value.replace(/([\d.]+)px/g,(_all,size)=>`var(--radius-${+size>=20?'pill':+size>=10?'card':'control'})`);
 });
 const after=sheet.toString();if(after!==before)await fs.writeFile(full,after);
}
