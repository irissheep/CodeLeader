import fs from 'node:fs';
import path from 'node:path';
export function managedPath(input){
 const resolved=path.resolve(input);if(!/^D:\\/i.test(resolved))throw new Error('受控写入必须在 D 盘：'+resolved);
 let ancestor=resolved;
 while(true){try{fs.lstatSync(ancestor);break;}catch(error){if(error.code!=='ENOENT')throw error;const parent=path.dirname(ancestor);if(parent===ancestor)throw error;ancestor=parent;}}
 const real=fs.realpathSync.native(ancestor);if(!/^D:\\/i.test(real))throw new Error('受控路径的真实祖先越出 D 盘：'+resolved);
 return resolved;
}
