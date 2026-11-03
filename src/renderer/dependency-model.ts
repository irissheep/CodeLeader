import type { ProjectIndex, ViewState,Relation,SymbolInfo } from '../shared/model';
import type { GraphCard,GraphLink } from './graph-model';
import {dependencyFacts,roleInfo,type DependencyUnit} from './dependency-roles';
import {recommendations} from './flow-model';
import policy from '../shared/dependency-policy.json';
import { isTestFile } from './entry-model';
import {frontendDependencyFacts} from './frontend-dependency';
const groupUnits=(units:DependencyUnit[],key:(unit:DependencyUnit)=>string)=>{const result=new Map<string,DependencyUnit[]>();for(const unit of units){const name=key(unit);result.set(name,[...(result.get(name)||[]),unit]);}return result;};
const hiddenTitle=(units:DependencyUnit[])=>{const classes=units.reduce((n,u)=>n+u.classes,0);return `另有 ${classes||units.length} 个${classes?'类':'文件'} · 点开`;};
export function stronglyConnected(ids:string[],edges:{source:string;target:string}[]){
 let sequence=0;const order=new Map<string,number>(),low=new Map<string,number>(),stack:string[]=[],active=new Set<string>(),components:string[][]=[];
 function visit(id:string){order.set(id,sequence);low.set(id,sequence++);stack.push(id);active.add(id);for(const edge of edges.filter(e=>e.source===id)){const to=edge.target;if(!order.has(to)){visit(to);low.set(id,Math.min(low.get(id)!,low.get(to)!));}else if(active.has(to))low.set(id,Math.min(low.get(id)!,order.get(to)!));}if(low.get(id)===order.get(id)){const group:string[]=[];let item:string;do{item=stack.pop()!;active.delete(item);group.push(item);}while(item!==id);components.push(group.sort());}}
 for(const id of ids)if(!order.has(id))visit(id);return components;
}
export function dependencyGraph(index:ProjectIndex,view:ViewState){
 const frontend=view.filter==='frontend'||view.filter==='all'&&!index.files.length&&!!index.frontend?.modules.length;
 const facts=frontend?frontendDependencyFacts(index):dependencyFacts(index),units=facts.units.filter(u=>(frontend||view.filter==='all'||index.files.find(f=>f.path===u.file)?.language===view.filter)&&(view.showTests||!isTestFile(u.file,index))),byId=new Map(units.map(u=>[u.id,u]));
 const symbols=new Map(index.symbols.map(s=>[s.id,s]));
 const owner=(id?:string):string|undefined=>{if(!id)return;if(byId.has(id))return id;const symbol=symbols.get(id);if(symbol){let parent:SymbolInfo|undefined=symbol;while(parent){if(byId.has(parent.id))return parent.id;parent=symbols.get(parent.parent||'');}return units.find(u=>u.file===symbol.file&&!u.symbol)?.id;}const file=id.startsWith('file:')?id.slice(5):undefined;return units.find(u=>u.file===file&&!u.symbol)?.id||units.find(u=>u.file===file)?.id;};
 const edges:{source:string;target:string;type:string;relations:Relation[]}[]=[];
 for(const relation of index.relations){const source=owner(relation.from),target=owner(relation.to);if(source&&target&&['CALLS','IMPORTS','EXTENDS','IMPLEMENTS','INJECTS'].includes(relation.type))edges.push({source,target,type:relation.type,relations:[relation]});}
 for(const item of facts.imports)if(byId.has(item.from)&&byId.has(item.to)&&!edges.some(e=>e.source===item.from&&e.target===item.to&&e.type==='IMPORTS'))edges.push({source:item.from,target:item.to,type:'IMPORTS',relations:[{id:`dependency:import:${item.from}:${item.to}`,from:item.from,to:item.to,target:byId.get(item.to)!.name,type:'IMPORTS',source:frontend?'TypeScript':'tree-sitter',status:'resolved',locations:[item.location],reason:frontend?'文件导入了这个模块':'文件导入了这个类型'}]});
 for(const pair of facts.typeArguments)if(byId.has(pair.from)&&byId.has(pair.to)&&!edges.some(e=>e.source===pair.from&&e.target===pair.to)){
  const from=byId.get(pair.from)!,to=byId.get(pair.to)!;edges.push({source:from.id,target:to.id,type:'IMPORTS',relations:[{id:`dependency:generic:${from.id}:${to.id}`,from:from.id,to:to.id,target:to.name,type:'IMPORTS',source:'tree-sitter',status:'resolved',locations:[from.location],reason:'声明引用了这个数据对象；不是一次方法调用'}]});
 }
 for(const mapping of index.typeMappings||[]){const target=units.find(u=>u.symbol?.qualifiedName===mapping.typeName);if(!target)continue;const id='dependency:xml:'+mapping.location.file;const info=roleInfo('mapping');const unit:DependencyUnit={id,name:mapping.location.file.split('/').at(-1)!,file:mapping.location.file,module:target.module,role:'mapping',basis:'XML 声明了这个 Mapper',layer:info.layer,color:info.color,classes:0,location:mapping.location};units.push(unit);byId.set(id,unit);edges.push({source:target.id,target:id,type:'MAPS',relations:[{id:'dependency:maps:'+id,from:target.id,to:id,target:unit.name,type:'MAPS',status:'resolved',source:'tree-sitter',locations:[mapping.location,target.location],reason:'XML 声明了这个 Mapper；不是一次方法调用'}]});}
 const entry=index.entries?.find(e=>e.id===(view.dependencyEntryId||view.entryId))||recommendations(index).find(r=>r.entry.kind==='http')?.entry;
 const focused=owner(view.focus)||units.find(u=>u.module===view.focus)?.id||owner(entry?.symbolId)||(frontend?frontendDependencyFacts(index).focus:undefined)||units.find(u=>u.role==='controller')?.id||units[0]?.id;
 const scope=view.dependencyScope||(view.fullDependencies||!frontend&&!entry&&!view.focus&&!units.some(u=>u.role==='controller')?'project':'chain'),visible=new Set<string>();
 if(scope==='project')for(const u of units)visible.add(u.id);
 else{
  const seeds=scope==='module'?units.filter(u=>u.module===byId.get(focused||'')?.module).map(u=>u.id):focused?[focused]:[];
  const queue=[...seeds];while(queue.length){const id=queue.shift()!;if(visible.has(id))continue;visible.add(id);const from=byId.get(id)!;for(const e of edges){
   if(e.target===id&&e.type==='IMPLEMENTS'&&byId.get(e.source)?.role==='service')queue.push(e.source);
   if(e.source!==id)continue;const to=byId.get(e.target)!;
   if(to.role==='controller'&&!seeds.includes(to.id))continue;
   if(e.type==='IMPORTS'&&to.layer<from.layer&&!['config','tool'].includes(to.role))continue;
   queue.push(to.id);
  }}
 }
 const selected=units.filter(u=>visible.has(u.id)),representative=new Map<string,string>(),cards:GraphCard[]=[];
 const card=(u:DependencyUnit,parent?:string):GraphCard=>({id:u.id,name:u.name,subtitle:u.file,kind:u.symbol?'type':'module',symbol:u.symbol,tag:roleInfo(u.role).label,summary:!u.classes&&u.role==='other'?'模块文件':roleInfo(u.role).label,count:u.classes,vertical:true,callers:0,callees:0,dependency:{role:u.role,layer:u.layer,color:u.color,classes:u.classes,unitIds:[u.id],location:u.location,basis:u.basis,side:['config','tool'].includes(u.role),parent}});
 const folded=(id:string,name:string,members:DependencyUnit[],side=false)=>{
  const open=view.expanded.includes(id)||members.every(u=>view.expanded.includes(u.id)),count=members.reduce((n,u)=>n+u.classes,0),first=[...members].sort((a,b)=>a.layer-b.layer)[0],counts=[...groupUnits(members,u=>u.role)].flatMap(([role,list])=>{const classes=list.reduce((n,u)=>n+u.classes,0),files=list.filter(u=>!u.classes).length,info=roleInfo(role);return[classes?`${classes} 个${info.plural}`:'',files?`${files} 个${info.fileLabel}`:''].filter(Boolean);}).join(' · ');
  cards.push({id,name,kind:'group',subtitle:members.map(u=>u.file).join('\n'),tag:count?`${count} 个类`:`${members.length} 个文件`,summary:counts,count,members:members.map(u=>u.id),vertical:true,callers:0,callees:0,dependency:{role:side?'tool':first.role,layer:side?5:first.layer,color:side?'common':first.color,classes:count,unitIds:members.map(u=>u.id),basis:counts,folded:!open,side}});
  for(const u of members){representative.set(u.id,open?u.id:id);if(open)cards.push(card(u,id));}
 };
 const common=selected.filter(u=>['config','tool'].includes(u.role));if(common.length)folded('dependency:common','common',common,true);
 const business=selected.filter(u=>!common.includes(u));const pending:DependencyUnit[]=[],cyclic=new Set<string>();
 for(const component of stronglyConnected(business.map(u=>u.id),edges.filter(e=>byId.get(e.source)?.layer===byId.get(e.target)?.layer&&visible.has(e.source)&&visible.has(e.target))))if(component.length>1){const members=component.map(id=>byId.get(id)!);component.forEach(id=>cyclic.add(id));folded('dependency:cycle:'+component.join('|'),'互相引用',members);const group=cards.find(c=>c.id==='dependency:cycle:'+component.join('|'))!;group.cycle=true;group.innerRelations=edges.filter(e=>component.includes(e.source)&&component.includes(e.target)).flatMap(e=>e.relations.map(r=>r.id));}
 for(const [module,members] of groupUnits(business.filter(u=>!cyclic.has(u.id)),u=>u.module)){if(scope==='project'||members.reduce((n,u)=>n+u.classes,0)>policy.thresholds.classesPerPackage.value){folded('dependency:package:'+module,module.split(' · ').at(-1)!.split('.').slice(-2).join('.'),members);}else pending.push(...members);}
 const distance=new Map<string,number>();if(focused){distance.set(focused,0);const queue=[focused];while(queue.length){const id=queue.shift()!;for(const edge of edges){const next=edge.source===id?edge.target:edge.type==='IMPLEMENTS'&&edge.target===id?edge.source:undefined;if(next&&visible.has(next)&&!distance.has(next)){distance.set(next,distance.get(id)!+1);queue.push(next);}}}}
 const ordered=pending.sort((a,b)=>Number(b.id===focused)-Number(a.id===focused)||(distance.get(a.id)||0)-(distance.get(b.id)||0)||a.layer-b.layer||a.name.localeCompare(b.name)),budget=policy.thresholds.visibleClasses.value;
 const anchors=policy.roles.flatMap(role=>{const first=ordered.find(u=>u.role===role.id);return first?[first]:[];});
 const candidates=[...new Set([...(focused?ordered.filter(u=>u.id===focused):[]),...anchors,...ordered])];
 const fixedCards=cards.filter(c=>!c.dependency?.parent).length;
 const shown=ordered.length+fixedCards>budget?candidates.slice(0,Math.max(1,budget-fixedCards-1)):ordered,hidden=ordered.filter(u=>!shown.includes(u));
 for(const u of shown){cards.push(card(u));representative.set(u.id,u.id);}if(hidden.length)folded('dependency:more',hiddenTitle(hidden),hidden);
 {
  const prefix=scope==='project'?'dependency:packages:more:':'dependency:groups:more:',batches=view.expanded.filter(id=>id.startsWith(prefix)).length,limit=budget*(batches+1),top=cards.filter(c=>!c.dependency?.parent);
  if(top.length>limit){const ordered=[...top].sort((a,b)=>Number(!!b.dependency?.unitIds.includes(focused||''))-Number(!!a.dependency?.unitIds.includes(focused||''))||(a.dependency?.layer||0)-(b.dependency?.layer||0)||a.name.localeCompare(b.name)),keep=new Set(ordered.slice(0,limit-1).map(c=>c.id));for(const card of cards)if(card.dependency?.parent&&keep.has(card.dependency.parent))keep.add(card.id);const hiddenUnits=selected.filter(u=>!keep.has(representative.get(u.id)||''));for(let i=cards.length-1;i>=0;i--)if(!keep.has(cards[i].id))cards.splice(i,1);folded(prefix+batches,hiddenTitle(hiddenUnits),hiddenUnits);}
 }
 const labels:Record<string,string>={CALLS:'调用',IMPORTS:'引用',EXTENDS:'继承',IMPLEMENTS:'实现',INJECTS:'使用',MAPS:'对应'},priority=['CALLS','INJECTS','IMPORTS'];
 const grouped=new Map<string,GraphLink>();for(const edge of edges){const source=representative.get(edge.source),target=representative.get(edge.target);if(!source||!target)continue;if(source===target){const card=cards.find(c=>c.id===source)!;card.innerRelations=[...new Set([...(card.innerRelations||[]),...edge.relations.map(r=>r.id)])];continue;}const filter=view.relationFilter||'all';if(filter==='calls'&&edge.type!=='CALLS'||filter==='types'&&!['EXTENDS','IMPLEMENTS','MAPS'].includes(edge.type)||filter==='imports'&&edge.type!=='IMPORTS')continue;const family=filter==='all'&&priority.includes(edge.type)?'uses':edge.type,id=`dependency:${source}|${target}|${family}`;let link=grouped.get(id);if(!link){link={id,source,target,type:edge.type,kinds:[edge.type],label:labels[edge.type],status:edge.relations[0]?.status||'resolved',relations:[]};grouped.set(id,link);}if(!link.kinds!.includes(edge.type))link.kinds!.push(edge.type);if(family==='uses'){link.kinds!.sort((a,b)=>priority.indexOf(a)-priority.indexOf(b));link.type=link.kinds![0];link.label=link.kinds!.map(type=>labels[type]).join(' / ');}for(const r of edge.relations)if(!link.relations.some(v=>v.id===r.id)){link.relations.push(r);if(link.status!==r.status)link.status='mixed';}}
 const dependencyRelations=edges.filter(e=>visible.has(e.source)&&visible.has(e.target)).flatMap(e=>e.relations);
 return{cards,links:[...grouped.values()],omitted:new Set(cards.filter(c=>c.dependency?.folded).flatMap(c=>c.dependency!.unitIds)).size,dependencyRelations,dependencyUnitIds:[...visible],dependencyScope:scope};
}
