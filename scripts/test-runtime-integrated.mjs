import {build} from 'esbuild';
import {guard,root,run} from './common.mjs';
guard();const out=root+'/.tmp/verification-runtime-integrated';
const files=process.argv.includes('--new-only')?['runtime-integrated']:['runtime-integrated','replay','execution'];
await build({entryPoints:files.map(file=>'tests/'+file+'.test.ts'),outdir:out+'/tests',platform:'node',format:'esm',bundle:true,outExtension:{'.js':'.mjs'}});
await run(process.execPath,['--test',...files.map(file=>out+'/tests/'+file+'.test.mjs')]);
