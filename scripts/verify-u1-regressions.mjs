import fs from 'node:fs/promises';
import path from 'node:path';
import {build} from 'esbuild';
import {guard,root,run} from './common.mjs';
guard();
const folder=path.join(root,'.tmp/verification-u1-visual-system/regressions');await fs.mkdir(folder,{recursive:true});
const names=['readable-interactions','context-follow-toolbar','replay','runtime-viewport'];
const files=[];for(const name of names){const file=path.join(folder,name+'.test.mjs');await build({entryPoints:[path.join(root,'tests',name+'.test.ts')],outfile:file,bundle:true,platform:'node',format:'esm'});files.push(file);}
await run(process.execPath,['--test',...files]);
