import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {build as viteBuild} from 'vite';
import {build} from 'esbuild';
import electron from 'electron';
import {run} from './common.mjs';
export async function verifyHonestUI(root,out,phase,options={}){
 const folder=path.join(out,phase);await fs.mkdir(folder,{recursive:true});
 const models=options.models||path.join(out,'corpus-'+phase);
 await build({stdin:{contents:"export {collectAnalysisNotes} from './src/main/analysis-notes'; export {webNotesText} from './src/shared/analysis-notes';",resolveDir:root,sourcefile:'r8-notes-tool.ts'},outfile:path.join(out,'notes.cjs'),bundle:true,platform:'node',format:'cjs'});
 const {collectAnalysisNotes}=await import(pathToFileURL(path.join(out,'notes.cjs')).href);
 const projects=JSON.parse(await fs.readFile(path.join(out,'projects.json'),'utf8'));
 for(const p of projects){const model=JSON.parse(await fs.readFile(path.join(models,p.id,'model.json'),'utf8'));
  const notes=await collectAnalysisNotes(model,async file=>{const actual=await fs.realpath(path.resolve(model.root,file)),relative=path.relative(await fs.realpath(model.root),actual);if(relative.startsWith('..')||path.isAbsolute(relative))throw Error('Outside selected project');return fs.readFile(actual,'utf8');});
  await fs.mkdir(path.join(folder,p.id),{recursive:true});await fs.writeFile(path.join(folder,p.id,'notes.json'),JSON.stringify(notes,null,2));
 }
 await viteBuild({configFile:false,root:path.join(root,phase==='before'?'.tmp/verification-r8-honest-states/source-before/src/renderer':'src/renderer'),base:'./',resolve:{preserveSymlinks:true},build:{outDir:path.join(folder,'renderer'),emptyOutDir:true,chunkSizeWarningLimit:4000},worker:{format:'es'}});
 await fs.writeFile(path.join(folder,'run-context.json'),JSON.stringify({models,phase,projects:projects.map(p=>p.id),targetApplicationsStarted:false},null,2));
 await run(electron,[path.join(root,'scripts/r8-honest-window.cjs')],{env:{...process.env,ELECTRON_RUN_AS_NODE:undefined,CODELEADER_HONEST_PHASE:phase,CODELEADER_HONEST_OUTPUT:out,CODELEADER_HONEST_MODELS:models}});
}
