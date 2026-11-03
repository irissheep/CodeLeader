import {build} from 'esbuild';
import path from 'node:path';
import {guard,root,run} from './common.mjs';
guard();
const file=path.join(root,'.tmp/verification-u2-motion/motion-data.test.mjs');
await build({entryPoints:['tests/motion-data.test.ts'],outfile:file,bundle:true,platform:'node',format:'esm'});
await run(process.execPath,['--test',file]);
