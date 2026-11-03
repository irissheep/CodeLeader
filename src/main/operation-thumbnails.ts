import fs from 'node:fs/promises';import path from 'node:path';import crypto from 'node:crypto';
import type {WebContents}from'electron';
import type {BrowserOperation,ExecutionSession,OperationThumbnail}from'../shared/execution';
import {managedPath}from'../../scripts/managed-path.mjs';
export class OperationThumbnails {
 private last?:{x:number;y:number;time:number;image?:Promise<{bytes:Buffer;at:number}>};private inFlight=0;private count=0;private pending=new Set<Promise<void>>();private stopped=false;
 private reserved=new Map<string,Promise<{bytes:Buffer;at:number}>|undefined>();
 constructor(private wc:WebContents,private session:ExecutionSession,private folder:string,private changed:()=>void,private viewport:()=>{width:number;height:number}){}
 input(input:Electron.MouseInputEvent){
  if(this.stopped||input.button!=='left')return;
  if(input.type==='mouseDown'){
   const item={x:input.x,y:input.y,time:performance.now(),image:undefined as Promise<{bytes:Buffer;at:number}>|undefined};this.last=item;
   if(this.session.thumbnailCapture===false||this.inFlight>=2||this.count>=200)return;
   const {width,height}=this.viewport();
   if(!width||!height||!Number.isFinite(input.x)||!Number.isFinite(input.y))return;
   const size={width:Math.min(224,Math.max(1,Math.floor(width))),height:Math.min(140,Math.max(1,Math.floor(height)))};
   // Only the bounded click crop is requested; no full-page image is captured.
   const rect={x:Math.max(0,Math.min(width-size.width,Math.floor(input.x-112))),y:Math.max(0,Math.min(height-size.height,Math.floor(input.y-70))),...size};
   this.inFlight++;this.count++;
   const capture=this.wc.capturePage(rect).then(image=>({bytes:image.resize({width:112,height:70,quality:'good'}).toJPEG(70),at:Date.now()})).finally(()=>this.inFlight--);
   item.image=(async()=>{let timer:ReturnType<typeof setTimeout>|undefined;try{return await Promise.race([capture,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('截图超时')),1500);})]);}finally{clearTimeout(timer);}})();void item.image.catch(()=>{});
  }
  if(input.type==='mouseUp'&&this.last&&Math.hypot(input.x-this.last.x,input.y-this.last.y)<10)this.last.time=performance.now();
 }
 nativeMatches(click:NonNullable<BrowserOperation['click']>){return !!this.last&&performance.now()-this.last.time<1000&&Math.hypot(click.x-this.last.x,click.y-this.last.y)<12;}
 reserve(id:string){this.reserved.set(id,this.last?.image);while(this.reserved.size>32)this.reserved.delete(this.reserved.keys().next().value!);}
 release(id:string){this.reserved.delete(id);}
 save(operation:BrowserOperation){const image=this.reserved.has(operation.id)?this.reserved.get(operation.id):this.last?.image;this.release(operation.id);const task=this.saveImage(operation,image);this.pending.add(task);void task.finally(()=>this.pending.delete(task)).catch(()=>{});return task;}
 private enabled(){return this.session.thumbnailCapture!==false;}
 async stop(){this.stopped=true;await Promise.allSettled([...this.pending]);this.last=undefined;this.reserved.clear();}
 private async saveImage(operation:BrowserOperation,image:Promise<{bytes:Buffer;at:number}>|undefined){
  if(!operation.click)return;
  if(!this.enabled()){operation.thumbnail={status:'disabled'};return;}
  if(!image){operation.thumbnail={status:'unavailable',reason:'局部截图预算或页面条件限制'};return;}
  try{const captured=await image;if(this.session.thumbnailCapture===false){operation.thumbnail={status:'disabled'};return;}if(captured.bytes.length>32768)throw Error('局部图片超出预算');
   const folder=managedPath(path.join(this.folder,'thumbnails'));await fs.mkdir(folder,{recursive:true});
   const name=crypto.createHash('sha256').update(operation.documentId+'\0'+operation.id).digest('hex').slice(0,24)+'.jpg';
   await fs.writeFile(managedPath(path.join(folder,name)),captured.bytes);operation.thumbnail={status:'saved',name,width:112,height:70,bytes:captured.bytes.length,capturedAt:captured.at};
  }catch{operation.thumbnail={status:'unavailable',reason:'未取得局部截图'};}this.changed();
 }
}
export async function readThumbnail(folder:string,thumbnail:OperationThumbnail|undefined){
 if(thumbnail?.status!=='saved'||!thumbnail.name||!/^[a-f0-9]{24}\.jpg$/.test(thumbnail.name))return;
 const file=managedPath(path.join(folder,'thumbnails',thumbnail.name));try{if((await fs.stat(file)).size>32768)return;const bytes=await fs.readFile(file);if(bytes.length>32768||bytes[0]!==255||bytes[1]!==216)return;return 'data:image/jpeg;base64,'+bytes.toString('base64');}catch{return;}
}
