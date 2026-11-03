import {build} from 'esbuild';
import {guard,run} from './common.mjs';
guard();await build({entryPoints:['tests/backbone.test.ts'],outfile:'dist/tests/backbone.test.mjs',bundle:true,platform:'node',format:'esm'});await run(process.execPath,['--test','dist/tests/backbone.test.mjs']);
