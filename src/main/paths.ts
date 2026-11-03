import fs from 'node:fs';
import path from 'node:path';
import type { App } from 'electron';
import { managedPath } from '../../scripts/managed-path.mjs';
export function requireD(file:string) {
  const resolved=path.resolve(file);
  if(!/^D:\\/i.test(resolved))throw new Error(`路径策略拒绝：必须位于 D 盘 (${resolved})`);
  return managedPath(resolved);
}
export function configurePaths(app:App) {
  const base=requireD(fs.realpathSync.native(app.isPackaged?path.dirname(process.execPath):path.resolve(__dirname,'..')));
  const data=requireD(path.join(base,app.isPackaged?'data':'.appdata'));
  function rejectLinks(folder:string) {
    if(!fs.existsSync(folder))return;
    if(fs.lstatSync(folder).isSymbolicLink())throw new Error(`数据目录不支持符号链接或目录联接：${folder}`);
    requireD(fs.realpathSync.native(folder));
    for(const entry of fs.readdirSync(folder,{withFileTypes:true}))if(entry.isDirectory()||entry.isSymbolicLink())rejectLinks(path.join(folder,entry.name));
  }
  rejectLinks(data);
  for(const folder of ['config','indexes','session','logs','crashes','temp','java-home','stubs'])fs.mkdirSync(path.join(data,folder),{recursive:true});
  const probe=path.join(data,'temp',`write-probe-${process.pid}`);fs.writeFileSync(probe,'ok');fs.unlinkSync(probe);
  process.env.TEMP=process.env.TMP=process.env.TMPDIR=path.join(data,'temp');
  process.env.PYTHONPYCACHEPREFIX=path.join(data,'temp/pycache');
  for(const [key,dir] of Object.entries({appData:'config',userData:'config',sessionData:'session',temp:'temp',crashDumps:'crashes'}))app.setPath(key as Parameters<App['setPath']>[0],path.join(data,dir));
  app.setAppLogsPath(path.join(data,'logs'));
  app.commandLine.appendSwitch('user-data-dir',path.join(data,'config'));
  app.commandLine.appendSwitch('disk-cache-dir',path.join(data,'session/Cache'));
  app.commandLine.appendSwitch('crash-dumps-dir',path.join(data,'crashes'));
  app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
  return {base,data,resources:app.isPackaged?process.resourcesPath:path.join(base,'resources')};
}
export function inside(root:string,file:string) {
  const relative=path.relative(root,file);
  return relative!==''&&!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative);
}
