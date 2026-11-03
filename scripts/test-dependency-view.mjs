import {build} from 'esbuild';
import {guard,run} from './common.mjs';
guard();
await build({entryPoints:['tests/dependency-view.test.ts'],outfile:'dist/tests/dependency-view.test.mjs',platform:'node',format:'esm',bundle:true,external:['web-tree-sitter','typescript']});
await run(process.execPath,['--test','dist/tests/dependency-view.test.mjs']);
