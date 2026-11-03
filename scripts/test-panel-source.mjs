import {build} from 'esbuild';import {guard,root,run} from './common.mjs';guard();
for(const name of ['data-panel','source-follow-errors','source-editor']){const output=root+'/.tmp/verification-panel-source/'+name+'.test.mjs';await build({entryPoints:['tests/'+name+'.test.ts'],outfile:output,platform:'node',format:'esm',bundle:true});await run(process.execPath,['--test',output]);}
