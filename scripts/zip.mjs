import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import { guard, root, run } from './common.mjs';
import {managedPath} from './managed-path.mjs';
export async function createReleaseZip(output,destination){
  guard();
  const release=fs.realpathSync.native(managedPath(path.join(root,'release')));
  const source=fs.realpathSync.native(managedPath(output));
  const target=managedPath(destination), parent=fs.realpathSync.native(path.dirname(target));
  const inside=value=>{const relative=path.relative(release,value);return relative!==''&&relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative);};
  if(!inside(source)||!(parent===release||inside(parent)))throw Error('发行文件必须位于项目的 release 目录内。');
  if(fs.existsSync(target))throw Error('目标 ZIP 已存在，未覆盖现有发行文件。');
  for(const file of ['LICENSE','README.md','THIRD_PARTY_NOTICES.md'])if(fs.existsSync(file))fs.copyFileSync(file,path.join(source,file));
  await run('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(root,'scripts/Zip-Release.ps1'),'-Source',source,'-Destination',target]);
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
  const output=path.resolve(process.argv[2]||path.join(root,'release/win-unpacked'));
  const destination=path.resolve(process.argv[3]||path.join(root,'release/CodeLeader-0.1.0-win-x64.zip'));
  await createReleaseZip(output,destination);
}
