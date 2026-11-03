import { build } from 'esbuild';
import { guard, run } from './common.mjs';
guard();
await build({entryPoints:['tests/analysis.test.ts'],outfile:'dist/tests/analysis.test.cjs',platform:'node',format:'cjs',bundle:true,external:['web-tree-sitter','electron']});
await run(process.execPath,['--test',...process.argv.slice(2),'dist/tests/analysis.test.cjs']);
