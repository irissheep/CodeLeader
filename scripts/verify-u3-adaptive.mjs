import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {guard,root,run} from './common.mjs';

guard();
const output=path.join(root,'.tmp/verification-u3-adaptive-look');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
await fs.mkdir(output,{recursive:true});
if(process.argv.includes('--before')){
 const hashes={};
 async function freeze(folder){for(const entry of await fs.readdir(path.join(root,folder),{withFileTypes:true})){if(entry.isSymbolicLink())continue;const file=path.posix.join(folder,entry.name);if(entry.isDirectory())await freeze(file);else{const bytes=await fs.readFile(path.join(root,file));hashes[file]=sha(bytes);const target=path.join(output,'source-before',file);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,bytes);}}}
 if(await fs.stat(path.join(output,'source-before.json')).catch(()=>false))throw Error('Refusing to overwrite frozen before');
 for(const folder of ['src','runtime','analyzers'])await freeze(folder);
 await fs.writeFile(path.join(output,'source-before.json'),JSON.stringify(hashes,null,2));
 await run(process.execPath,[path.join(root,'corpus/run.mjs')]);
 await saveCorpus('before');
 const changed=[];for(const[file,hash]of Object.entries(hashes))if(sha(await fs.readFile(path.join(root,file)))!==hash)changed.push(file);
 await fs.writeFile(path.join(output,'before-integrity.json'),JSON.stringify({files:Object.keys(hashes).length,changed},null,2));
 if(changed.length)throw Error('Source changed during baseline');
}else if(process.argv.includes('--after')){
 await run(process.execPath,[path.join(root,'corpus/run.mjs')]);
 await saveCorpus('after');
}else if(process.argv.includes('--ui')){
 const {verifyAdaptiveUI}=await import('./verify-u3-ui.mjs');await verifyAdaptiveUI(root,output,process.argv.includes('--states')?'states':process.argv.includes('--interaction')?'interaction':process.argv.includes('--baseline-routing')?'before-routing':process.argv.includes('--routing-audit')?'routing-after':process.argv.includes('--baseline')?'before':process.argv.includes('--probe')?'probe':'after');
}
async function saveCorpus(phase){
 const source=path.join(root,'.tmp/verification-generalization-baseline'),target=path.join(output,'corpus-'+phase);
 await fs.mkdir(target,{recursive:true});
 for(const file of ['scorecard-v4.json','frontend-scorecard.json','link-scorecard.json','backbone-scorecard.json','runs.json'])await fs.copyFile(path.join(source,file),path.join(target,file));
 for(const project of JSON.parse(await fs.readFile(path.join(root,'corpus/manifest.json'),'utf8')).projects){await fs.mkdir(path.join(target,project.id),{recursive:true});for(const file of ['model.json','graphs.json'])await fs.copyFile(path.join(source,project.id,file),path.join(target,project.id,file));}
}
