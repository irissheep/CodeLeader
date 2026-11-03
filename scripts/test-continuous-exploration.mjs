import { build } from 'esbuild';
import { guard,run } from './common.mjs';
guard();
await build({entryPoints:['tests/continuous-exploration.test.ts'],outfile:'.tmp/verification-continuous-exploration/test.mjs',platform:'node',format:'esm',bundle:true});
await run(process.execPath,['--test',...process.argv.slice(2),'.tmp/verification-continuous-exploration/test.mjs']);
