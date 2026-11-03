import { build } from 'esbuild';
import { guard, run } from './common.mjs';
guard();
await build({entryPoints:['tests/entries.test.ts','tests/spring-annotations.test.ts'],outdir:'dist/tests',outExtension:{'.js':'.mjs'},platform:'node',format:'esm',bundle:true,external:['web-tree-sitter','typescript']});
await run(process.execPath,['--test','dist/tests/entries.test.mjs','dist/tests/spring-annotations.test.mjs']);
