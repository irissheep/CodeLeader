import {build} from 'esbuild';
import {guard,run} from './common.mjs';
guard();
await build({entryPoints:['tests/adaptive-look.test.ts','tests/graph.test.ts'],outdir:'.tmp/verification-u3-adaptive-look/tests',bundle:true,platform:'node',format:'cjs',outExtension:{'.js':'.cjs'}});
await run(process.execPath,['--test','.tmp/verification-u3-adaptive-look/tests/adaptive-look.test.cjs','.tmp/verification-u3-adaptive-look/tests/graph.test.cjs']);
