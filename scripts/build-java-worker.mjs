import fs from 'node:fs';
import path from 'node:path';
import { guard, root, run } from './common.mjs';
import { javaTools } from './java-tools.mjs';
guard();
const {jdk,mavenHome,bootstrap}=javaTools();
await run(path.join(jdk,'bin/java.exe'),[`-Djava.io.tmpdir=${root}\\.tmp`,`-Duser.home=${root}\\.tools\\java-home`,'-classpath',bootstrap,`-Dclassworlds.conf=${mavenHome}\\bin\\m2.conf`,`-Dmaven.home=${mavenHome}`,`-Dlibrary.jansi.path=${mavenHome}\\lib\\jansi-native`,`-Dmaven.multiModuleProjectDirectory=${root}\\analyzers\\java`,'org.codehaus.plexus.classworlds.launcher.Launcher','-B','-s',path.join(root,'scripts/maven-settings.xml'),'-gs',path.join(root,'scripts/maven-settings.xml'),'-f',path.join(root,'analyzers/java/pom.xml'),`-Dmaven.repo.local=${root}\\.cache\\maven`,'package']);
fs.copyFileSync(path.join(root,'analyzers/java/target/java-worker-0.1.0.jar'),path.join(root,'resources/java/worker.jar'));
