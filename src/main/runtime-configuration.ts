import fs from 'node:fs/promises';
import path from 'node:path';
import {managedPath} from '../../scripts/managed-path.mjs';
import type {ProjectIndex} from '../shared/model';
import {projectPath} from '../shared/project-scope';
export interface RuntimeComponent {role:string;executable:string;args:string[];cwd:string;name?:string;displayCommand?:string;port?:number;env?:Record<string,string>;java?:{jar?:string;mainClass?:string;classPath?:string[];vmArgs?:string[];args?:string[]};unverifiedArtifact?:boolean;javaBootstrap?:'maven'|'gradle';prepare?:RuntimeComponent[];prepareReceipt?:{file:string;hash:string};pythonRoot?:string;unitId?:string;serviceId?:string;mysqlAdmin?:string}
export interface RuntimeEnvironment {projectRoot:string;sourceVersion?:string;copy:string;components:RuntimeComponent[];excludedUrls?:string}
export async function runtimeEnvironment(base:string,index:ProjectIndex):Promise<RuntimeEnvironment>{
  const file=managedPath(path.join(base,'.tools/runtime/environments',index.id,'environment.json'));
  let config:any;try{config=JSON.parse(await fs.readFile(file,'utf8'));}catch{throw Error('当前项目还没有启动配置。可先填写已启动页面的地址，或按连接说明配置。');}
  if(projectPath(config.projectRoot||'')!==projectPath(index.root))throw Error('启动配置属于另一个项目');
  if(config.version===2){
    if(!Array.isArray(config.components)||!config.components.length)throw Error('启动配置没有组件');
    const copy=managedPath(config.copy);
    const components:RuntimeComponent[]=config.components.map((c:any)=>{
      if(!c||!['java','python','frontend','database','cache','other'].includes(c.role)||typeof c.executable!=='string'||!Array.isArray(c.args)||!c.args.every((a:unknown)=>typeof a==='string')||!c.cwd)throw Error('启动组件配置不完整');
      managedPath(c.cwd);if(c.port!==undefined&&(!Number.isInteger(c.port)||c.port<1||c.port>65535))throw Error('端口无效');
      if(c.java){if(c.role!=='java'||!c.java.jar&&!(c.java.mainClass&&Array.isArray(c.java.classPath)))throw Error('请配置 Java 文件或启动类');if(c.java.jar)managedPath(c.java.jar);for(const item of c.java.classPath||[])managedPath(item);}
      for(const [key,value] of Object.entries(c.env||{}))if(typeof value!=='string'||!/^\w+$/.test(key))throw Error('组件环境参数无效');
      return c;
    });return {projectRoot:config.projectRoot,sourceVersion:config.sourceVersion,copy,components};
  }
  throw Error('旧启动配置没有逐应用启动方式，请在“启动方式”中查看并确认');
}
