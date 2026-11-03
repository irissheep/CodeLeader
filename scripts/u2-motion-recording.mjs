import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {performance} from 'node:perf_hooks';

export async function startClip(page,folder,name,encoder){
 const cdp=await page.context().newCDPSession(page),frames=[],start=performance.now();
 const listener=event=>{frames.push({time:performance.now()-start,data:Buffer.from(event.data,'base64')});void cdp.send('Page.screencastFrameAck',{sessionId:event.sessionId}).catch(()=>{});};
 cdp.on('Page.screencastFrame',listener);
 await cdp.send('Page.startScreencast',{format:'jpeg',quality:78,maxWidth:1564,maxHeight:954,everyNthFrame:1});
 return async()=>{
  const duration=performance.now()-start;await cdp.send('Page.stopScreencast');cdp.off('Page.screencastFrame',listener);await cdp.detach();
  if(!frames.length)throw Error('No real renderer frames captured');
  const file=path.join(folder,name+'.webm'),child=spawn(encoder,['-hide_banner','-loglevel','error','-y','-f','image2pipe','-c:v','mjpeg','-r','30','-i','pipe:0','-an','-c:v','libvpx-vp9','-deadline','realtime','-cpu-used','8','-crf','35','-b:v','0',file],{windowsHide:true,stdio:['pipe','ignore','pipe']});
  let error='';child.stderr.on('data',b=>error+=b);const finished=new Promise((resolve,reject)=>{child.on('exit',code=>code===0?resolve():reject(Error(error||'Video encoding failed')));child.on('error',reject);});
  let at=0,count=0;for(let time=0;time<duration;time+=1000/30){while(at+1<frames.length&&frames[at+1].time<=time)at++;if(!child.stdin.write(frames[at].data))await new Promise(resolve=>child.stdin.once('drain',resolve));count++;}
  child.stdin.end();await finished;
  const result={name,file,durationMs:duration,containerFps:30,capturedFrames:frames.length,encodedFrames:count,sourceTimesMs:frames.map(f=>f.time),method:'CDP actual renderer JPEG frames, timestamp held to 30fps, VP9 WebM; no generated scene'};
  await fs.writeFile(path.join(folder,name+'.json'),JSON.stringify(result,null,2));return result;
 };
}
