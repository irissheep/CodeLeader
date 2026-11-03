import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {ExecutionManager} from '../src/main/execution-manager';
import {structure} from '../src/analysis/structure';
import {frameworks} from '../src/analysis/frameworks';
import {projectRules} from '../src/analysis/project-rules';
import {buildPlan} from '../src/runtime/plan';
const base=process.env.CODELEADER_ROOT!,data=path.join(base,'.tmp/verification-cross-project/session-boundaries',crypto.randomUUID());
const result=await structure(path.join(base,'.tmp/verification-cross-project/parcel-project'),path.join(base,'resources'),()=>{});frameworks(result);projectRules(result);
const a=result.index,b={...a,id:'different-path-same-name',root:path.join(data,'other/parcel-project')};
const manager=new ExecutionManager(base,data,()=>{throw Error('No native page expected');},()=>{});
async function history(project:typeof a){const id=crypto.randomUUID(),folder=path.join(data,'executions',id);await fs.mkdir(folder,{recursive:true});const plan=buildPlan({...a,id:project.id,root:project.root},result.texts);await fs.writeFile(path.join(folder,'session.json'),JSON.stringify({id,projectId:project.id,projectRoot:project.root,createdAt:new Date().toISOString(),state:'stopped',sourceVersion:plan.sourceVersion,frontendUrl:'http://127.0.0.1:18463',policy:'raw',plan,spans:[],requests:[],dropped:0,bytes:0,warnings:[],processes:[]}));return id;}
test('会话隔离：历史只属当前项目，旧 open/list 回调和页面边界失效',async()=>{
 const aid=await history(a),bid=await history(b);await manager.activateProject(a);assert.ok((await manager.list()).some(s=>s.id===aid));assert.ok(!(await manager.list()).some(s=>s.id===bid));await assert.rejects(()=>manager.open(bid,a),/另一个项目/);
 const opened=await manager.open(aid,a);assert.equal(opened.projectId,a.id);let closed=0;manager.browser={close:async()=>{closed++;},bounds:()=>{throw Error('Old view reused');}} as any;
 await manager.activateProject(b);assert.equal(closed,1);assert.equal(manager.browser,undefined);assert.equal(manager.current,undefined);manager.bounds({x:1,y:1,width:10,height:10,visible:true});
 const old=manager.open(bid,b);await manager.activateProject(a);await assert.rejects(()=>old,/切换|另一个项目/);assert.equal(manager.current,undefined);
 const list=manager.list();await manager.activateProject(b);assert.deepEqual(await list,[]);
});
test('连接地址和运行偏好按项目存；旧历史值保留而源码版本变化停止映射',async()=>{
 await manager.activateProject(a);assert.deepEqual((await manager.connection()).url,'');await manager.configure({url:'http://127.0.0.1:18463',owned:false});await manager.activateProject(b);assert.equal((await manager.connection()).url,'');await manager.configure({url:'http://127.0.0.1:18464',owned:false});await manager.activateProject(a);assert.equal((await manager.connection()).url,'http://127.0.0.1:18463/');
 const id=await history(a),folder=path.join(data,'executions',id),file=path.join(folder,'session.json'),record=JSON.parse(await fs.readFile(file,'utf8'));record.sourceVersion='older';record.spans=[{versionMatch:true,symbolId:'old',location:{file:'old.java'},input:{title:'unchanged-real-value'},output:{id:7}}];await fs.writeFile(file,JSON.stringify(record));const opened=await manager.open(id,a);assert.equal(opened.spans[0].versionMatch,false);assert.equal(opened.spans[0].symbolId,undefined);assert.deepEqual(opened.spans[0].input,{title:'unchanged-real-value'});assert.ok(await fs.stat(file));await manager.close();
});
test('等待旧停止保存后再切项目，迟到的环境停止不清除后来组件',async()=>{
 const instance=new ExecutionManager(base,path.join(data,'stop-race'),()=>{throw Error('No browser');},()=>{});await instance.activateProject(a);
 let release!:()=>void;const pending=new Promise<void>(resolve=>release=resolve);(instance as any).stopping=pending;instance.current={state:'stopped',projectId:a.id} as any;
 let finished=false;const switching=instance.activateProject(b).then(()=>finished=true);await Promise.resolve();assert.equal(finished,false);assert.equal(instance.current?.projectId,a.id);release();await switching;assert.equal(instance.current,undefined);
 const initial={exitCode:0,pid:101},later={exitCode:0,pid:102};(instance as any).owned=[initial];instance.current={state:'recording'} as any;
 let stop!:()=>void;const stopPending=new Promise<void>(resolve=>stop=resolve);instance.stop=(()=>stopPending) as any;const stopping=instance.stopEnvironment();(instance as any).owned=[later];stop();await stopping;assert.deepEqual((instance as any).owned,[later]);instance.current=undefined;(instance as any).owned=[];
});
