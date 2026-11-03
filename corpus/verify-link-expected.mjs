import fs from 'node:fs/promises';
import path from 'node:path';
import {corpusRoot,records} from './acquire.mjs';
import {sha} from './reference.mjs';
export async function verifyLinkExpected(manifest){
 const folder=path.join(records,'expected-links'),lock=JSON.parse(await fs.readFile(path.join(folder,'expected.lock.json'),'utf8'));
 for(const project of manifest.projects){const file=project.id+'/expected.json',raw=await fs.readFile(path.join(folder,file));if(sha(raw)!==lock.files[file])throw Error('R5 expected modified: '+file);const data=JSON.parse(raw);if(data.commit!==project.commit)throw Error('R5 reference commit changed');
  if(sha(await fs.readFile(path.join(records,'expected',project.id,'expected.json')))!==data.originalExpectedSha256)throw Error('Original expected changed');
  if(sha(await fs.readFile(path.join(records,'reference-authoring.mjs.txt')))!==data.referenceSha256)throw Error('Reference authoring code changed; preserve old version before revision');
  for(const e of data.evidence){const location=path.resolve(corpusRoot,project.id,e.file),root=path.resolve(corpusRoot,project.id);if(!location.startsWith(root+path.sep)||sha(await fs.readFile(location))!==e.sha256)throw Error('R5 source evidence changed: '+e.file);}
 }console.log('R5 expected locks / source evidence verified; originals unchanged');
}
