import fs from 'node:fs/promises';
import path from 'node:path';
import {build} from 'vite';
import electron from 'electron';
import crypto from 'node:crypto';
import {run} from './common.mjs';
export async function verifyAdaptiveUI(root,output,phase){
 const folder=path.join(output,phase);await fs.mkdir(folder,{recursive:true});
 await build({configFile:false,root:path.join(root,phase.startsWith('before')?'.tmp/verification-u3-adaptive-look/source-before/src/renderer':'src/renderer'),base:'./',resolve:{preserveSymlinks:true},build:{outDir:path.join(folder,'renderer'),emptyOutDir:true,chunkSizeWarningLimit:4000},worker:{format:'es'}});
 const hashes={};async function collect(dir){for(const entry of await fs.readdir(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())await collect(file);else hashes[path.relative(root,file)]=crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');}}await collect(path.join(root,phase.startsWith('before')?'.tmp/verification-u3-adaptive-look/source-before/src':'src'));await fs.writeFile(path.join(folder,'source-version.json'),JSON.stringify({capturedAt:new Date().toISOString(),hashes},null,2));
 await run(electron,[path.join(root,'scripts/u3-adaptive-window.cjs')],{env:{...process.env,ELECTRON_RUN_AS_NODE:undefined,CODELEADER_ADAPTIVE_PHASE:phase}});
}
