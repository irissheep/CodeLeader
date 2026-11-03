import {test} from 'node:test';
import assert from 'node:assert/strict';
import {collectAnalysisNotes} from '../src/main/analysis-notes';
import {webNotesText} from '../src/shared/analysis-notes';
import type {ProjectIndex,ProjectUnit,Location} from '../src/shared/model';
const loc=(file:string,line=0):Location=>({file,range:{start:{line,character:0},end:{line,character:1}}});
const unit=(root:string,framework:string):ProjectUnit=>({id:root||'root',root,framework,kind:framework==='Vue'?'frontend':'application',language:framework==='Vue'?'javascript':'python',buildIds:[],usedBy:[],basis:[{source:'entry',location:loc(root+'/entry.py'),note:'应用入口'}]});
function model(units:ProjectUnit[],texts:Record<string,string>,extra:Partial<ProjectIndex>={}):ProjectIndex{return {schema:2,id:'sample',name:'sample',root:'D:/review',createdAt:'frozen',languages:[],sourceRoots:[],jars:[],status:'partial',versions:{},symbols:[],relations:[],diagnostics:[],units,files:Object.keys(texts).map(path=>({path,hash:'',size:1,language:'python',module:''})),...extra};}
test('zero-interface explanation stays within its own application and copies actual scope',async()=>{
 const texts={'one/urls.py':'from django.conf.urls import url\nurlpatterns=[url("^", view)]','one/views.py':'class View: pass','two/urls.py':'urlpatterns=[]'};
 const m=model([unit('one','Django'),unit('two','Django')],texts,{entries:[{id:'endpoint',kind:'http',name:'ok',location:loc('two/urls.py'),language:'python',method:'GET',path:'/ok'} as any]});
 const notes=await collectAnalysisNotes(m,async f=>texts[f as keyof typeof texts]);
 assert.equal(notes.web.length,1);assert.deepEqual(notes.web[0].files,['one/urls.py','one/views.py']);assert.match(webNotesText(notes.web[0]),/one\/urls.py:2/);assert.ok(!webNotesText(notes.web[0]).includes('two/'));
});
test('missing files are distinguished from an absent route',async()=>{
 const notes=await collectAnalysisNotes(model([unit('app','Django')],{'app/views.py':''}),async()=>undefined);
 assert.deepEqual(notes.unreadFiles,['app/views.py']);assert.match(notes.web[0].reasons[0].text,/没能读取/);
});
async function frontend(text:string,expression:string,line:number,settings:Record<string,string>={}){
 const file='ui/api.ts',texts:Record<string,string>={[file]:text,...settings},m=model([unit('ui','Vue')],texts,{frontend:{modules:[{id:'api',file,unitId:'ui'}],httpCalls:[{id:'call',method:'GET',url:'{value}',addressStatus:'unknown',expression,location:loc(file,line),methodLocation:loc(file,line),moduleId:'api',baseURLs:[]}],imports:[]} as any});
 return (await collectAnalysisNotes(m,async f=>texts[f])).addresses[0].calls[0].variables;
}
test('a variable in another function is not evidence for the current call',async()=>{
 const variables=await frontend('function unrelated(){ const endpoint="/x"; }\nfunction current(){ fetch(endpoint); }','`${endpoint}`',1);
 assert.equal(variables[0].state,'missing');assert.deepEqual(variables[0].evidence,[]);
});
test('a rest parameter is an actual runtime source, not a missing assignment',async()=>{
 const variables=await frontend('const client=(...args: unknown[]) =>\n fetch(...args);','...args',1);
 assert.equal(variables[0].name,'args');assert.equal(variables[0].state,'unresolved');assert.equal(variables[0].evidence[0].location.range.start.line,0);
});
test('a plain address variable reports its declaration without evaluating its value',async()=>{
 const variables=await frontend('const endpoint=runtimeValue();\nfetch(endpoint);','endpoint',1);
 assert.equal(variables[0].name,'endpoint');assert.equal(variables[0].state,'unresolved');assert.equal(variables[0].evidence[0].location.range.start.line,0);
});
test('environment assignment must be in the frontend unit and a declaration alone is not a value',async()=>{
 const text='interface ImportMetaEnv { API_ENDPOINT:string }\nfetch(import.meta.env.API_ENDPOINT);',expression='import.meta.env.API_ENDPOINT';
 const absent=await frontend(text,expression,1,{'other/.env':'API_ENDPOINT=http://elsewhere'});assert.equal(absent[0].state,'missing');
 const assigned=await frontend(text,expression,1,{'ui/.env.example':'API_ENDPOINT=${RUNTIME_HOST}'});assert.equal(assigned[0].state,'unresolved');assert.equal(assigned[0].evidence[0].location.file,'ui/.env.example');
 const configured=await frontend(text,expression,1,{'ui/vite.config.ts':'export default {define:{"import.meta.env.API_ENDPOINT":runtimeValue()}}'});assert.equal(configured[0].state,'unresolved');assert.equal(configured[0].evidence[0].location.file,'ui/vite.config.ts');
});
test('server-rendered calls use the existing application and a known later address is not falsely reported',async()=>{
 const file='server/page.html',texts={[file]:'<script>fetch(endpoint)</script>'},m=model([unit('server','Flask')],texts,{frontend:{modules:[{id:'page',file}],httpCalls:[{id:'call',method:'GET',url:'{value}',addressStatus:'unknown',expression:'endpoint',location:loc(file),moduleId:'page',baseURLs:[]}],imports:[]},frontendLinks:{calls:[{callId:'call',reason:'external-backend',addresses:[{known:false}]}]}} as any);
 const unknown=await collectAnalysisNotes(m,async()=>texts[file]);assert.equal(unknown.addresses[0].unitId,'server');
 m.frontendLinks!.calls[0].addresses[0].known=true;assert.equal((await collectAnalysisNotes(m,async()=>texts[file])).addresses.length,0);
});
test('partial reasons are grouped from actual messages, never invented type counts',async()=>{
 const m=model([],{'module.py':'from missing import item'},{diagnostics:[{file:'module.py',severity:'warning',message:'Import "missing" could not be resolved'},{file:'module.py',severity:'warning',message:'Import "other" could not be resolved'}]});
 const notes=await collectAnalysisNotes(m,async()=> 'from missing import item');assert.equal(notes.partial.length,1);assert.equal(notes.partial[0].count,2);assert.equal(notes.partial[0].id,'dependency');assert.equal(notes.partial[0].evidence.length,1);
});
