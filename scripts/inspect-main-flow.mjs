import {validationInput,requireValidationInputs} from './verification-input.mjs';
requireValidationInputs();
import fs from 'node:fs';
import { build } from 'esbuild';
import { guard, root, run } from './common.mjs';
guard();
const output=root+'/.tmp/verification-main-flow';fs.mkdirSync(output,{recursive:true});
await build({stdin:{resolveDir:root,contents:validationInput(import.meta.url,'v0')},outfile:output+'/inspect.mjs',format:'esm',platform:'node',bundle:true,external:['web-tree-sitter']});
await run(process.execPath,[output+'/inspect.mjs']);
