import {build} from 'esbuild';
import {guard,run} from './common.mjs';
guard();
await build({entryPoints:['tests/analysis-notes.test.ts'],outfile:'.tmp/verification-r8-honest-states/tests/analysis-notes.cjs',bundle:true,platform:'node',format:'cjs'});
await run(process.execPath,['--test','.tmp/verification-r8-honest-states/tests/analysis-notes.cjs']);
