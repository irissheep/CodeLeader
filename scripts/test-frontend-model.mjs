import {build} from 'esbuild';
import {guard,run} from './common.mjs';
guard();
await build({entryPoints:['tests/frontend-model.test.ts'],outfile:'dist/tests/frontend-model.test.cjs',platform:'node',format:'cjs',bundle:true});
await run(process.execPath,['--test','dist/tests/frontend-model.test.cjs']);
