import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import crypto from 'node:crypto';

export const repository=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const corpusRoot=process.env.CODELEADER_CORPUS||path.join(repository,'.cache','corpus');
export const records=path.join(repository,'corpus','public');
export async function command(exe,args,cwd=repository,extra={}){
 return new Promise((resolve,reject)=>{const child=spawn(exe,args,{cwd,windowsHide:true,shell:false,env:{...process.env,...extra},stdio:['ignore','pipe','pipe']});let out='',err='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);child.once('error',reject);child.once('exit',code=>code===0?resolve(out.trim()):reject(Error(`${exe} ${args[0]}: ${err.slice(-1800)}`)));});
}
const hooks=path.join(repository,'.tmp/corpus-hooks');
export const git=(args,cwd)=>command('git',['-c','core.longpaths=true','-c','core.autocrlf=true','-c','core.fsmonitor=false','-c',`core.hooksPath=${hooks}`,...args],cwd,{GIT_TERMINAL_PROMPT:'0',GIT_OPTIONAL_LOCKS:'0',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:path.join(hooks,'no-global-config')});
export async function restoreEol(folder,project){
 for(const [style,files] of Object.entries(project.workingTreeEol||{}))for(const file of files){const target=path.join(folder,file);const text=(await fs.readFile(target,'utf8')).replaceAll('\r\n','\n');await fs.writeFile(target,style==='crlf'?text.replaceAll('\n','\r\n'):text);}
 for(const [file,bytes] of Object.entries(project.workingTreeMixedBytes||{}))await fs.writeFile(path.join(folder,file),Buffer.from(bytes,'base64'));
}
export async function assertClean(folder,project){
 if(project.workingTreeSha256){for(const [file,hash] of Object.entries(project.workingTreeSha256))if(crypto.createHash('sha256').update(await fs.readFile(path.join(folder,file))).digest('hex')!==hash)throw Error(`${project.id}: frozen file differs: ${file}`);}
 else await git(['diff','--quiet','HEAD','--'],folder);
 if(await git(['ls-files','--others','--exclude-standard'],folder))throw Error(`${project.id}: untracked corpus inputs`);
}
export async function prepare(){
 const log=await command(process.execPath,[path.join(records,'acquire.mjs')]);if(log)console.log(log);
 const manifest=JSON.parse(await fs.readFile(path.join(records,'manifest.json'),'utf8')),projects=[];
 for(const project of manifest.projects)if(await fs.stat(path.join(corpusRoot,project.id,'.git')).catch(()=>false))projects.push(project);
 return {...manifest,projects};
}
