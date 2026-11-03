import {build} from 'esbuild';
import {guard,run} from './common.mjs';
guard();const out='.tmp/verification-r7-runtime-general';
for(const name of ['runtime-general','request-operations','runtime-integrated','replay','execution'])await build({entryPoints:['tests/'+name+'.test.ts'],outfile:out+'/'+name+'.test.cjs',bundle:true,format:'cjs',platform:'node'});
await run(process.execPath,['--test',...['runtime-general','request-operations','runtime-integrated','replay','execution'].map(name=>out+'/'+name+'.test.cjs')]);
