import {build} from 'esbuild';
import {guard,run} from './common.mjs';
guard();await build({entryPoints:['tests/replay.test.ts'],outfile:'.tmp/verification-step-replay/replay.test.mjs',platform:'node',format:'esm',bundle:true});
await build({entryPoints:['tests/execution.test.ts'],outfile:'.tmp/verification-step-replay/execution.test.mjs',platform:'node',format:'esm',bundle:true});
await run(process.execPath,['--test','.tmp/verification-step-replay/replay.test.mjs','.tmp/verification-step-replay/execution.test.mjs']);
