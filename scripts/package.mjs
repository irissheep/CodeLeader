import fs from 'node:fs';
import path from 'node:path';
import { build, Platform, Arch } from 'electron-builder';
import { guard, root, run } from './common.mjs';
import {managedPath} from './managed-path.mjs';
import {createReleaseZip} from './zip.mjs';
guard();
const env={...process.env};
if ((env.HTTPS_PROXY || env.HTTP_PROXY) && !env.NODE_USE_ENV_PROXY) env.NODE_USE_ENV_PROXY='1';
await run(process.execPath,['scripts/prepare-recording.mjs'],{env});
await import('./build-runtime-java.mjs');
await import('./build.mjs');
for(const file of ['resources/jre/bin/java.exe','resources/java/worker.jar','resources/grammars/tree-sitter-java.wasm','resources/grammars/tree-sitter-python.wasm'])if(!fs.existsSync(file))throw new Error(`缺少 ${file}，先运行 prepare:resources`);
const releaseRoot=managedPath(path.join(root,'release'));
fs.mkdirSync(releaseRoot,{recursive:true});
// Never let the builder empty a previous release or its user data.
const candidate=managedPath(fs.mkdtempSync(path.join(releaseRoot,'candidate-')));
await build({targets:Platform.WINDOWS.createTarget(['dir'],Arch.x64),config:{electronDist:path.join(root,'node_modules/electron/dist'),directories:{output:candidate}}});
const output=path.join(candidate,'win-unpacked');
for(const [from,to] of [
  ['.tools/runtime/opentelemetry-javaagent.jar','.tools/runtime/opentelemetry-javaagent.jar'],
  ['.tools/runtime/otelcol.exe','.tools/runtime/otelcol.exe'],
  ['runtime/java/target/value-extension-1.0.0.jar','runtime/java/target/value-extension-1.0.0.jar'],
  ['runtime/python/launch.py','runtime/python/launch.py'],
  ['runtime/python/observe.py','runtime/python/observe.py'],
  ['runtime/python/requirements-observe.txt','runtime/python/requirements-observe.txt'],
  ['runtime/third-party-notices/OPENTELEMETRY-COLLECTOR-LICENSE.txt','resources/licenses/opentelemetry-collector-LICENSE.txt'],
  ['.cache/recording/collector-sbom.spdx.json','resources/licenses/opentelemetry-collector-sbom.spdx.json'],
]) {const destination=path.join(output,to);fs.mkdirSync(path.dirname(destination),{recursive:true});fs.copyFileSync(path.join(root,from),destination);}
for(const file of ['Launch-CodeLeader.ps1','Launch-CodeLeader.cmd'])fs.copyFileSync(path.join(root,'scripts',file),path.join(output,file));
for(const file of ['LICENSE','README.md','THIRD_PARTY_NOTICES.md'])if(fs.existsSync(file))fs.copyFileSync(file,path.join(output,file));
if(!process.argv.includes('--dir-only'))await createReleaseZip(output,path.join(candidate,'CodeLeader-0.1.0-win-x64.zip'));
console.log('发行候选已生成：'+candidate);
