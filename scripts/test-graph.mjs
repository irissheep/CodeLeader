import { build } from 'esbuild';
import { guard, run } from './common.mjs';
guard();
await build({entryPoints:['tests/graph.test.ts'],outfile:'dist/tests/graph.test.cjs',platform:'node',format:'cjs',bundle:true});
await run(process.execPath,['--test',...process.argv.slice(2),'dist/tests/graph.test.cjs']);
