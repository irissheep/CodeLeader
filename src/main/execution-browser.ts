import { BrowserWindow, WebContentsView, session } from 'electron';
import crypto from 'node:crypto';
import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping';
import type { BrowserRequest, BrowserOperation, ExecutionSession } from '../shared/execution';
import type { ProjectIndex } from '../shared/model';
import { safeUrl, boundedSnapshot as snapshot } from '../runtime/snapshot';
import {operationObserver} from './operation-observer';
import {clickEvidence} from '../runtime/operation-evidence';
import {OperationEcho} from './operation-echo';
import {OperationThumbnails} from './operation-thumbnails';
import {RequestOperations} from '../runtime/request-operations';
import {classifyRequest} from '../runtime/request-classification';

export function localUrl(raw:string){const u=new URL(raw);if(!['http:','https:'].includes(u.protocol)||!['127.0.0.1','localhost','[::1]'].includes(u.hostname)||u.username||u.password)throw Error('仅连接明确的本机开发页面');return u;}
export class ExecutionBrowser {
  private navigationHints=new Map<string,{reason:string;time:number}>();private mainFrame?:string;
  view:WebContentsView;private operations:RequestOperations;private requests=new Map<string,BrowserRequest>();private scripts=new Map<string,any>();private active=true;
  private metadata=new Map<string,{mime:string;size:number}>();private closed=false;
  private initiators=new Map<string,any[]>();
  private extraHeaders=new Map<string,Record<string,string>>();
  private responseExtraHeaders=new Map<string,Record<string,string>>();
  private cleanupName='__clStop_'+crypto.randomBytes(10).toString('hex');
  private downloadListener=(event:Electron.Event)=>event.preventDefault();
  private echo?:OperationEcho;private thumbnails:OperationThumbnails;private browserBounds={x:0,y:0,width:0,height:0,visible:false};
  constructor(private window:BrowserWindow,private record:ExecutionSession,private index:ProjectIndex,private changed:()=>void,folder:string,private onOperation:(operation:BrowserOperation)=>void){
    const isolated=session.fromPartition('codeleader-execution-'+record.id);
    isolated.setPermissionRequestHandler((_w,_p,cb)=>cb(false));isolated.setPermissionCheckHandler(()=>false);
    this.view=new WebContentsView({webPreferences:{session:isolated,nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true}});
    this.view.setBorderRadius(10);
    window.contentView.addChildView(this.view);const [width,height]=window.getContentSize();this.view.setBounds({x:0,y:102,width:Math.floor(width*.47),height:Math.max(100,height-102)});this.view.setVisible(true);
    const wc=this.view.webContents;
    this.thumbnails=new OperationThumbnails(wc,record,folder,changed,()=>this.view.getBounds());
    this.operations=new RequestOperations(record,operation=>{this.echo?.show(operation,this.browserBounds,true);this.onOperation(operation);if(operation.click)void this.thumbnails.save(operation).catch(()=>{});this.changed();},operation=>{this.thumbnails.release(operation.id);this.onOperation({...operation,feedback:'no-request'});});
    wc.on('before-mouse-event',(_event,input)=>{try{if(this.active)this.thumbnails.input(input);}catch{}});
    try{this.echo=new OperationEcho(window);}catch{record.warnings.push('点击回声覆盖层不可用');}
    wc.setWindowOpenHandler(()=>({action:'deny'}));
    wc.on('will-navigate',(event,url)=>{try{if(localUrl(url).origin!==new URL(record.frontendUrl).origin)event.preventDefault();}catch{event.preventDefault();}});
    wc.session.on('will-download',this.downloadListener);
    wc.debugger.on('message',(_e,method,params)=>{void this.message(method,params).catch(()=>{if(method==='Fetch.requestPaused')void wc.debugger.sendCommand('Fetch.continueRequest',{requestId:params.requestId}).catch(()=>{});});});
  }
  async load(){
    const wc=this.view.webContents;await wc.loadURL('about:blank');const d=wc.debugger;d.attach('1.3');
    await d.sendCommand('Network.enable',{maxTotalBufferSize:2*1024*1024,maxResourceBufferSize:256*1024,maxPostDataSize:128*1024});
    await d.sendCommand('Page.enable');await d.sendCommand('Runtime.enable');
    await d.sendCommand('Runtime.addBinding',{name:'codeleaderOperation'});
    await d.sendCommand('Page.addScriptToEvaluateOnNewDocument',{source:operationObserver(this.cleanupName)});
    await d.sendCommand('Debugger.enable');await d.sendCommand('Debugger.setAsyncCallStackDepth',{maxDepth:16});
    await d.sendCommand('Fetch.enable',{patterns:[{urlPattern:'http://*',requestStage:'Request'},{urlPattern:'https://*',requestStage:'Request'}]});
    await wc.loadURL(this.record.frontendUrl);
  }
  private async message(method:string,p:any){
    const d=this.view.webContents.debugger;
    if(method==='Page.frameNavigated'&&!p.frame.parentId)this.mainFrame=p.frame.id;
    if(method==='Page.frameRequestedNavigation'&&(!this.mainFrame||p.frameId===this.mainFrame)&&['anchorClick','formSubmissionGet','formSubmissionPost'].includes(p.reason)){
      this.navigationHints.set(p.url,{reason:p.reason,time:performance.now()});while(this.navigationHints.size>64)this.navigationHints.delete(this.navigationHints.keys().next().value!);
      const request=[...this.requests.values()].reverse().find(r=>r.resourceType==='Document'&&r.url===p.url&&!r.operationId&&performance.now()-r.start<1500);if(request)this.operations.navigation(request,p.reason);this.changed();
    }
    if(method==='Runtime.bindingCalled'&&p.name==='codeleaderOperation'&&this.active){try{
      if(typeof p.payload!=='string'||p.payload.length>8192)return;const value=JSON.parse(p.payload);
      if(!['click','submit','input'].includes(value.kind)||typeof value.id!=='string'||!/^[a-zA-Z0-9-]{1,100}$/.test(value.id)||typeof value.documentId!=='string'||value.documentId.length>100||new URL(value.url).origin!==new URL(this.record.frontendUrl).origin)return;
      const click=clickEvidence(value.click),native=click&&this.thumbnails.nativeMatches(click);
      const operation:BrowserOperation={id:value.id,documentId:value.documentId,kind:value.kind,time:performance.now(),observedAt:Date.now(),url:String(value.url).slice(0,4096),label:String(value.label||'').slice(0,80),source:native?'原生鼠标邻近 + 页面元素观察':'页面操作观察',...(native?{click}:{} )};
      const fresh=this.operations.observe(operation);
      if(fresh&&operation.click){this.thumbnails.reserve(operation.id);this.echo?.show(operation,this.browserBounds,false);}
      if(operation.kind==='click')this.onOperation({...operation,feedback:'click'});
      if(this.record.operations?.some(item=>item.id===operation.id))this.changed();
    }catch{}return;}
    if(method==='Network.requestWillBeSentExtraInfo'){if(this.extraHeaders.size<500)this.extraHeaders.set(p.requestId,p.headers);const request=this.requests.get(p.requestId);if(request&&this.record.policy==='raw'){request.headers=snapshot(p.headers,'raw');this.changed();}return;}
    if(method==='Network.responseReceivedExtraInfo'){if(this.responseExtraHeaders.size<500)this.responseExtraHeaders.set(p.requestId,p.headers);const request=this.requests.get(p.requestId);if(request&&this.record.policy==='raw'){request.responseHeaders=snapshot(p.headers,'raw');this.changed();}return;}
    if(method==='Debugger.scriptParsed'){if(this.scripts.size<2000)this.scripts.set(p.scriptId,p);return;}
    if(method==='Fetch.requestPaused'){
      const headers=Object.entries(p.request.headers).map(([name,value])=>({name,value:String(value)}));
      try{if(this.active&&this.record.requests.length<500){
        const networkId=String(p.networkId||p.requestId),prior=this.requests.get(networkId),id=prior?networkId+':'+this.record.requests.filter(r=>r.id===networkId||r.id.startsWith(networkId+':')).length:networkId;
        const existing=headers.find(h=>h.name.toLowerCase()==='traceparent'),valid=existing?.value.match(/^00-(?!0{32}-)([a-f0-9]{32})-(?!0{16}-)([a-f0-9]{16})-([a-f0-9]{2})$/i),traceId=valid?.[1]||crypto.randomBytes(16).toString('hex'),spanId=valid?.[2]||crypto.randomBytes(8).toString('hex'),actual=this.record.policy==='raw';
        const record:BrowserRequest={id,traceId,spanId,method:p.request.method,url:actual?p.request.url:safeUrl(p.request.url),page:actual?this.view.webContents.getURL():safeUrl(this.view.webContents.getURL()),start:performance.now(),resourceType:p.resourceType,background:true};
        record.other=classifyRequest(record,this.index,this.record.requests,false);
        // Extra headers are confined to the selected page origin; cross-origin capture does not alter CORS.
        if(!record.other&&!existing&&new URL(p.request.url).origin===new URL(this.record.frontendUrl).origin)headers.push({name:'traceparent',value:`00-${traceId}-${spanId}-01`});
        if(actual){record.headers=snapshot(this.extraHeaders.get(networkId)||p.request.headers,'raw');if(p.request.postData!==undefined)record.requestBody=snapshot(p.request.postData,'raw');}
        if(p.request.postData&&p.request.postData.length<=65536){try{record.input=snapshot(JSON.parse(p.request.postData),this.record.policy);}catch{if(/application\/x-www-form-urlencoded/i.test(String(p.request.headers['Content-Type']||p.request.headers['content-type']||'')))record.input=snapshot(Object.fromEntries(new URLSearchParams(p.request.postData)),this.record.policy);}}
        if(prior?.operationId){record.operationId=prior.operationId;record.background=false;record.operationBasis='浏览器同一重定向请求';}
        const hint=this.navigationHints.get(p.request.url);if(hint&&record.resourceType==='Document'&&record.start-hint.time<1500)this.operations.navigation(record,hint.reason);
        this.requests.set(networkId,record);this.record.requests.push(record);
        const frames=this.initiators.get(networkId);if(frames){this.operationFor(record,frames);void this.initiator(frames).then(value=>{record.initiator=value;this.changed();});}
      }else if(this.active)this.record.dropped++;}catch{this.record.warnings.push('有一个请求没记完整，页面仍可继续操作');}
      await d.sendCommand('Fetch.continueRequest',{requestId:p.requestId,headers});this.changed();return;
    }
    if(!this.active)return;
    if(method==='Network.requestWillBeSent'){
      // Fetch pauses can arrive after the passive Network event. Keep only source metadata, no headers/body.
      const frames:any[]=[];let stack=p.initiator?.stack;for(let depth=0;stack&&depth<8;depth++,stack=stack.parent)frames.push(...(stack.callFrames||[]).map((f:any)=>({url:f.url,lineNumber:f.lineNumber,columnNumber:f.columnNumber,functionName:f.functionName,scriptId:f.scriptId,asyncDepth:depth})));
      if(frames.length&&this.initiators.size<500)this.initiators.set(p.requestId,frames);
      if(p.redirectResponse){const previous=[...this.record.requests].reverse().find(r=>(r.id===p.requestId||r.id.startsWith(p.requestId+':'))&&r.url===p.redirectResponse.url&&r.finished!=='completed');if(previous){previous.status=p.redirectResponse.status;previous.end=performance.now();previous.responseObservedAt=Date.now();previous.finished='completed';if(this.record.policy==='raw')previous.responseHeaders=snapshot(p.redirectResponse.headers,'raw');previous.bodyReason='页面已跳转，没有单独的返回内容';}}
      const apply=()=>{const request=this.requests.get(p.requestId);if(request){this.operationFor(request,frames);void this.initiator(frames).then(value=>{request.initiator=value;this.changed();});}};
      apply();setTimeout(apply,0);return;
    }
    const request=this.requests.get(p.requestId);if(!request)return;
    if(method==='Network.responseReceived'){request.status=p.response.status;if(this.record.policy==='raw')request.responseHeaders=snapshot(this.responseExtraHeaders.get(p.requestId)||p.response.headers,'raw');this.metadata.set(p.requestId,{mime:p.response.mimeType,size:0});}
    if(method==='Network.responseReceivedExtraInfo'&&this.record.policy==='raw')request.responseHeaders=snapshot(p.headers,'raw');
    if(method==='Network.loadingFailed'){request.error=p.canceled?'请求已取消':'网络请求失败';request.finished=p.canceled?'cancelled':'failed';request.end=performance.now();}
    if(method==='Network.loadingFinished'){
      request.end=performance.now();request.responseObservedAt=Date.now();request.finished='completed';const meta=this.metadata.get(p.requestId);
      if(meta&&/json|text\//.test(meta.mime)&&!meta.mime.includes('event-stream')&&p.encodedDataLength<=256*1024){try{const body=await d.sendCommand('Network.getResponseBody',{requestId:p.requestId});const raw=body.base64Encoded?Buffer.from(body.body,'base64').toString('utf8'):body.body;if(this.record.policy==='raw')request.responseBody=snapshot(raw,'raw');try{request.output=snapshot(JSON.parse(raw),this.record.policy);}catch{if(this.record.policy==='raw')request.output=snapshot(raw,'raw');}}catch{request.bodyReason='正文未从浏览器缓冲区取得';}}else request.bodyReason='二进制、流或正文超出缓冲预算';
    }
    this.changed();
  }
  private async initiator(frames:any[]){
    const result:NonNullable<BrowserRequest['initiator']>=[];
    for(const f of frames.filter(f=>f.url&&!f.url.includes('node_modules')&&!f.url.includes('codeleader-operation-observer')&&!f.functionName?.startsWith('__cl_')).slice(0,8)){
      const item:NonNullable<BrowserRequest['initiator']>[number]={url:safeUrl(f.url),line:f.lineNumber,column:f.columnNumber,functionName:f.functionName};
      try{
        const script=this.scripts.get(f.scriptId);let map:any;
        if(script?.sourceMapURL?.startsWith('data:application/json')&&script.sourceMapURL.includes('base64,'))map=JSON.parse(Buffer.from(script.sourceMapURL.split(',')[1],'base64').toString('utf8'));
        if(!map&&script?.sourceMapURL){const url=new URL(script.sourceMapURL,f.url);if(url.origin===new URL(this.record.frontendUrl).origin){const response=await this.view.webContents.session.fetch(url.href);if(Number(response.headers.get('content-length')||0)<2*1024*1024)map=await response.json();}}
        if(map){const pos=originalPositionFor(new TraceMap(map),{line:f.lineNumber+1,column:f.columnNumber});
          const source=pos.source?.replaceAll('\\','/').split('?')[0];
          const file=this.index.frontendFiles?.find(file=>source&&(file.path.endsWith(source.replace(/^.*?\/src\//,'src/'))||source.endsWith('/'+file.path)));
          const content=map.sourcesContent?.[map.sources.findIndex((s:string)=>s===pos.source||pos.source?.endsWith(s))];
          if(file&&pos.line&&typeof content==='string'&&crypto.createHash('sha256').update(content).digest('hex')===file.hash){item.sourceHash=file.hash;item.location={file:file.path,range:{start:{line:pos.line-1,character:pos.column||0},end:{line:pos.line-1,character:(pos.column||0)+1}}};}
        }
      }catch{}
      result.push(item);
    }
    return result;
  }
  bounds(b:{x:number;y:number;width:number;height:number;visible:boolean}){if(this.closed)return;this.browserBounds=b;const [w,h]=this.window.getContentSize();const x=Math.max(0,Math.floor(b.x)),y=Math.max(0,Math.floor(b.y));this.view.setBounds({x,y,width:Math.max(0,Math.min(w-x,Math.floor(b.width))),height:Math.max(0,Math.min(h-y,Math.floor(b.height)))});this.view.setVisible(!!b.visible&&b.width>0&&b.height>0);}
  echoAnchor(anchor:Parameters<OperationEcho['setAnchor']>[0]){this.echo?.setAnchor(anchor);}
  private operationFor(request:BrowserRequest,frames:any[]){this.operations.associate(request,frames);request.other=request.operationId?undefined:classifyRequest(request,this.index,this.record.requests);}
  async stop(){this.active=false;this.operations.stop();await this.thumbnails.stop();if(!this.closed&&this.view.webContents.debugger.isAttached()){await this.view.webContents.debugger.sendCommand('Runtime.evaluate',{expression:`globalThis[${JSON.stringify(this.cleanupName)}]?.()`}).catch(()=>{});await this.view.webContents.debugger.sendCommand('Fetch.disable').catch(()=>{});}}
  async close(){if(this.closed)return;await this.stop();this.closed=true;this.echo?.close();const wc=this.view.webContents;wc.session.removeListener('will-download',this.downloadListener);if(wc.debugger.isAttached())wc.debugger.detach();this.window.contentView.removeChildView(this.view);if(!wc.isDestroyed())wc.close();this.requests.clear();this.initiators.clear();this.scripts.clear();this.metadata.clear();}
}
