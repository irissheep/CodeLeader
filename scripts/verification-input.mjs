import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
let inputs;
export function requireValidationInputs(){
 if(!inputs){const file=process.env.CODELEADER_VALIDATION_INPUTS;if(!file||!path.isAbsolute(file)||!/^D:[\\/]/i.test(file))throw Error('此历史验证工具需要显式设置 CODELEADER_VALIDATION_INPUTS，指向 D 盘的测试输入文件；没有选择项目时不会执行。');inputs=JSON.parse(fs.readFileSync(file,'utf8'));}
 if(!inputs?.files||typeof inputs.files!=='object')throw Error('验证输入格式错误');
}
export function validationInput(moduleUrl,key){
 requireValidationInputs();
 const file=path.basename(fileURLToPath(moduleUrl)),entry=inputs.files?.[file]?.[key];if(!entry)throw Error(`验证输入缺少 ${file}:${key}`);
 if(entry.type==='regexp')return new RegExp(entry.pattern,entry.flags);
 if(!['string','number'].includes(entry.type)||typeof entry.value!==entry.type)throw Error('验证输入类型错误');return entry.value;
}
