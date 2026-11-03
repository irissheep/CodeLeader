import { build } from 'esbuild';
import { guard, run } from './common.mjs';
guard();
await build({entryPoints:['tests/reader-first.test.ts'],outfile:'dist/tests/reader-first.test.mjs',platform:'node',format:'esm',bundle:true,external:['web-tree-sitter']});
await run(process.execPath,['--test',...process.argv.slice(2),'dist/tests/reader-first.test.mjs']);
