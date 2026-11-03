import path from 'node:path';
import {build} from 'vite';
import electron from 'electron';
import {repository,command} from './acquire.mjs';
const output=path.join(repository,'.tmp/verification-generalization-baseline');
await build({configFile:false,root:path.join(repository,'src/renderer'),base:'./',build:{outDir:path.join(output,'ui-renderer'),emptyOutDir:true,chunkSizeWarningLimit:4000},worker:{format:'es'}});
console.log(await command(electron,[path.join(repository,'corpus/ui-audit.cjs')],repository,{ELECTRON_RUN_AS_NODE:undefined}));
