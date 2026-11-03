import {build} from 'esbuild';
import {guard,run} from './common.mjs';
guard();
await build({entryPoints:['tests/ranges.test.ts'],outfile:'dist/tests/ranges.test.mjs',platform:'node',format:'esm',bundle:true});
await run(process.execPath,['--test','dist/tests/ranges.test.mjs']);
