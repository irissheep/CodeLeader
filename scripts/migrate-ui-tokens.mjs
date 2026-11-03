import fs from 'node:fs/promises';
import path from 'node:path';
import {guard,root} from './common.mjs';
guard();
const target=path.join(root,'src/shared/ui-tokens.json'),tokens=JSON.parse(await fs.readFile(target,'utf8'));
const files=[];async function visit(folder){for(const e of await fs.readdir(folder,{withFileTypes:true})){const file=path.join(folder,e.name);if(e.isDirectory())await visit(file);else if(/\.(css|tsx?|svg)$/.test(file))files.push(file);}}
await visit(path.join(root,'src'));
const colorPattern=/#(?:[\da-f]{8}|[\da-f]{6}|[\da-f]{4}|[\da-f]{3})\b|rgba?\([^)]*\)|hsla?\([^)]*\)/gi;
const names=new Map();for(const [name,value]of Object.entries(tokens.color))if(!names.has(value.toLowerCase()))names.set(value.toLowerCase(),name);
let count=0;
const key=value=>{const old=names.get(value.toLowerCase());if(old)return old;const name='compat-'+String(names.size+1).padStart(3,'0');tokens.color[name]=value;names.set(value.toLowerCase(),name);return name;};
for(const file of files){let text=await fs.readFile(file,'utf8'),next=text;
 if(file.endsWith('.css')||file.endsWith('.svg'))next=text.replace(colorPattern,value=>{count++;return `var(--color-${key(value)})`;});
 else if(file.endsWith(path.join('main','operation-echo.ts'))){next=text.replace(colorPattern,value=>{count++;return '${uiTokens.color["'+key(value)+'"]}';});if(next!==text)next="import uiTokens from '../shared/ui-tokens';\n"+next;}
 else{next=text.replace(/(['"])(#(?:[\da-f]{8}|[\da-f]{6}|[\da-f]{4}|[\da-f]{3})\b|rgba?\([^)]*\)|hsla?\([^)]*\))\1/gi,(_all,quote,value)=>{count++;return file.endsWith('.tsx')&&quote==='"'?`{uiTokens.color["${key(value)}"]}`:`uiTokens.color["${key(value)}"]`;});if(next!==text)next="import uiTokens from '../shared/ui-tokens';\n"+next;}
 if(next!==text)await fs.writeFile(file,next);
}
await fs.writeFile(target,JSON.stringify(tokens,null,2)+'\n');console.log(JSON.stringify({migrated:count,tokens:names.size}));
