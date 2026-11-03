import {build} from 'esbuild';import path from 'node:path';import {guard,run,root} from './common.mjs';guard();await import('./prepare-cross-project-fixtures.mjs');
await build({entryPoints:['tests/project-session-boundary.test.ts'],outfile:'dist/tests/project-session-boundary.test.mjs',platform:'node',format:'esm',bundle:true,external:['web-tree-sitter'],alias:{electron:path.join(root,'tests/electron-boundary-stub.ts')}});
await run(process.execPath,['--test','dist/tests/project-session-boundary.test.mjs']);
