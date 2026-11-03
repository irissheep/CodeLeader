import fs from 'node:fs/promises';
import path from 'node:path';
import {inflateRawSync} from 'node:zlib';
import type {ProjectIndex} from '../shared/model';
import policy from '../shared/runtime-policy.json';
/** Reads one bounded manifest; never loads classes or extracts an archive. */
export async function jarMain(file:string){
 const handle=await fs.open(file,'r');try{const {size}=await handle.stat(),tail=Buffer.alloc(Math.min(size,65557));await handle.read(tail,0,tail.length,size-tail.length);let end=tail.length-22;for(;end>=0;end--)if(tail.readUInt32LE(end)===0x06054b50)break;if(end<0)return;
  const length=tail.readUInt32LE(end+12),offset=tail.readUInt32LE(end+16),limit=policy.thresholds.metadataBytes.value;if(length>limit||offset+length>size)return;
  const directory=Buffer.alloc(length);await handle.read(directory,0,length,offset);
  for(let p=0;p+46<=length;){if(directory.readUInt32LE(p)!==0x02014b50)return;const nameLength=directory.readUInt16LE(p+28),extra=directory.readUInt16LE(p+30),comment=directory.readUInt16LE(p+32),name=directory.subarray(p+46,p+46+nameLength).toString('utf8');
   if(name==='META-INF/MANIFEST.MF'){const compressed=directory.readUInt32LE(p+20),local=directory.readUInt32LE(p+42),method=directory.readUInt16LE(p+10);if(compressed>limit||local+30>size)return;const header=Buffer.alloc(30);await handle.read(header,0,30,local);if(header.readUInt32LE(0)!==0x04034b50)return;const start=local+30+header.readUInt16LE(26)+header.readUInt16LE(28);if(start+compressed>size)return;const bytes=Buffer.alloc(compressed);await handle.read(bytes,0,compressed,start);const text=(method===8?inflateRawSync(bytes,{maxOutputLength:limit}):method===0?bytes:Buffer.alloc(0)).toString('utf8').replace(/\r?\n /g,'');return text.match(/^Main-Class:\s*([^\r\n]+)/m)?.[1]?.trim();}
   p+=46+nameLength+extra+comment;
  }
 }finally{await handle.close();}
}
export async function startupArtifacts(index:ProjectIndex){const found:{unitId:string;file:string;main:string}[]=[];for(const unit of index.units?.filter(u=>u.kind==='application'&&u.language==='java')||[])for(const suffix of ['target','build/libs']){const folder=path.posix.join(unit.root,suffix);for(const entry of await fs.readdir(path.join(index.root,folder),{withFileTypes:true}).catch(()=>[])){if(!entry.isFile()||!entry.name.endsWith('.jar'))continue;const file=path.posix.join(folder,entry.name);try{const main=await jarMain(path.join(index.root,file));if(main)found.push({unitId:unit.id,file,main});}catch{}}}return found;}
