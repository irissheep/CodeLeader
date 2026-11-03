import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { managedPath } from './managed-path.mjs';
export const root = path.resolve(import.meta.dirname, '..');
export function guard() {
  if (!/^D:\\/i.test(root) || process.env.TEMP !== path.join(root, '.tmp') || process.env.npm_config_cache !== path.join(root, '.cache/npm')) {
    throw new Error('请通过 scripts/Invoke-Project.ps1 运行，确保所有缓存和临时文件位于 D 盘。');
  }
  for(const folder of ['.tmp','.cache/npm','.cache/electron','.cache/builder','.cache/maven','.cache/python','.cache/browsers','.tools','.appdata','dist','resources'])managedPath(path.join(root,folder));
}
export function run(exe, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { cwd: root, stdio: 'inherit', windowsHide: true, shell: false, ...options });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`${exe}: ${code}`)));
  });
}
export async function download(url, file) {
  managedPath(file);
  if (fs.existsSync(file)) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const response = await fetch(url, { signal: AbortSignal.timeout(180000) });
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  const bytes=Buffer.from(await response.arrayBuffer());
  const partial=managedPath(file + '.part');
  managedPath(file);
  fs.writeFileSync(partial, bytes);
  fs.renameSync(partial, file);
}
