import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { guard, root, run } from './common.mjs';
import { javaTools } from './java-tools.mjs';
guard();
const {jdk, mavenHome, bootstrap} = javaTools();
// Electron's package may not install its runtime during npm ci. Use its
// version-pinned installer and the process-scoped Electron cache when needed.
if (!fs.existsSync('node_modules/electron/dist/electron.exe')) {
  const env = {...process.env};
  if (!env.ELECTRON_GET_USE_PROXY && (env.HTTPS_PROXY || env.HTTP_PROXY)) env.ELECTRON_GET_USE_PROXY = '1';
  await run(process.execPath, ['node_modules/electron/install.js'], {env});
}
fs.mkdirSync('resources/grammars', { recursive: true });
for (const lang of ['java', 'python']) fs.copyFileSync(`node_modules/tree-sitter-wasms/out/tree-sitter-${lang}.wasm`, `resources/grammars/tree-sitter-${lang}.wasm`);
fs.copyFileSync('node_modules/web-tree-sitter/tree-sitter.wasm', 'resources/grammars/tree-sitter.wasm');
if (!fs.existsSync('resources/jre/bin/java.exe')) {
  // Existing JBR 21 is already a redistributable runtime; keep its legal notices.
  fs.cpSync(jdk,'resources/jre',{recursive:true});
  fs.copyFileSync(path.join(jdk,'release'),'resources/jre-version.txt');
}
await run(path.join(jdk,'bin/java.exe'),[`-Djava.io.tmpdir=${root}\\.tmp`,`-Duser.home=${root}\\.tools\\java-home`,'-classpath',bootstrap,`-Dclassworlds.conf=${mavenHome}\\bin\\m2.conf`,`-Dmaven.home=${mavenHome}`,`-Dlibrary.jansi.path=${mavenHome}\\lib\\jansi-native`,`-Dmaven.multiModuleProjectDirectory=${root}\\analyzers\\java`,'org.codehaus.plexus.classworlds.launcher.Launcher','-B','-s',path.join(root,'scripts/maven-settings.xml'),'-gs',path.join(root,'scripts/maven-settings.xml'),'-f',path.join(root,'analyzers/java/pom.xml'),`-Dmaven.repo.local=${root}\\.cache\\maven`,'package']);
fs.mkdirSync('resources/java', { recursive: true });
fs.copyFileSync('analyzers/java/target/java-worker-0.1.0.jar', 'resources/java/worker.jar');
fs.mkdirSync('resources/licenses', { recursive: true });
for (const pkg of ['electron','@xyflow/react','elkjs','monaco-editor','web-tree-sitter','pyright','react','react-dom','tree-sitter-wasms','lucide-react']) {
  const base = path.join('node_modules', pkg);
  for (const name of fs.readdirSync(base).filter(x => /^(license|notice|copying)/i.test(x))) if (fs.statSync(path.join(base,name)).isFile()) fs.copyFileSync(path.join(base,name), `resources/licenses/${pkg.replaceAll('/','-')}-${name}`);
}
const lock=JSON.parse(fs.readFileSync('package-lock.json','utf8'));
for(const [folder,info] of Object.entries(lock.packages)) {
  if(!folder||info.dev||!fs.existsSync(folder))continue;
  const pkg=JSON.parse(fs.readFileSync(path.join(folder,'package.json'),'utf8'));
  const destination=path.join('resources/licenses/npm',`${pkg.name.replaceAll('/','-')}-${pkg.version}`);fs.mkdirSync(destination,{recursive:true});
  for(const file of fs.readdirSync(folder).filter(f=>/^(license|notice|copying)/i.test(f)))if(fs.statSync(path.join(folder,file)).isFile())fs.copyFileSync(path.join(folder,file),path.join(destination,file));
}
// Keep original runtime JARs as well: shading can merge identically named notices.
const jars=['com/github/javaparser/javaparser-core/3.27.1','com/github/javaparser/javaparser-symbol-solver-core/3.27.1','com/google/code/gson/gson/2.13.2','com/google/guava/guava/33.5.0-jre','com/google/guava/failureaccess/1.0.3','com/google/guava/listenablefuture/9999.0-empty-to-avoid-conflict-with-guava','org/javassist/javassist/3.30.2-GA','org/checkerframework/checker-qual/3.51.1','com/google/errorprone/error_prone_annotations/2.41.0','com/google/j2objc/j2objc-annotations/3.1','org/jspecify/jspecify/1.0.0'];
fs.mkdirSync('resources/licenses/java-original-jars',{recursive:true});
for(const folder of jars)for(const file of fs.readdirSync(path.join('.cache/maven',folder)).filter(f=>f.endsWith('.jar')))fs.copyFileSync(path.join('.cache/maven',folder,file),path.join('resources/licenses/java-original-jars',file));
const versions={node:process.versions.node,packages:Object.fromEntries(['electron','react','vite','@xyflow/react','elkjs','monaco-editor','web-tree-sitter','tree-sitter-wasms','pyright','electron-builder'].map(name=>[name,JSON.parse(fs.readFileSync(`node_modules/${name}/package.json`,'utf8')).version])),grammarBinaries:Object.fromEntries(['java','python'].map(lang=>[lang,crypto.createHash('sha256').update(fs.readFileSync(`resources/grammars/tree-sitter-${lang}.wasm`)).digest('hex')])),javaParser:'3.27.1',jre:fs.readFileSync('resources/jre/release','utf8')};
fs.writeFileSync('resources/versions.json',JSON.stringify(versions,null,2));fs.copyFileSync('resources/versions.json','resources/licenses/versions.json');
