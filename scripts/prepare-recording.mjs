import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {guard, root} from './common.mjs';
import {managedPath} from './managed-path.mjs';

guard();
const lock = JSON.parse(await fsp.readFile(path.join(root, 'runtime/dependencies.json'), 'utf8'));
const cache = managedPath(path.join(root, '.cache/recording'));
const output = managedPath(path.join(root, '.tools/runtime'));
await fsp.mkdir(cache, {recursive: true});
await fsp.mkdir(output, {recursive: true});

async function hash(file) {
  const digest = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) digest.update(chunk);
  return digest.digest('hex');
}
async function verified(file, expected) {
  if (!await fsp.stat(file).then(() => true, e => e.code === 'ENOENT' ? false : Promise.reject(e))) return false;
  if (await hash(file) !== expected) throw Error(`组件校验失败，请检查文件：${file}`);
  return true;
}
async function download(item, destination) {
  if (await verified(destination, item.sha256)) return;
  const url = new URL(item.url);
  if (url.protocol !== 'https:' || url.hostname !== 'github.com') throw Error('运行组件来源不受支持');
  const response = await fetch(url, {signal: AbortSignal.timeout(300000)});
  if (!response.ok || !response.body) throw Error(`运行组件下载失败：HTTP ${response.status}`);
  const temporary = managedPath(destination + '.' + crypto.randomUUID() + '.part');
  await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(temporary, {flags: 'wx'}));
  if (await hash(temporary) !== item.sha256) throw Error(`下载组件校验失败，临时文件已保留：${temporary}`);
  await fsp.rename(temporary, destination);
}

const agent = managedPath(path.join(output, 'opentelemetry-javaagent.jar'));
const archive = managedPath(path.join(cache, 'collector.tar.gz'));
const collector = managedPath(path.join(output, 'otelcol.exe'));
await download(lock.javaAgent, agent);
await download({url:lock.collector.sbomUrl,sha256:lock.collector.sbomSha256}, managedPath(path.join(cache, 'collector-sbom.spdx.json')));
if (!await verified(collector, lock.collector.binarySha256)) {
  await download(lock.collector, archive);
  const temporary = managedPath(collector + '.' + crypto.randomUUID() + '.part');
  const tar = spawn('tar.exe', ['-xOf', archive, 'otelcol-contrib.exe'], {windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']});
  let stderr = '';
  tar.stderr.on('data', chunk => { stderr += chunk; });
  const finished = new Promise((resolve, reject) => {
    tar.once('error', reject);
    tar.once('exit', code => code === 0 ? resolve() : reject(Error(`解压收集器失败：${stderr.slice(-500)}`)));
  });
  await Promise.all([pipeline(tar.stdout, fs.createWriteStream(temporary, {flags: 'wx'})), finished]);
  if (await hash(temporary) !== lock.collector.binarySha256) throw Error(`收集器校验失败，临时文件已保留：${temporary}`);
  await fsp.rename(temporary, collector);
}
console.log('录制组件的固定版本和 SHA-256 已核对。');
