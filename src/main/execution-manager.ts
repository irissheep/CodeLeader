import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { BrowserWindow } from 'electron';
import { managedPath } from '../../scripts/managed-path.mjs';
import type { ExecutionSession, CapturePolicy, BrowserOperation, StartupFailure } from '../shared/execution';
import {readThumbnail} from './operation-thumbnails';
import type {OperationEcho} from './operation-echo';
import type { ProjectIndex } from '../shared/model';
import { buildPlan } from '../runtime/plan';
import { BatchReader, mergeRecorded } from '../runtime/otlp';
import { ExecutionBrowser, localUrl } from './execution-browser';
import {hideActual} from '../runtime/snapshot';
import {idleSeconds,updateAfterResponse} from '../runtime/after-response';
import {sessionOrderEvidence} from '../runtime/replay';
import type {SafeValue} from '../shared/execution';
import type {RuntimeEnvironment,RuntimeComponent} from './runtime-configuration';
import {startupHint} from './startup-failure';
import {StartupManager} from './startup-manager';
import type {StartupPlan} from '../shared/startup';
import runtimePolicy from '../shared/runtime-policy.json';
import {belongsToProject} from '../shared/project-scope';

type StartupRun={service:string;command:string;cwd:string;log:string;child?:ChildProcess;pending:Promise<void>;port?:number;unitId?:string;owner?:{pid:number;name?:string};captureFailed?:boolean;tail?:Buffer};
export class ExecutionManager {
  private startups:StartupManager;
  async startup(index:ProjectIndex){const generation=this.generation;this.assertProject(index);const plan=await this.startups.preview(index);if(generation!==this.generation)throw Error('项目已切换');return plan;}
  async confirmStartup(index:ProjectIndex,plan:StartupPlan){const generation=this.generation;this.assertProject(index);const result=await this.startups.confirm(index,plan);if(generation!==this.generation){this.startups.revoke(result.token);throw Error('项目已切换');}return result;}
  private project?:{id:string;root:string};private generation=0;
  async activateProject(project:{id:string;root:string}){
    if(this.project?.id===project.id&&this.project.root.toLowerCase()===project.root.toLowerCase()){await this.stopping?.catch(()=>{});return;}
    ++this.generation;this.startups.reset();clearInterval(this.timer);this.cancelled=true;
    await this.stopping?.catch(()=>{});
    await this.browser?.close();this.browser=undefined;this.browserBounds=undefined;
    await this.collectorStop();await this.stopEnvironment();await this.persistence;
    this.current=undefined;this.reader=undefined;this.folder='';this.startupRun=undefined;this.frontendRun=undefined;this.setupFailure=undefined;this.stopping=undefined;this.dirty=false;this.project=project;
  }
  private assertProject(project:ProjectIndex){if(this.project?.id!==project.id)throw Error('项目已切换，请在当前项目重新操作');}
  reconcileIndex(index:ProjectIndex){const record=this.current;if(!record||!belongsToProject(record,index))return;const version=crypto.createHash('sha256').update(index.files.map(f=>`${f.path}:${f.hash}`).sort().join('\n')).digest('hex');if(record.sourceVersion!==version){for(const span of record.spans){span.versionMatch=false;span.symbolId=undefined;span.location=undefined;}const warning='源码已变化，原有数据仍可查看，源码对应已停用。';if(!record.warnings.includes(warning))record.warnings.push(warning);}for(const request of record.requests)for(const frame of request.initiator||[])if(!index.frontendFiles?.some(f=>f.path===frame.location?.file&&f.hash===frame.sourceHash))frame.location=undefined;this.emit(structuredClone(record));}
  private connectionPath(){if(!this.project)throw Error('请先打开项目');return managedPath(path.join(this.data,'connections',this.project.id+'.json'));}
  async connection(){const project=this.project!,file=this.connectionPath();let saved;try{saved=JSON.parse(await fs.readFile(file,'utf8'));}catch{}return {url:saved&&belongsToProject(saved,project)?saved.url:'',owned:!!(saved&&belongsToProject(saved,project)&&saved.owned),environmentFile:managedPath(path.join(this.base,'.tools/runtime/environments',project.id,'environment.json'))};}
  async configure(options:{url:string;owned:boolean}){const project=this.project!,file=this.connectionPath();if(!options||typeof options.url!=='string'||typeof options.owned!=='boolean')throw Error('连接设置无效');const url=options.url?localUrl(options.url).href:'';await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,JSON.stringify({projectId:project.id,projectRoot:project.root,url,owned:options.owned}));}
  async javaConnection(index:ProjectIndex){
    const project=this.project!,folder=managedPath(path.join(this.data,'connections',project.id));await fs.mkdir(folder,{recursive:true});
    const plan=await this.startup(index),file=managedPath(path.join(folder,'JAVA_CONNECTION.md'));
    const units=(index.units||[]).filter(u=>u.kind==='application'&&u.language==='java');
    await fs.writeFile(file,['# Java connection','','Current source: '+index.root,'','Open the startup dialog to review every detected application, command, working directory and port. Nothing starts until confirmation.','',...units.map(u=>'- '+(u.root||index.name)+': '+u.basis.map(b=>b.location.file+':'+(b.location.range.start.line+1)).join(', ')),'','Saved startup selections: '+path.join(this.base,'.tools/runtime/environments',index.id,'startup.json'),'','Detected commands:',...plan.choices.filter(c=>c.language==='java').map(c=>'- '+c.command.label+' (port '+(c.port||'not determined')+')'),'','For an external launcher, the active D-drive session contains plan.properties and collector.yaml. Use its CODELEADER_PLAN, CODELEADER_SESSION and CODELEADER_VERSION, and the external Java agent. Without these, browser requests remain available but internal calls are not claimed.','', 'A ready JAR whose source version cannot be verified is shown without source mapping.'].join('\n'));return file;
  }
  browser?:ExecutionBrowser;current?:ExecutionSession;private collector?:ChildProcess;private owned:ChildProcess[]=[];
  private timer?:ReturnType<typeof setInterval>;private folder='';private offset=0;private reader?:BatchReader;private busy=false;private dirty=false;
  private mysql?:{admin:string;port:number;child:ChildProcess};
  private cancelled=false;private persistence=Promise.resolve();private stopping?:Promise<ExecutionSession|undefined>;private importerDrops=0;
  private browserBounds?:{x:number;y:number;width:number;height:number;visible:boolean};
  private startupRun?:StartupRun;
  private frontendRun?:typeof this.startupRun;
  private startupNumber=0;
  private setupFailure?:{projectId:string;failure:StartupFailure;log:string};
  private currentStartup(){return this.startupRun;}
  private currentFrontend(){return this.frontendRun;}
  bounds(b:{x:number;y:number;width:number;height:number;visible:boolean}){this.browserBounds=b;this.browser?.bounds(b);}
  constructor(private base:string,private data:string,private window:()=>BrowserWindow,private emit:(s:ExecutionSession)=>void,private onOperation:(operation:BrowserOperation)=>void=()=>{}){this.startups=new StartupManager(base,data);}
  private sessions(){return managedPath(path.join(this.data,'executions'));}
  private sessionPath(id:string){if(!/^[a-f0-9-]{36}$/.test(id))throw Error('会话标识无效');return managedPath(path.join(this.sessions(),id));}
  private async write(){if(!this.current)return;const folder=managedPath(this.folder),snapshot=structuredClone(this.current),text=JSON.stringify(snapshot);this.dirty=false;
    this.persistence=this.persistence.catch(()=>{}).then(async()=>{const next=managedPath(path.join(folder,'session.next'));await fs.writeFile(next,text);await fs.rename(next,managedPath(path.join(folder,'session.json')));if(this.current?.id===snapshot.id&&this.project&&belongsToProject(snapshot,this.project))this.emit(snapshot);});return this.persistence;
  }
  private warn(text:string){if(this.current&&this.current.warnings.length<30&&!this.current.warnings.includes(text)){this.current.warnings.push(text);this.changed();}}
  private changed=()=>{this.dirty=true;};
  private async stage(text:string){if(this.current){this.current.connectionStage=text;await this.write();}}
  async start(index:ProjectIndex,options:{url:string;policy:CapturePolicy;owned:boolean;startupToken?:string;thumbnails?:boolean;backgroundIdleSeconds?:number}){
    const environment=options.owned?this.startups.take(index,options.startupToken):undefined;
    const generation=++this.generation;await this.stopping;if(generation!==this.generation)throw Error('项目已切换');this.assertProject(index);
    localUrl(options.url);if(!['structure','synthetic','raw'].includes(options.policy))throw Error('录制策略无效');
    if(this.current&&['connecting','recording'].includes(this.current.state))throw Error('请先停止当前录制');
    if(this.owned.some(c=>c.exitCode===null))await this.stopEnvironment();
    this.cancelled=false;this.stopping=undefined;this.startupRun=undefined;this.frontendRun=undefined;this.setupFailure=undefined;this.startupNumber=0;
    await this.browser?.close();
    const texts=new Map<string,string>();for(const f of index.files){const text=await fs.readFile(path.join(index.root,f.path),'utf8');if(crypto.createHash('sha256').update(text).digest('hex')!==f.hash)throw Error('源码已变化，请重新分析再录制');texts.set(f.path,text);}
    const plan=buildPlan(index,texts),id=crypto.randomUUID();plan.capturePolicy=options.policy;plan.excludedUrls=environment?.excludedUrls||'';this.folder=this.sessionPath(id);await fs.mkdir(this.folder,{recursive:true});
    this.current={id,protocolVersion:2,operations:[],thumbnailCapture:options.thumbnails!==false,projectId:index.id,projectRoot:index.root,createdAt:new Date().toISOString(),state:'connecting',sourceVersion:plan.sourceVersion,frontendUrl:localUrl(options.url).href,policy:options.policy,plan,spans:[],requests:[],dropped:0,bytes:0,warnings:[],processes:[]};
    this.current.backgroundIdleSeconds=idleSeconds(options.backgroundIdleSeconds);
    this.offset=0;this.importerDrops=0;this.reader=new BatchReader(plan);await fs.writeFile(path.join(this.folder,'plan.json'),JSON.stringify(plan));
    await this.write();
    const properties=[`version=${plan.sourceVersion}`,`policy=${options.policy}`,`owners=${[...new Set(plan.points.filter(p=>p.language==='java').map(p=>p.owner))]}`,`dtos=${plan.dtoTypes}`];
    for(const p of plan.points.filter(p=>p.language==='java'))properties.push(`method.${p.owner}#${p.method}(${p.parameters.join(',')})=${p.id}`,`names.${p.id}=${p.parameterNames.join(',')}`);
    await fs.writeFile(path.join(this.folder,'plan.properties'),properties.join('\n'));
    try{
      const net=await import('node:net');const server=net.createServer();await new Promise<void>((resolve,reject)=>server.listen(0,'127.0.0.1',resolve).once('error',reject));const port=(server.address() as import('node:net').AddressInfo).port;await new Promise<void>(resolve=>server.close(()=>resolve()));
      const config=`receivers:\n  otlp:\n    protocols:\n      http:\n        endpoint: 127.0.0.1:${port}\n        max_request_body_size: 4194304\nexporters:\n  file:\n    path: ${JSON.stringify(path.join(this.folder,'otlp.jsonl'))}\n    format: json\n    append: true\n    flush_interval: 200ms\nservice:\n  telemetry:\n    logs:\n      level: error\n    metrics:\n      level: none\n  pipelines:\n    traces:\n      receivers: [otlp]\n      exporters: [file]\n`;
      await fs.writeFile(path.join(this.folder,'collector.yaml'),config);
      this.collector=await this.launch(managedPath(path.join(this.base,'.tools/runtime/otelcol.exe')),['--config',path.join(this.folder,'collector.yaml')],this.folder,{},'collector');
      await this.waitPort(port);
      await this.stage('本地接收已就绪');
      if(environment){await this.startOwned(index,`http://127.0.0.1:${port}`,environment);const frontend=this.currentFrontend();if(frontend){this.startupRun=frontend;await this.stage('等待页面可访问');await this.waitPage(options.url,frontend.child);}}
      else this.current.warnings.push('只连接现有页面；未接入本会话的服务没有内部值，不能从静态路径补亮。');
      this.startupRun=undefined;await this.stage('正在打开真实页面');const record=this.current;this.browser=new ExecutionBrowser(this.window(),record,index,()=>{if(this.current===record)this.changed();},this.folder,operation=>{if(this.current===record&&this.project?.id===record.projectId)this.onOperation(operation);});if(this.browserBounds)this.browser.bounds(this.browserBounds);await Promise.race([this.browser.load(),new Promise((_,reject)=>setTimeout(()=>reject(Error('开发页面初始化超时')),20000))]);
      if(this.cancelled)throw Error('接入已取消');this.current.state='recording';this.current.connectionStage='真实页面与观察点已就绪';this.timer=setInterval(()=>void this.poll().catch(()=>this.warn('记录文件读取或保存失败，已记录数据可能不完整')) ,350);await this.write();return this.current;
    }catch(error){this.current.state=this.cancelled?'stopped':'failed';let run=this.currentStartup();if(!this.cancelled){const message=error instanceof Error?error.message:String(error);if(!run){const log=managedPath(path.join(this.folder,`startup-${++this.startupNumber}.log`));run={service:'页面',command:'—',cwd:'—',log,pending:fs.writeFile(log,message).catch(()=>{})};this.startupRun=run;}await run.pending;let output=run.captureFailed?run.tail?.toString('utf8')||'':await fs.readFile(run.log,'utf8').catch(()=>'');if(!output){output=message;await fs.writeFile(run.log,output).catch(()=>{run!.captureFailed=true;});}const logAvailable=!run.captureFailed&&!!await fs.stat(run.log).catch(()=>undefined);this.current.startupFailure={service:run.service,command:run.command,cwd:run.cwd,exitCode:run.child?.exitCode??null,output:output.replace(/\s+$/,'').split(/\r\n|\r|\n/).slice(-30).join('\n'),reason:startupHint(output+'\n'+message),logAvailable,port:run.port,unitId:run.unitId,owner:run.owner};}this.warn('接入失败：'+String(error).slice(0,500));await this.browser?.close();this.browser=undefined;await this.collectorStop();await this.stopEnvironment();await this.write();throw error;}
  }
  async saveSetupFailure(input:{service:string;command:string;cwd:string;output:string}){const project=this.project,generation=this.generation;if(!project||!input||!['service','command','cwd','output'].every(key=>typeof (input as any)[key]==='string'&&(input as any)[key].length<=100000))throw Error('启动记录无效');const folder=managedPath(path.join(this.data,'startup-errors',project.id)),log=managedPath(path.join(folder,crypto.randomUUID()+'.log'));let logAvailable=true;try{await fs.mkdir(folder,{recursive:true});await fs.writeFile(log,input.output);}catch{logAvailable=false;}if(this.generation!==generation||this.project?.id!==project.id)throw Error('项目已切换');const failure:StartupFailure={...input,exitCode:null,output:input.output.replace(/\s+$/,'').split(/\r\n|\r|\n/).slice(-30).join('\n'),reason:startupHint(input.output),logAvailable};this.setupFailure={projectId:project.id,failure,log};return failure;}
  async startupLog(){const setup=this.setupFailure;if(setup&&setup.projectId===this.project?.id)return setup.log;if(!this.current?.startupFailure||!this.startupRun||path.dirname(this.startupRun.log).toLowerCase()!==this.sessionPath(this.current.id).toLowerCase())throw Error('没有可打开的启动记录');await this.startupRun.pending;return this.startupRun.log;}
  startupFailure(){const setup=this.setupFailure;return setup&&setup.projectId===this.project?.id?setup.failure:this.current?.startupFailure;}
  async suggestPort(){const net=await import('node:net'),server=net.createServer();await new Promise<void>((resolve,reject)=>server.listen(0,'127.0.0.1',resolve).once('error',reject));const port=(server.address() as import('node:net').AddressInfo).port;await new Promise<void>(resolve=>server.close(()=>resolve()));return port;}
  private async portOwner(port:number){if(process.platform!=='win32')return undefined;try{const run=promisify(execFile),{stdout}=await run('netstat.exe',['-ano','-p','tcp'],{windowsHide:true});const line=stdout.split(/\r?\n/).find(row=>{const parts=row.trim().split(/\s+/);return parts.length>=5&&parts[1].endsWith(':'+port)&&parts[3]==='LISTENING';});const pid=Number(line?.trim().split(/\s+/).at(-1));if(!pid)return undefined;const listed=await run('tasklist.exe',['/FI',`PID eq ${pid}`,'/FO','CSV','/NH'],{windowsHide:true}).catch(()=>({stdout:''}));const name=listed.stdout.match(/^"([^"]+)"/)?.[1];return{pid,name};}catch{return undefined;}}
  private async launch(exe:string,args:string[],cwd:string,extra:NodeJS.ProcessEnv,role:string,component?:RuntimeComponent){
    if(this.cancelled)throw Error('接入已取消');
    managedPath(cwd);const env:NodeJS.ProcessEnv={...process.env,...extra,TEMP:path.join(this.data,'temp'),TMP:path.join(this.data,'temp'),TMPDIR:path.join(this.data,'temp'),PYTHONPYCACHEPREFIX:path.join(this.data,'temp/pycache'),XDG_CACHE_HOME:path.join(this.base,'.cache/runtime'),PIP_CACHE_DIR:path.join(this.base,'.cache/pip')};
    // Never inherit a remote exporter, auto-instrumentation hook or global runtime options.
    for(const key of Object.keys(env))if((/^(OTEL_|SPRING_|DB_|AI_|OPENAI_|LANGCHAIN_|LANGSMITH_)/.test(key)||['JAVA_TOOL_OPTIONS','_JAVA_OPTIONS','PYTHONPATH','NODE_OPTIONS'].includes(key))&&!(key in extra))delete env[key];
    for(const key of ['TEMP','TMP','TMPDIR','PYTHONPYCACHEPREFIX','XDG_CACHE_HOME','PIP_CACHE_DIR'])if(env[key])managedPath(env[key]!);
    const record=this.current;const run:StartupRun|undefined=component?{service:component.name||component.role,command:component.displayCommand||[exe,...args].join(' '),cwd,log:managedPath(path.join(this.folder,`startup-${++this.startupNumber}.log`)),pending:Promise.resolve()}:undefined;if(run){this.startupRun=run;await fs.writeFile(run.log,'').catch(()=>{run.captureFailed=true;});}
    const child=spawn(exe,args,{cwd,env,windowsHide:true,stdio:['ignore','pipe','pipe']});if(run)Object.assign(run,{child});
    const log=this.current?.policy==='raw'?managedPath(path.join(this.folder,role+'-stderr.log')):undefined;let logged=0;
    const capture=(chunk:Buffer)=>{if(run&&record?.state==='connecting'){const data=Buffer.from(chunk);run.tail=Buffer.concat([run.tail||Buffer.alloc(0),data]).subarray(-128*1024);if(!run.captureFailed)run.pending=run.pending.then(()=>fs.appendFile(run.log,data)).catch(()=>{run.captureFailed=true;});}};
    child.stdout?.on('data',chunk=>{capture(chunk);if(log&&logged<2*1024*1024){const data=Buffer.from(chunk).subarray(0,2*1024*1024-logged);logged+=data.length;void fs.appendFile(log,data).catch(()=>{});}});
    child.stderr?.on('data',chunk=>{capture(chunk);if(log&&logged<2*1024*1024&&/codeleader|SimpleClientHttp|error|warn|exception|traceback|fail|drop/i.test(String(chunk))){const data=Buffer.from(chunk).subarray(0,2*1024*1024-logged);logged+=data.length;void fs.appendFile(log,data).catch(()=>{});}if(this.current===record&&/error|exception|traceback|fail|drop/i.test(String(chunk)))this.warn(`${role} 采集/启动有错误或丢弃提示`);});
    await new Promise<void>((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});
    if(child.pid)this.current!.processes.push({pid:child.pid,role,startedAt:new Date().toISOString()});
    child.on('exit',()=>{if(this.current===record&&this.current?.state==='recording')this.warn(`${role} 进程已退出，后续内部数据可能缺失`);});if(this.cancelled){child.kill();throw Error('接入已取消');}return child;
  }
  private async startOwned(index:ProjectIndex,endpoint:string,config:RuntimeEnvironment){
    if(config.sourceVersion!==this.current!.sourceVersion)throw Error('请在启动配置中确认当前源码版本');
    for(const file of index.files){const target=managedPath(path.join(config.copy,file.path)),text=await fs.readFile(target,'utf8');if(crypto.createHash('sha256').update(text).digest('hex')!==file.hash)throw Error('开发副本与当前文件不一致');}
    const net=await import('node:net');
    for(const component of config.components){
      managedPath(component.cwd);for(const key of ['CHROMA_DIR','HF_HOME','TIKTOKEN_CACHE_DIR'])if(component.env?.[key])managedPath(component.env[key]);
      if(component.port){const probe=net.createServer();try{await new Promise<void>((resolve,reject)=>probe.listen(component.port!,'127.0.0.1',resolve).once('error',reject));await new Promise<void>(resolve=>probe.close(()=>resolve()));}catch(error){const log=managedPath(path.join(this.folder,`startup-${++this.startupNumber}.log`)),owner=await this.portOwner(component.port),message=`端口 ${component.port} 已被占用（EADDRINUSE）${owner?`：${owner.name||'进程'}（PID ${owner.pid}）`:''}。请修改端口后重试。`;this.startupRun={service:component.name||component.role,command:component.displayCommand||[component.executable,...component.args].join(' '),cwd:component.cwd,port:component.port,unitId:component.unitId,owner,log,pending:fs.writeFile(log,message).catch(()=>{})};throw Error(message,{cause:error});}}
    }
    const common={CODELEADER_SESSION:this.current!.id,CODELEADER_POLICY:this.current!.policy,CODELEADER_OTLP:endpoint,CODELEADER_VERSION:this.current!.sourceVersion};
    for(const component of config.components){
      let args=component.args,extra:NodeJS.ProcessEnv={...component.env};
      if(component.role==='java'&&(component.java||component.javaBootstrap)){
        const java=component.java,agent=['-Djava.io.tmpdir='+path.join(this.data,'temp'),'-Duser.home='+path.join(this.base,'.tools/java-home'),'-javaagent:'+path.join(this.base,'.tools/runtime/opentelemetry-javaagent.jar'),'-Dotel.javaagent.extensions='+path.join(this.base,'runtime/java/target/value-extension-1.0.0.jar'),...(java?.vmArgs||[])];
        if(java){const entry=java.jar?['-jar',managedPath(java.jar)]:['-cp',(java.classPath||[]).map(p=>managedPath(p)).join(path.delimiter),java.mainClass!];args=[...agent,...entry,...(java.args||[])];}
        if(component.javaBootstrap==='maven')args=[...args,'-Dspring-boot.run.jvmArguments='+agent.map(a=>a.includes(' ')?JSON.stringify(a):a).join(' ')];
        if(component.javaBootstrap==='gradle')extra={...extra,JAVA_TOOL_OPTIONS:agent.map(a=>a.includes(' ')?JSON.stringify(a):a).join(' '),GRADLE_USER_HOME:path.join(this.base,'.cache/gradle')};
        extra={...extra,...common,CODELEADER_PLAN:path.join(this.folder,'plan.properties'),OTEL_SERVICE_NAME:component.serviceId||index.name,OTEL_TRACES_EXPORTER:'otlp',OTEL_METRICS_EXPORTER:'none',OTEL_LOGS_EXPORTER:'none',OTEL_EXPORTER_OTLP_ENDPOINT:endpoint,OTEL_EXPORTER_OTLP_PROTOCOL:'http/protobuf',OTEL_TRACES_SAMPLER:'parentbased_always_on',OTEL_BSP_SCHEDULE_DELAY:'250',OTEL_EXPORTER_OTLP_TIMEOUT:'1000',OTEL_PROPAGATORS:'tracecontext',OTEL_INSTRUMENTATION_JDBC_STATEMENT_SANITIZER_ENABLED:'true'};
      }else if(component.role==='python')extra={...extra,...common,CODELEADER_PLAN:path.join(this.folder,'plan.json'),CODELEADER_EXCLUDED_URLS:config.excludedUrls||'',CODELEADER_PYTHON_ROOTS:JSON.stringify(component.pythonRoot?[component.pythonRoot]:[component.cwd]),PYTHONPATH:component.pythonRoot||component.cwd,PYTHONNOUSERSITE:'1'};
      const languages=component.role==='java'?'java':component.role==='python'?'python':undefined;
      const ids=[...new Set(this.current!.plan.points.filter(p=>p.language===languages).map(p=>p.serviceId).filter(Boolean))];if(languages)extra.CODELEADER_SERVICE_ID=component.serviceId||(ids.length===1?ids[0]:undefined);
      if(component.unverifiedArtifact){const file=managedPath(path.join(this.folder,'unverified.properties'));await fs.writeFile(file,'version=unverified\npolicy='+this.current!.policy+'\nowners=\ndtos=');extra.CODELEADER_PLAN=file;extra.CODELEADER_VERSION='unverified';this.warn('还不能确认这个 JAR 对应当前源码，暂不跳到源码');}
      for(const preparation of component.prepare||[]){await this.stage('准备应用');const details={...preparation,name:component.name,displayCommand:[preparation.executable,...preparation.args].join(' ')};const child=await this.launch(preparation.executable,preparation.args,preparation.cwd,{...extra,...preparation.env},'prepare',details);this.owned.push(child);await new Promise<void>((resolve,reject)=>{if(child.exitCode!==null){child.exitCode===0?resolve():reject(Error('准备没完成，请查看启动记录'));return;}child.once('close',code=>code===0?resolve():reject(Error('准备没完成，请查看启动记录')));child.once('error',reject);});if(this.cancelled)throw Error('启动已取消');}
      if(component.prepareReceipt)await fs.writeFile(managedPath(component.prepareReceipt.file),component.prepareReceipt.hash);
      await this.stage('等待应用打开');const child=await this.launch(component.executable,args,component.cwd,extra,component.role,component);this.owned.push(child);if(component.role==='frontend')this.frontendRun=this.startupRun;if(component.mysqlAdmin&&component.port)this.mysql={admin:component.mysqlAdmin,port:component.port,child};
      if(component.port)await this.waitPort(component.port,runtimePolicy.thresholds.startupWaitMs.value,child);
    }
  }
  private async waitPort(port:number,timeout=15000,child?:ChildProcess){const net=await import('node:net'),start=Date.now();while(Date.now()-start<timeout){if(this.cancelled)throw Error('接入已取消');if(child&&child.exitCode!==null){if(child.stdout&&!child.stdout.readableEnded)await new Promise<void>(resolve=>child.once('close',()=>resolve()));throw Error('应用提前退出，请查看启动记录');}const ready=await new Promise<boolean>(resolve=>{const socket=net.createConnection({host:'127.0.0.1',port});socket.on('connect',()=>{socket.destroy();resolve(true);});socket.on('error',()=>resolve(false));socket.setTimeout(300,()=>{socket.destroy();resolve(false);});});if(ready)return;await new Promise(resolve=>setTimeout(resolve,200));}throw Error(`本机开发端口 ${port} 未就绪`);}
  private async waitPage(address:string,child?:ChildProcess){const target=localUrl(address),transport=target.protocol==='https:'?await import('node:https'):await import('node:http'),started=Date.now();while(Date.now()-started<runtimePolicy.thresholds.startupWaitMs.value){if(this.cancelled)throw Error('接入已取消');if(child&&child.exitCode!==null){if(child.stdout&&!child.stdout.readableEnded)await new Promise<void>(resolve=>child.once('close',()=>resolve()));throw Error('应用提前退出，请查看启动记录');}const ready=await new Promise<boolean>(resolve=>{const request=transport.get(target,response=>{response.resume();resolve((response.statusCode||500)<500);});request.on('error',()=>resolve(false));request.setTimeout(1500,()=>request.destroy());});if(ready)return;await new Promise(resolve=>setTimeout(resolve,300));}throw Error('页面等待超时，请查看启动记录');}
  private async poll(){if(this.busy||!this.current)return;this.busy=true;try{
    const file=managedPath(path.join(this.folder,'otlp.jsonl'));let stat;try{stat=await fs.stat(file);}catch{stat={size:this.offset};}
    if(this.current.state==='recording'&&(stat.size>32*1024*1024||Date.now()-Date.parse(this.current.createdAt)>2*60*60*1000)){this.warn('达到会话大小或两小时预算，停止采集；业务继续运行');void this.stop();return;}
    if(stat.size<this.offset){this.warn('导出文件被截断，拒绝将旧记录当作新数据');void this.stop();return;}
    if(stat.size>this.offset){const handle=await fs.open(file,'r');try{const buffer=Buffer.alloc(Math.min(stat.size-this.offset,4*1024*1024)),read=await handle.read(buffer,0,buffer.length,this.offset);this.offset+=read.bytesRead;mergeRecorded(this.current.spans,this.reader!.push(buffer.subarray(0,read.bytesRead)));this.current.bytes=stat.size;this.current.dropped+=this.reader!.dropped-this.importerDrops;this.importerDrops=this.reader!.dropped;this.dirty=true;}finally{await handle.close();}}
    if(this.current.requests.some(r=>r.responseObservedAt!==undefined&&(!r.afterResponse||r.afterResponse.closedAt===undefined))&&updateAfterResponse(this.current,Date.now(),sessionOrderEvidence(this.current).clocks||{}))this.dirty=true;
    if(this.dirty)await this.write();
  }finally{this.busy=false;}}
  private async collectorStop(){const child=this.collector;if(child&&child.exitCode===null){child.kill();await Promise.race([new Promise(resolve=>child.once('exit',resolve)),new Promise(resolve=>setTimeout(resolve,1200))]);}this.collector=undefined;}
  stop(){if(this.stopping)return this.stopping;this.stopping=this.finish();return this.stopping;}
  private async finish(){if(!this.current)return;this.cancelled=true;clearInterval(this.timer);await this.browser?.stop();await new Promise(resolve=>setTimeout(resolve,650));while(this.busy)await new Promise(resolve=>setTimeout(resolve,20));this.current.state='stopped';await this.poll();this.current.stoppedAt=new Date().toISOString();await this.collectorStop();await this.poll();this.current.spans.push(...this.reader?.finish()||[]);await this.write();return this.current;}
  async stopEnvironment(){
    const owned=this.owned,mysql=this.mysql;this.owned=[];this.mysql=undefined;
    if(this.current&&['connecting','recording'].includes(this.current.state))await this.stop();
    if(mysql?.child.exitCode===null){await new Promise<void>(resolve=>{const c=spawn(mysql.admin,['--no-defaults','-h','127.0.0.1','-P',String(mysql.port),'-u','root','shutdown'],{windowsHide:true,stdio:'ignore'});c.once('error',()=>resolve());c.once('exit',()=>resolve());setTimeout(resolve,5000);});}
    for(const child of owned){if(child.exitCode!==null||!child.pid)continue;
      if(process.platform==='win32')await new Promise<void>(resolve=>{const c=spawn('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});c.once('error',()=>resolve());c.once('exit',()=>resolve());});else child.kill();
    }
  }
  async list(){const project=this.project,generation=this.generation;await fs.mkdir(this.sessions(),{recursive:true});const items=[];for(const id of await fs.readdir(this.sessions())){try{const s=JSON.parse(await fs.readFile(path.join(this.sessionPath(id),'session.json'),'utf8'));if(project&&belongsToProject(s,project))items.push({id:s.id,createdAt:s.createdAt,state:s.state,frontendUrl:s.frontendUrl});}catch{}}return generation===this.generation?items.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)):[];}
  private async readSession(id:string){const generation=this.generation,project=this.project;const s=JSON.parse(await fs.readFile(path.join(this.sessionPath(id),'session.json'),'utf8')) as ExecutionSession;if(generation!==this.generation||!project||!belongsToProject(s,project))throw Error('这次录制属于另一个项目');return s;}
  async open(id:string,index?:ProjectIndex){if(!index)throw Error('请先打开项目');const generation=++this.generation;await this.stopping;if(generation!==this.generation)throw Error('项目已切换');this.assertProject(index);if(this.current&&['connecting','recording'].includes(this.current.state))throw Error('请先停止录制再打开历史');const s=await this.readSession(id);await this.browser?.close();if(generation!==this.generation)throw Error('项目已切换');this.browser=undefined;s.historical=true;
    if(s.state==='connecting'||s.state==='recording'){s.state='stopped';s.warnings.push('此录制未正常关闭；现在查看的是已保存历史。');}
    const version=index&&crypto.createHash('sha256').update(index.files.map(f=>`${f.path}:${f.hash}`).sort().join('\n')).digest('hex');
    if(s.projectId!==index?.id||s.sourceVersion!==version){s.warnings.push('运行版本与当前源码不一致，历史值仍可查看，源码映射已停用。');for(const span of s.spans){span.versionMatch=false;span.symbolId=undefined;span.location=undefined;}}
    for(const request of s.requests)for(const item of request.initiator||[])if(!index?.frontendFiles?.some(f=>f.path===item.location?.file&&f.hash===item.sourceHash))item.location=undefined;
    this.current=s;this.folder=this.sessionPath(id);return s;
  }
  async remove(id:string){await this.readSession(id);if(this.current?.id===id&&['connecting','recording'].includes(this.current.state))throw Error('请先停止录制');const target=this.sessionPath(id),resolved=await fs.realpath(target),folder=await fs.realpath(this.sessions());if(!resolved.toLowerCase().startsWith(folder.toLowerCase()+path.sep))throw Error('会话真实路径越出本机会话目录');await fs.rm(target,{recursive:true,force:true});if(this.current?.id===id)this.current=undefined;}
  async close(){if(this.current&&['connecting','recording'].includes(this.current.state))await this.stop();await this.stopEnvironment();await this.browser?.close();await this.persistence;}
  echoAnchor(anchor:Parameters<OperationEcho['setAnchor']>[0]){this.browser?.echoAnchor(anchor);}
  async thumbnail(id:string){if(typeof id!=='string'||id.length>100)return;return readThumbnail(this.folder,this.current?.operations?.find(o=>o.id===id)?.thumbnail);}
  async thumbnails(enabled:boolean){if(typeof enabled!=='boolean'||!this.current||this.current.historical)return;this.current.thumbnailCapture=enabled;await this.write();}
  async backgroundIdle(seconds:number){if(!Number.isFinite(seconds)||!this.current||this.current.historical)return;this.current.backgroundIdleSeconds=idleSeconds(seconds);await this.write();}
  async export(hidden:boolean){if(!this.current)throw Error('没有可导出的会话');const value=structuredClone(this.current),folder=managedPath(path.join(this.data,'execution-exports'));await fs.mkdir(folder,{recursive:true});const file=managedPath(path.join(folder,`${value.id}-${Date.now()}-${hidden?'hidden':'raw'}.json`));await fs.writeFile(file,JSON.stringify(hidden?hideActual(value as unknown as SafeValue):value));return file;}
}
