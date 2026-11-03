import {build} from 'esbuild';
import {guard,run} from './common.mjs';
guard();
await build({entryPoints:['tests/python-http.test.ts'],outfile:'dist/tests/python-http.test.mjs',platform:'node',format:'esm',bundle:true,external:['web-tree-sitter','typescript']});
await run(process.execPath,['--test','dist/tests/python-http.test.mjs']);
