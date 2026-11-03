import test from 'node:test';
import assert from 'node:assert/strict';
import type {ProjectIndex,ViewState} from '../src/shared/model';
import {analyzeFrontend} from '../src/analysis/frontend';
import {dependencyGraph} from '../src/renderer/dependency-model';

function analyze(files:Record<string,string>,configs:Record<string,string>={}){
 const index:ProjectIndex={schema:2,id:'fixture',root:'D:/fixture/virtual',name:'fixture',createdAt:'',status:'structure',languages:[],symbols:[],relations:[],files:[],diagnostics:[],versions:{},sourceRoots:[],jars:[],units:[{id:'frontend-unit',root:'.',kind:'frontend',language:'javascript',framework:'Vue',buildIds:[],usedBy:[],basis:[]}]};
 analyzeFrontend(index,new Map(Object.entries(files)),new Map(Object.entries(configs)));return index;
}
const view:ViewState={level:'overview',filter:'all',expanded:[],positions:{},viewport:{x:0,y:0,zoom:1},query:''};
test('Vue lazy nested routes, aliases, SFC script setup, wrapper proof, environment/proxy sources and import dependencies',()=>{
 const index=analyze({
  'src/router.ts':`import {createRouter} from 'vue-router';createRouter({routes:[{path:'/shell',component:()=>import('./Shell.vue'),children:[{path:'items/:id',alias:'other/:id',component:()=>import('./List.vue')}]}]});`,
  'src/Shell.vue':'<template><router-view/></template>',
  'src/List.vue':`<template><h1>☀</h1><button @click="load">read</button></template>\n<script setup lang="ts">\nimport {read} from './api';\nconst load=()=>read('abc');\n</script>`,
  'src/api.ts':`import axios from 'axios';const http=axios.create({baseURL:import.meta.env.VITE_SERVER});const send=(config:any)=>http.request(config);export function read(id:string){return send({url:\`/items/\${id}\`,method:'GET'})}`,
  'src/app.scss':'body {color:blue}',
  'vite.config.ts':`export default {server:{proxy:{'/api':{target:'http://127.0.0.1'}}}};`
 },{'.env.development':'VITE_SERVER=/api','vite.config.ts':`export default {server:{proxy:{'/api':{target:'http://127.0.0.1'}}}};`});
 const model=index.frontend!;assert.equal(model.pages.length,1);assert.deepEqual(model.pages[0].paths,['/shell/items/:id','/shell/other/:id']);assert.equal(model.httpCalls.length,1);assert.equal(model.httpCalls[0].url,'/items/{id}');assert.equal(model.transports.length,1);assert.equal(model.httpCalls[0].baseURLs[0].location.file,'.env.development');assert.equal(model.httpCalls[0].pageIds.length,1);assert.equal(model.scanned.styles,1);assert(!model.modules.some(m=>m.file.endsWith('.scss')));
 assert.equal(model.proxies[0].prefix,'/api');assert.equal(model.proxies[0].target.value,'http://127.0.0.1');
 assert(model.transports.some(t=>t.id===model.httpCalls[0].transportId));
 assert.equal(model.modules.find(m=>m.file==='src/List.vue')!.role,'page');assert(model.calls.length);assert(model.imports.some(i=>i.to==='file:src/api.ts'));assert.equal(model.httpCalls[0].addressStatus,'parameterized');
});
test('React JSX route aliases are one page; object routes retain nested leaf paths and JSX components',()=>{
 const index=analyze({'src/App.tsx':`import {Route,createBrowserRouter} from 'react-router-dom';import Page from './Page';const a=<Route path={['/','/home']} component={Page}/>;createBrowserRouter([{path:'/section',children:[{path:'item',element:<Page/>}]}]);`, 'src/Page.tsx':`export default function Page(){return <main/>}`});
 assert.equal(index.frontend!.pages.length,2);assert.deepEqual(index.frontend!.pages[0].paths,['/','/home']);assert.deepEqual(index.frontend!.pages[1].paths,['/section/item']);
});
test('known axios aliases/config and HTML fetch retain dynamic and server template addresses without evaluating either',()=>{
 const index=analyze({'index.html':`<script>let since=0;setTimeout(()=>since=1,1);fetch('{{ url_for('home') }}?since='+since);fetch('/save',{method:'POST'});function later(url){fetch(url)}</script>`,'client.ts':`import a from 'axios';const client=a.create({baseURL:'/api'});client.get('/fixed');a({url:'/item',method:'PATCH'});function fetch(url:string){};fetch('/not-http');`});
 assert.equal(index.frontend!.httpCalls.length,4);assert.equal(index.frontend!.httpCalls.filter(c=>c.addressStatus==='unknown').length,1);assert(index.frontend!.transports.some(c=>c.functionName==='later'));assert(index.frontend!.httpCalls.some(c=>c.method==='PATCH'));assert(!index.frontend!.httpCalls.some(c=>c.url==='/not-http'));assert.equal(index.frontend!.diagnostics.length,0);assert(index.frontend!.httpCalls.find(c=>c.url.includes('since'))!.url.endsWith('{since}'));
});
test('generated client factory is followed to HTTP; a lookalike with an unused axios builder does not count',()=>{
 const index=analyze({'client.ts':`import axios from 'axios';export function createClient(){const i=axios.create({baseURL:'/api'});const request=(options:any)=>i(options);return {get:(options:any)=>request({...options,method:'GET'}),post:(options:any)=>request({...options,method:'POST'})}};export const client=createClient();export function fake(){const unused=axios.create();return{get:()=>1,post:()=>2}};`,'sdk.ts':`import {client,fake} from './client';export const save=()=>client.post({url:'/items'});const f=fake();f.post({url:'/not-http'});`});
 assert.equal(index.frontend!.httpCalls.length,1);assert.equal(index.frontend!.httpCalls[0].url,'/items');assert(index.frontend!.transports.length>=1);
});
test('Vue global client injection has source evidence and uncertain URL is retained',()=>{
 const index=analyze({'main.ts':`import {createApp} from 'vue';import axios from 'axios';const app=createApp({});app.config.globalProperties.$api=axios;`,'Login.vue':`<script>export default {methods:{save(){this.$api.post(this.host+'/login',{})}}}</script>`});assert.equal(index.frontend!.httpCalls.length,1);assert.equal(index.frontend!.httpCalls[0].addressStatus,'unknown');
});
test('test-client defaults do not leak into production; per-call baseURL takes precedence',()=>{
 const index=analyze({'client.ts':`import axios from 'axios';function createClient(){const i=axios.create({baseURL:'/default'});return{get:(url,config)=>i.get(url,config),post:(url,body)=>i.post(url,body),setConfig:(config)=>Object.assign(i.defaults,config)}};export const client=createClient();`,'main.ts':`import {client} from './client';client.setConfig({baseURL:'/app'});client.get('/one',{baseURL:'/override'});client.get('/two');`,'tests/setup.ts':`import {client} from '../client';client.setConfig({baseURL:'/test'});client.get('/test-only');`});
 const calls=index.frontend!.httpCalls;assert.equal(calls.filter(c=>!c.test).length,2);assert.deepEqual(calls.find(c=>c.url==='/one')!.baseURLs.map(v=>v.value),['/override']);assert.deepEqual(calls.find(c=>c.url==='/two')!.baseURLs.map(v=>v.value),['/app']);assert(calls.find(c=>c.url==='/test-only')!.test);
});
test('frontend dependency layers use file identity and fold rather than dropping imports',()=>{
 const index=analyze({'router.ts':`import {createRouter} from 'vue-router';import Page from './Page';createRouter({routes:[{path:'/',component:Page}]});`,'Page.tsx':`import {load} from './api';import type {Item} from './types';export default function Page(){load();return <main/>}`,'api.ts':`import axios from 'axios';export const load=()=>axios.get('/items');`,'types.ts':'export interface Item {id:string}'});
 const graph=dependencyGraph(index,view);assert(graph.cards.length>=2);assert(graph.links.length);assert(graph.cards.find(c=>c.id==='file:Page.tsx')!.dependency!.layer<graph.cards.find(c=>c.id==='file:api.ts')!.dependency!.layer);
 assert(graph.cards.some(c=>c.id==='file:types.ts'));
 assert.deepEqual(dependencyGraph(index,{...view,expanded:['unrelated']}).cards.map(c=>c.id),graph.cards.map(c=>c.id));
 assert.equal(index.symbols.length,0);assert.equal(index.relations.length,0);assert.equal(index.entries,undefined);
});
test('Pinia creation is a state role; relative aliases are read from configuration only',()=>{
 const index=analyze({'src/Page.tsx':`import {useCounter} from '@/state';export default function Page(){useCounter();return <main/>}`,'src/state.ts':`import {defineStore} from 'pinia';export const useCounter=defineStore('counter',()=>({}));`},{'tsconfig.json':'{"compilerOptions":{"baseUrl":".","paths":{"@/*":["src/*"]}}}'});
 assert.equal(index.frontend!.modules.find(m=>m.file==='src/state.ts')!.role,'store');assert(index.frontend!.imports.some(i=>i.to==='file:src/state.ts'));
});
test('global properties use Vue identity, imported constants, defaults and per-unit scope',()=>{
 const index=analyze({'config.ts':`export const host='https://example.test';export const prefix=host+'/v2';`,
  'boot.ts':`import Vue from 'vue';import axios from 'axios';import {prefix} from './config';Vue.prototype.$origin=prefix;Vue.prototype.$wire=axios;axios.defaults.baseURL=prefix;`,
  'Page.vue':`<script>export default {methods:{save(){this.$wire.post(this.$origin+'/records',{})}}}</script>`});
 const call=index.frontend!.httpCalls[0];assert.equal(call.url,'https://example.test/v2/records');assert.equal(call.addressStatus,'known');assert.equal(call.baseURLs[0].value,'https://example.test/v2');
});
test('renamed inherited generic kernels bind object rest and forward a fetch tuple',()=>{
 const index=analyze({'sdk.ts':`class Wire {origin='https://example.test/v2';io=(...tuple:Parameters<typeof fetch>)=>fetch(...tuple);mix(a:any,b:any){return {...a,...b}};emit=async<T>({route,...rest}:any)=>this.io(\`\${this.origin}\${route}\`,{...this.mix(rest,{})});}export class Catalog extends Wire{save=(payload:any,options:any={})=>this.emit<{id:string}>({route:'/records',method:'POST',body:payload,...options});remove=(id:string)=>this.emit<void>({route:\`/records/\${id}\`,method:'DELETE'});}`} );
 assert.equal(index.frontend!.httpCalls.length,2);assert.deepEqual(index.frontend!.httpCalls.map(c=>[c.method,c.url]),[['POST','/records'],['DELETE','/records/{id}']]);assert(index.frontend!.transports.length>=2);assert(index.frontend!.transports.every(c=>c.method==='UNKNOWN'));assert(index.frontend!.httpCalls.every(c=>c.baseURLs[0].value==='https://example.test/v2'));
});
test('unknown fetch options do not become GET; an injected function needs a transport body',()=>{
 const index=analyze({'client.ts':`declare const options:any;fetch('/uncertain',options);fetch('/uncertain-method',{method:options.method});const forward=(target:string,init:any,io=fetch)=>io(target,init);forward('/sent',{method:'PATCH'});const fake=(route:string)=>route;fake('/not-network');`});
 assert.deepEqual(index.frontend!.httpCalls.map(c=>[c.method,c.url]),[['UNKNOWN','/uncertain'],['UNKNOWN','/uncertain-method'],['PATCH','/sent']]);assert(!index.frontend!.httpCalls.some(c=>c.url==='/not-network'));
});
test('XMLHttpRequest needs a send on the same instance and does not assume GET',()=>{
 const index=analyze({'io.ts':`const emit=(verb:string,route:string)=>{const channel=new XMLHttpRequest();channel.open(verb,route);channel.send();};emit('PUT','/records');const unused=new XMLHttpRequest();unused.open('GET','/not-sent');`});assert.deepEqual(index.frontend!.httpCalls.map(c=>[c.method,c.url]),[['PUT','/records']]);assert(index.frontend!.transports.length);
});
test('Vue plugin constructor parameters are followed from installation, never by parameter names',()=>{
 const index=analyze({'plugin.ts':`import axios from 'axios';export default{install(Framework:any){Framework.prototype.$wire=axios;Framework.prototype.$origin='https://example.test/v2'}}`,'main.ts':`import Vue from 'vue';import plugin from './plugin';Vue.use(plugin);`,'Page.vue':`<script>export default{methods:{read(){this.$wire.get(this.$origin+'/records')}}}</script>`});assert.equal(index.frontend!.httpCalls.length,1);assert.equal(index.frontend!.httpCalls[0].addressStatus,'known');assert.equal(index.frontend!.httpCalls[0].url,'https://example.test/v2/records');
});
