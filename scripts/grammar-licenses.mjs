import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { guard, root, run } from './common.mjs';
guard();
for(const [language,version] of [['java','0.20.2'],['python','0.21.0']]) {
  const response=await fetch(`https://registry.npmjs.org/tree-sitter-${language}/${version}`,{signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw new Error(`grammar metadata: ${response.status}`);
  const metadata=await response.json();
  const archiveResponse=await fetch(metadata.dist.tarball,{signal:AbortSignal.timeout(60000)});
  if(!archiveResponse.ok)throw new Error(`grammar archive: ${archiveResponse.status}`);
  const archive=Buffer.from(await archiveResponse.arrayBuffer());
  const [algorithm,expected]=metadata.dist.integrity.split('-');
  if(crypto.createHash(algorithm).update(archive).digest('base64')!==expected)throw new Error('Grammar archive integrity mismatch');
  const destination=path.join(root,'.cache/grammar-licenses',language);fs.mkdirSync(destination,{recursive:true});
  const file=path.join(destination,'source.tgz');fs.writeFileSync(file,archive);
  await run('tar.exe',['-xzf',file,'-C',destination,'--strip-components=1','package/LICENSE']);
  fs.copyFileSync(path.join(destination,'LICENSE'),path.join(root,`resources/licenses/tree-sitter-${language}-LICENSE`));
}
