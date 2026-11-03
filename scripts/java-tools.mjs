import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

// Explicit overrides win; standard environment and PATH are portable fallbacks.
export function javaTools() {
  const jdk = process.env.CODELEADER_JDK || process.env.JAVA_HOME;
  if (!jdk || !fs.existsSync(path.join(jdk, 'bin', 'java.exe'))) {
    throw new Error('未找到 JDK：请设置 JAVA_HOME 或 CODELEADER_JDK，指向 JDK 根目录。');
  }
  const version = spawnSync(path.join(jdk, 'bin', 'java.exe'), ['-version'], {encoding: 'utf8', windowsHide: true});
  const major = /version "(?:1\.)?(\d+)/.exec(`${version.stderr || ''}\n${version.stdout || ''}`)?.[1];
  if (version.status !== 0 || !major || Number(major) < 21) throw new Error('需要 JDK 21 或更新版本，请检查 JAVA_HOME 或 CODELEADER_JDK。');
  const configured = process.env.CODELEADER_MAVEN;
  const candidates = configured ? [configured] : (process.env.PATH || '').split(path.delimiter).map(folder => path.join(folder, 'mvn.cmd'));
  const mvn = candidates.find(file => fs.existsSync(file));
  if (!mvn) throw new Error('未找到 Maven：请将 mvn.cmd 加入 PATH 或设置 CODELEADER_MAVEN。');
  const mavenHome = path.resolve(path.dirname(mvn), '..');
  const bootDir = path.join(mavenHome, 'boot');
  const bootstrap = fs.readdirSync(bootDir).find(name => name.startsWith('plexus-classworlds-') && name.endsWith('.jar'));
  if (!bootstrap) throw new Error('Maven 安装缺少启动组件，请检查 CODELEADER_MAVEN。');
  return {jdk, mavenHome, bootstrap: path.join(bootDir, bootstrap)};
}
