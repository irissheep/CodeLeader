import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {guard,root} from './common.mjs';
guard();
const baselineFile=process.argv.find(value=>value.startsWith('--baseline='))?.slice(11);if(!baselineFile)throw Error('请提供已有的只读来源哈希');
const baseline=JSON.parse(await fs.readFile(baselineFile,'utf8')),sourceRoot=path.resolve(baseline.root),changed=[],errors=[];
for(const [file,expected] of Object.entries(baseline.hashes||{})){const full=path.resolve(sourceRoot,file),relative=path.relative(sourceRoot,full);if(relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative)){errors.push(file);continue;}try{const hash=crypto.createHash('sha256').update(await fs.readFile(full)).digest('hex');if(hash!==expected)changed.push(file);}catch{changed.push(file);}}
const result={root:sourceRoot,checked:Object.keys(baseline.hashes||{}).length,changed,errors,note:'只核对基线中已有的源码和配置，不证明未创建新文件，也不覆盖全部目录。'};
await fs.writeFile(path.join(root,'.tmp/verification-p1-resources/SOURCE-INTEGRITY.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));if(changed.length||errors.length)process.exitCode=1;
