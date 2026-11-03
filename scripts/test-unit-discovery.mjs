import {build} from 'esbuild';
import {guard,run} from './common.mjs';
guard();
await build({entryPoints:['tests/unit-discovery.test.ts'],outfile:'dist/tests/unit-discovery.test.mjs',platform:'node',format:'esm',bundle:true,external:['web-tree-sitter','typescript']});
await run(process.execPath,['--test','dist/tests/unit-discovery.test.mjs']);
