import path from 'node:path';
import {guard,root,run} from './common.mjs';
import {javaTools} from './java-tools.mjs';
guard();const {jdk,mavenHome,bootstrap}=javaTools();
await run(path.join(jdk,'bin/java.exe'),[`-Djava.io.tmpdir=${root}/.tmp`,`-Duser.home=${root}/.tools/java-home`,'-classpath',bootstrap,`-Dclassworlds.conf=${mavenHome}/bin/m2.conf`,`-Dmaven.home=${mavenHome}`,`-Dmaven.multiModuleProjectDirectory=${root}/runtime/java`,'org.codehaus.plexus.classworlds.launcher.Launcher','-B','-s',root+'/scripts/maven-settings.xml','-gs',root+'/scripts/maven-settings.xml','-f',root+'/runtime/java/pom.xml',`-Dmaven.repo.local=${root}/.cache/maven`,'package','-DskipTests']);
