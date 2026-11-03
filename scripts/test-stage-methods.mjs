import{build}from'esbuild';import{guard,root,run}from'./common.mjs';guard();
for(const name of['stage-methods','walkthrough']){const file=root+'/.tmp/verification-stage-methods/'+name+'.test.mjs';await build({entryPoints:['tests/'+name+'.test.ts'],outfile:file,platform:'node',format:'esm',bundle:true});await run(process.execPath,['--test',file]);}
