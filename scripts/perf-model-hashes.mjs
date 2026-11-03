import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {guard,root} from './common.mjs';
guard();
const before=path.join(root,'.tmp/verification-p1-resources/models-before-ranges'),after=path.join(root,'.tmp/verification-generalization-baseline'),manifest=JSON.parse(await fs.readFile(path.join(root,'corpus/manifest.json'),'utf8'));
function canonical(value,normalise=false,key=''){if(Array.isArray(value))return value.map((item,index)=>canonical(item,normalise,`${key}.${index}`));if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().filter(name=>name!=='createdAt').map(name=>[name,canonical(value[name],normalise,`${key}.${name}`)]));if(normalise&&typeof value==='string'&&/^\.symbols\.\d+\.signature$/.test(key))return value.replace(/Anonymous-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,'Anonymous-<random>');return value;}
const hash=(value,normalise=false)=>crypto.createHash('sha256').update(JSON.stringify(canonical(value,normalise))).digest('hex'),rows=[];
for(const project of manifest.projects){const old=JSON.parse(await fs.readFile(path.join(before,`${project.id}.json`),'utf8')),now=JSON.parse(await fs.readFile(path.join(after,project.id,'model.json'),'utf8')),oldHash=hash(old),newHash=hash(now),normalBefore=hash(old,true),normalAfter=hash(now,true);rows.push({project:project.id,before:oldHash,after:newHash,match:oldHash===newHash,normalBefore,normalAfter,normalMatch:normalBefore===normalAfter});}
await fs.writeFile(path.join(root,'.tmp/verification-p1-resources/MODEL-HASHES.json'),JSON.stringify({excluded:['createdAt'],normalisedOnly:'symbols 的匿名类签名内随机 UUID，原始哈希仍单列',rows},null,2));console.log(JSON.stringify(rows));if(rows.some(row=>!row.match))process.exitCode=1;
