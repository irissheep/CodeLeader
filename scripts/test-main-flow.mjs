import { build } from 'esbuild';
import { guard, run } from './common.mjs';
guard();
await build({entryPoints:['tests/main-flow.test.ts'],outfile:'dist/tests/main-flow.test.mjs',platform:'node',format:'esm',bundle:true,external:['web-tree-sitter']});
await run(process.execPath,['--test',...process.argv.slice(2),'dist/tests/main-flow.test.mjs']);
