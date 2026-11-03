import { build } from 'esbuild';
import { guard,run } from './common.mjs';
guard();
await build({entryPoints:['tests/readable-interactions.test.ts'],outfile:'.tmp/verification-readable-interactions/test.mjs',platform:'node',format:'esm',bundle:true});
await run(process.execPath,['--test',...process.argv.slice(2),'.tmp/verification-readable-interactions/test.mjs']);
