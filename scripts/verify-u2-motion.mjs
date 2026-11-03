import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import {guard,root,run} from './common.mjs';
guard();
const output=path.join(root,'.tmp/verification-u2-motion');
const json=async file=>JSON.parse(await fs.readFile(file,'utf8'));
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
await fs.mkdir(output,{recursive:true});
if(process.argv.includes('--prepare-before')){
 const hashes={};
 async function freeze(folder){for(const entry of await fs.readdir(path.join(root,folder),{withFileTypes:true})){if(entry.isSymbolicLink())continue;const file=path.posix.join(folder,entry.name);if(entry.isDirectory())await freeze(file);else{const bytes=await fs.readFile(path.join(root,file));hashes[file]=sha(bytes);const target=path.join(output,'source-before',file);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,bytes);}}}
 if(await fs.stat(path.join(output,'source-before.json')).catch(()=>false))throw Error('Frozen before exists; refusing overwrite');
 for(const folder of ['src','runtime','analyzers'])await freeze(folder);
 await fs.writeFile(path.join(output,'source-before.json'),JSON.stringify(hashes,null,2));
 const prior=await json(path.join(root,'.tmp/verification-u1-visual-system/inputs.json'));
 await fs.writeFile(path.join(output,'inputs.json'),JSON.stringify(prior));
 await fs.writeFile(path.join(output,'machine.json'),JSON.stringify({capturedAt:new Date().toISOString(),platform:process.platform,release:os.release(),arch:process.arch,node:process.version,cpu:os.cpus()[0]?.model,logicalCpus:os.cpus().length,memoryBytes:os.totalmem(),window:{width:prior.width,height:prior.height}},null,2));
 await run(process.execPath,[path.join(root,'corpus/run.mjs')]);
 await fs.mkdir(path.join(output,'corpus-before'),{recursive:true});
 for(const file of ['scorecard-v4.json','frontend-scorecard.json','source-integrity.json','link-scorecard.json','backbone-scorecard.json','runs.json'])await fs.copyFile(path.join(root,'.tmp/verification-generalization-baseline',file),path.join(output,'corpus-before',file));
 const changed=[];for(const[file,hash]of Object.entries(hashes))if(sha(await fs.readFile(path.join(root,file)))!==hash)changed.push(file);
 await fs.writeFile(path.join(output,'before-integrity.json'),JSON.stringify({files:Object.keys(hashes).length,changed,completedAt:new Date().toISOString()},null,2));
 if(changed.length)throw Error('Product source changed during before');
 console.log('U2 BEFORE complete: '+Object.keys(hashes).length+' product files frozen');
}else{const {runMotionUI}=await import('./verify-u2-ui.mjs');await runMotionUI(root,output,process.argv.includes('--after')?'after':'before');}
