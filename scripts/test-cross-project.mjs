import {build} from 'esbuild';
import {guard,run} from './common.mjs';
guard();await import('./prepare-cross-project-fixtures.mjs');
await build({entryPoints:['tests/cross-project.test.ts'],outfile:'dist/tests/cross-project.test.mjs',platform:'node',format:'esm',bundle:true,external:['web-tree-sitter']});
await run(process.execPath,['--test','dist/tests/cross-project.test.mjs']);
