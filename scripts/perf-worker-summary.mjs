import fs from 'node:fs/promises';
import path from 'node:path';
import {TraceMap,originalPositionFor} from '@jridgewell/trace-mapping';
import {guard,root} from './common.mjs';
guard();
const label=process.argv.find(value=>value.startsWith('--label='))?.slice(8)||'worker-profile';if(!/^[a-z0-9_-]+$/i.test(label))throw Error('测量名称无效');
const folder=path.join(root,'.tmp/verification-p1-resources',label),sourceMap=new TraceMap(JSON.parse(await fs.readFile(path.join(root,'dist/worker.cjs.map'),'utf8'))),results=[];
for(const file of (await fs.readdir(folder)).filter(name=>name.endsWith('.cpuprofile'))){const profile=JSON.parse(await fs.readFile(path.join(folder,file),'utf8')),nodes=new Map(profile.nodes.map(node=>[node.id,node.callFrame])),totals=new Map();
 for(let i=0;i<(profile.samples||[]).length;i++){const frame=nodes.get(profile.samples[i]);if(!frame||frame.functionName==='(idle)')continue;let where=frame.url||'(native)',line=frame.lineNumber+1;if(where.endsWith('/dist/worker.cjs')){const original=originalPositionFor(sourceMap,{line,column:frame.columnNumber});if(original.source){where=original.source;line=original.line;}}const key=`${frame.functionName||'(anonymous)'} · ${where}:${line}`;totals.set(key,(totals.get(key)||0)+(profile.timeDeltas?.[i]||0));}
 results.push({file,functions:[...totals].sort((a,b)=>b[1]-a[1]).slice(0,10).map(([name,microseconds])=>({name,sampledSeconds:microseconds/1e6}))});
}
await fs.writeFile(path.join(folder,'worker-functions.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results));
