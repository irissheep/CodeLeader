import {build} from 'esbuild';
import {guard,run} from './common.mjs';
guard();
await build({entryPoints:['tests/frontend-links.test.ts'],outfile:'dist/tests/frontend-links.test.cjs',platform:'node',format:'cjs',bundle:true,external:['web-tree-sitter']});
await run(process.execPath,['--test','dist/tests/frontend-links.test.cjs']);
