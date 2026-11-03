import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {root,guard,run} from './common.mjs';
guard();
const out=path.join(root,'.tmp/verification-r8-honest-states'),baseline=path.join(root,'.tmp/verification-generalization-baseline');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
await fs.mkdir(out,{recursive:true});
if(process.argv.includes('--before')){
 if(await fs.stat(path.join(out,'source-before.json')).catch(()=>false))throw Error('Frozen before already exists');
 const hashes={};async function freeze(dir){for(const e of await fs.readdir(path.join(root,dir),{withFileTypes:true})){if(e.isSymbolicLink())continue;const file=path.posix.join(dir,e.name);if(e.isDirectory())await freeze(file);else{const bytes=await fs.readFile(path.join(root,file));hashes[file]=sha(bytes);await fs.mkdir(path.dirname(path.join(out,'source-before',file)),{recursive:true});await fs.writeFile(path.join(out,'source-before',file),bytes);}}}
 for(const dir of ['src','runtime','analyzers'])await freeze(dir);await fs.writeFile(path.join(out,'source-before.json'),JSON.stringify(hashes,null,2));
 await fs.copyFile(path.join(root,'.tmp/verification-blind-test/scorecard-v2.json'),path.join(out,'frozen-v2.json'));
 await run(process.execPath,[path.join(root,'corpus/run.mjs')]);await copy('before');
 for(const[file,hash]of Object.entries(hashes))if(sha(await fs.readFile(path.join(root,file)))!==hash)throw Error('Source changed during before: '+file);
}else if(process.argv.includes('--after')){await run(process.execPath,[path.join(root,'corpus/run.mjs')]);await copy('after');}
else if(process.argv.includes('--ui')){const {verifyHonestUI}=await import('./verify-r8-ui.mjs');await verifyHonestUI(root,out,process.argv.includes('--baseline')?'before':'after');}
async function copy(phase){
 const to=path.join(out,'corpus-'+phase);await fs.mkdir(to,{recursive:true});
 for(const file of ['scorecard-v4.json','scorecard.json','runs.json','ui-audit.json'])await fs.copyFile(path.join(baseline,file),path.join(to,file));
 const manifest=JSON.parse(await fs.readFile(path.join(root,'corpus/manifest.json'),'utf8'));
 const blind=JSON.parse(await fs.readFile(path.join(root,'.tmp/verification-blind-test/manifest.json'),'utf8'));
 for(const p of [...manifest.projects,...blind.projects]){const from=manifest.projects.some(k=>k.id===p.id)?path.join(baseline,p.id):path.join(root,'.tmp/verification-blind-test/product',p.id);const dir=path.join(to,p.id);await fs.mkdir(dir,{recursive:true});for(const file of ['model.json','graphs.json'])await fs.copyFile(path.join(from,file),path.join(dir,file));}
 await fs.writeFile(path.join(out,'projects.json'),JSON.stringify([...manifest.projects,...blind.projects].map(p=>({id:p.id})),null,2));
}
