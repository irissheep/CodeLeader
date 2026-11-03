import fs from 'node:fs/promises';
import path from 'node:path';
import {root,guard} from './common.mjs';
guard();
const table=JSON.parse(await fs.readFile(path.join(root,'src/shared/ui-wording.json'),'utf8'));
const rows=JSON.parse(await fs.readFile(path.join(root,'.tmp/verification-u7-wording/wording-before.json'),'utf8')).violations;
for(const file of new Set(rows.filter(r=>r.rule==='forbidden-word').map(r=>r.file))){
 let source=await fs.readFile(path.join(root,file),'utf8');
 for(const original of [...new Set(rows.filter(r=>r.file===file&&r.rule==='forbidden-word').map(r=>r.text))].sort((a,b)=>b.length-a.length)){
  let next=original;for(const[a,b]of Object.entries(table.phrases))next=next.replaceAll(a,b);for(const[a,b]of Object.entries(table.terms))next=next.replaceAll(a,b);
  if(!source.includes(original)&&!source.includes(next))throw Error('Copy changed before rewrite: '+file+': '+original);
  source=source.replaceAll(original,next);
 }await fs.writeFile(path.join(root,file),source);
}
