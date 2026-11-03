import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import crypto from 'node:crypto';
import {managedPath} from '../../scripts/managed-path.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const corpus = managedPath(process.env.CODELEADER_CORPUS || path.join(root, '.cache', 'corpus'));
const hooks = managedPath(path.join(root, '.tmp', 'public-corpus-empty-hooks'));
const manifest = JSON.parse(await fs.readFile(path.join(root, 'corpus/public/manifest.json'), 'utf8'));
const checkOnly = process.argv.includes('--check-only');
if (!Array.isArray(manifest.projects)) throw Error('公开语料清单格式不正确');
await fs.mkdir(hooks, {recursive: true});
if (!checkOnly) await fs.mkdir(corpus, {recursive: true});

function git(args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['-c', `core.hooksPath=${hooks}`, '-c', `init.templateDir=${hooks}`, '-c', 'core.fsmonitor=false', '-c', 'core.autocrlf=true', ...args], {
      cwd, windowsHide: true, shell: false, env: {...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(hooks, 'no-global-config')}, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve(stdout.trim()) : reject(Error(`Git 操作失败（退出码 ${code}）：${stderr.slice(-800)}`)));
  });
}

for (const project of manifest.projects) {
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(project.id) || !/^[0-9a-f]{40}$/i.test(project.commit)) throw Error('公开语料身份或固定版本不正确');
  const destination = managedPath(path.join(corpus, project.id));
  const exists = await fs.stat(destination).then(() => true, error => error.code === 'ENOENT' ? false : Promise.reject(error));
  if (!exists && (checkOnly || !project.license || project.license === '未知')) {
    console.log(`${project.id}：已跳过（${checkOnly ? '未找到本地语料' : '许可证未核实'}）`);
    continue;
  }
  if (!exists) {
    const source = new URL(project.source);
    if (source.protocol !== 'https:' || source.hostname !== 'github.com' || source.username || source.password) throw Error('公开语料来源必须是无凭据的 HTTPS 地址');
    // Build a separate temporary checkout so an interrupted fetch never turns
    // the intended destination into an unusable partial project.
    const staging = managedPath(await fs.mkdtemp(path.join(corpus, '.download-')));
    try {
      await git(['init', staging], root);
      await git(['remote', 'add', 'origin', project.source], staging);
      await git(['fetch', '--depth', '1', 'origin', project.commit], staging);
      await git(['checkout', '--detach', project.commit], staging);
      await fs.rename(staging, destination);
    } catch (error) {
      throw Error(`${project.id} 获取失败，临时目录已保留供检查：${staging}；${error.message}`);
    }
  }
  const head = await git(['rev-parse', 'HEAD'], destination);
  if (head !== project.commit) throw Error(`${project.id} 版本与清单不符；不会修改现有文件`);
  if (await git(['status', '--porcelain', '--untracked-files=all'], destination)) throw Error(`${project.id} 有本地修改；不会覆盖`);
  const expected = JSON.parse(await fs.readFile(path.join(root, 'corpus/public/expected', project.id, 'expected.json'), 'utf8'));
  if (expected.commit !== project.commit) throw Error(`${project.id} 标注版本与清单不符`);
  const evidence = new Map();
  function visit(value) {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { for (const item of value) visit(item); return; }
    if (typeof value.file === 'string' && typeof value.sha256 === 'string') {
      if (evidence.has(value.file) && evidence.get(value.file) !== value.sha256) throw Error(`${project.id} 同一证据的哈希不一致`);
      evidence.set(value.file, value.sha256);
    }
    for (const item of Object.values(value)) visit(item);
  }
  visit(expected);
  const realRoot = await fs.realpath(destination);
  for (const [file, sha256] of evidence) {
    const realFile = await fs.realpath(path.resolve(realRoot, file));
    const relative = path.relative(realRoot, realFile);
    if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw Error(`${project.id} 证据路径超出语料`);
    const actual = crypto.createHash('sha256').update(await fs.readFile(realFile)).digest('hex');
    if (actual !== sha256) throw Error(`${project.id} 证据内容与冻结哈希不符：${file}`);
  }
  console.log(`${project.id}：固定版本及 ${evidence.size} 个证据文件已核对`);
}
const privateManifest = await fs.stat(path.join(root,'corpus/private/manifest.json')).then(()=>true,e=>e.code==='ENOENT'?false:Promise.reject(e));
console.log(privateManifest?'私有语料默认未启用，未进行评分。':'已跳过（未找到私有语料）。');
