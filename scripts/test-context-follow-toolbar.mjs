import {build} from 'esbuild';
import {guard,run} from './common.mjs';
guard();
for(const name of ['context-follow-toolbar','continuous-exploration']){
 const outfile=`.tmp/verification-context-follow-toolbar/${name}.test.mjs`;
 await build({entryPoints:[`tests/${name}.test.ts`],outfile,platform:'node',format:'esm',bundle:true});
 await run(process.execPath,['--test',outfile]);
}
