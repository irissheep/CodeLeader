import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {guard,root,run} from './common.mjs';
import {measureRuntime} from './runtime-http.mjs';
guard();const out=root+'/.tmp/verification-runtime-flow',fixture=JSON.parse(fs.readFileSync(out+'/real-ask.json','utf8'));
const config=JSON.parse(fs.readFileSync(root+'/.tools/runtime/environments/'+fixture.scope.projectId+'/environment.json','utf8'));
const children=[];
const env={...process.env,TEMP:root+'/.tmp',TMP:root+'/.tmp',TMPDIR:root+'/.tmp',XDG_CACHE_HOME:root+'/.cache/runtime',PYTHONPYCACHEPREFIX:root+'/.cache/python'};
for(const name of Object.keys(env))if(/^(OTEL_|SPRING_|DB_|AI_|OPENAI_|LANGCHAIN_|LANGSMITH_)/.test(name)||['JAVA_TOOL_OPTIONS','PYTHONPATH','NODE_OPTIONS'].includes(name))delete env[name];
const launch=(exe,args,cwd,extra={})=>{const c=spawn(exe,args,{cwd,env:{...env,...extra},stdio:'ignore',windowsHide:true});children.push(c);return c;};
async function ready(url){for(let i=0;i<160;i++){try{if((await fetch(url)).ok)return;}catch{}await new Promise(r=>setTimeout(r,250));}throw Error('Baseline service not ready');}
try{
  launch(config.mysql.exe,config.mysql.args,config.copy);await new Promise(r=>setTimeout(r,1500));
  launch(config.java,['-Djava.io.tmpdir='+root+'/.tmp','-Duser.home='+root+'/.tools/java-home','-jar',config.javaJar],config.copy+'/backend',config.javaEnv);
  launch(config.python,['-m','uvicorn',config.pythonApp,'--host','127.0.0.1','--port',String(config.pythonPort),'--no-access-log','--log-level','warning'],config.copy+'/'+config.pythonCwd,{...config.pythonEnv,PYTHONPATH:config.copy+'/'+config.pythonCwd});
  await Promise.all([ready(config.backendUrl+'/api/health'),ready('http://127.0.0.1:'+config.pythonPort+'/health')]);
  const userId=fixture.spans.find(s=>s.name==='AiGateway.ask').input.userId;
  const baseline=await measureRuntime(config,fixture.username,fixture.request.input.question,userId);
  const instrumented=JSON.parse(fs.readFileSync(out+'/instrumented-measurement.json','utf8'));
  if(new Set([...baseline.results,...instrumented.results].map(r=>r.answerHash)).size!==1)throw Error('Business response changed with recording');
  const result={passed:true,baseline,instrumented,medianDifferenceMs:instrumented.medianMs-baseline.medianMs,ratio:instrumented.medianMs/baseline.medianMs,limitations:'Local sample with JIT/cache variation; this is measured overhead, not a zero-impact claim.'};
  fs.writeFileSync(out+'/behavior-comparison.json',JSON.stringify(result,null,2));console.log(JSON.stringify({passed:true,baselineMedianMs:baseline.medianMs,instrumentedMedianMs:instrumented.medianMs}));
}finally{
  await run(config.mysql.client.replace(/mysql\.exe$/,'mysqladmin.exe'),['--no-defaults','-h','127.0.0.1','-P',String(config.mysql.port),'-u','root','shutdown']).catch(()=>{});
  for(const child of children)if(child.pid&&child.exitCode===null)await run('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{stdio:'ignore'}).catch(()=>{});
}
