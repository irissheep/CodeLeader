import {build} from 'esbuild';
import {guard,run} from './common.mjs';
guard();await build({entryPoints:['tests/execution.test.ts'],outfile:'.tmp/verification-runtime-flow/execution.test.mjs',platform:'node',format:'esm',bundle:true});
await run(process.execPath,['--test','.tmp/verification-runtime-flow/execution.test.mjs']);
