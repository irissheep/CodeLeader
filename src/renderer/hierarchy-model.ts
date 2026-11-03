import type {EntryPoint,Location,ProjectIndex,ViewState} from '../shared/model';
import type {FrontendHttpCall} from '../shared/frontend-model';
import type {GraphCard,GraphLink,GraphResult} from './graph-model';
import type {LayoutSnapshot} from './graph-geometry';
import tokens from '../shared/ui-tokens';
import {entryGroups} from './entry-model';
import {explorationFlow} from './exploration-layout';
const t=tokens.hierarchy;
export interface HierarchyModule {
 id:string;cardId:string;unitId?:string;name:string;fullName:string;prefix:string;group:string;
 entries:EntryPoint[];calls:FrontendHttpCall[];methods:{name:string;count:number}[];count:number;
 frontendCount:number;heatAvailable:boolean;frontUnits:string[];width:number;scale:number;page?:Location;serviceName?:string;
}
export interface HierarchyGroup {name:string;modules:HierarchyModule[];count:number}
export interface ResourceUsage {tables:number;tableNames:string[];places:number;configuredOnly:boolean;summary:string}
const route=(entry:EntryPoint)=>entry.pathEvidence?.path||entry.name.split(' · ')[0].split(' ')[1]||'';
const segments=(path:string)=>path.startsWith('/')?path.split('/').filter(Boolean):[];
export function sharedPrefix(paths:string[]){
 const rows=paths.filter(p=>p.startsWith('/')).map(segments);if(!rows.length)return '';
 let end=0;while(end<rows[0].length&&rows.every(r=>r[end]===rows[0][end]))end++;
 return end?'/'+rows[0].slice(0,end).join('/'):'';
}
export function methodCounts(methods:string[]){return [...new Set(methods)].map(name=>({name,count:methods.filter(m=>m===name).length})).sort((a,b)=>Object.keys(tokens.httpMethod).indexOf(a.name)-Object.keys(tokens.httpMethod).indexOf(b.name)||a.name.localeCompare(b.name));}
export function moduleWidth(count:number){return tokens.moduleWidths.find(t=>count>=t.minimum)!.width;}
export function moduleHeat(count:number){return tokens.moduleHeat.find(t=>count>=t.minimum)!;}
export function moduleTitle(module:HierarchyModule){return module.fullName.includes(module.name)?module.fullName:`${module.fullName} · ${module.name}`;}
export function hierarchyModules(index:ProjectIndex,filter:ViewState['filter']='all',showTests=false){
 const groups=entryGroups(index,filter,showTests).filter(g=>g.entries[0]?.kind==='http');
 const links=index.frontendLinks?.calls||[],linked=links.filter(l=>['matched','path-only'].includes(l.outcome)&&l.targets.length===1),heatAvailable=linked.length>0;
 return groups.map(g=>{
  const entries=g.entries.filter(e=>e.kind==='http'),ids=new Set(entries.map(e=>e.id)),domain=index.entities?.find(d=>d.kind==='domain'&&entries.some(e=>d.entryIds?.includes(e.id)));
  const prefix=sharedPrefix(entries.map(route)),fallback=g.owner.split('.').at(-1)?.replace(/Controller$/,'')||g.name||g.id,fullName=prefix||(g.name==='/'?fallback:g.name.replace(/Controller$/,''))||fallback;
  const related=linked.filter(l=>l.targets.some(t=>ids.has(t.entryId||''))),calls=index.frontend?.httpCalls.filter(c=>related.some(l=>l.callId===c.id))||[];
  const serviceId=domain?.serviceId||index.symbols.find(s=>s.id===entries[0]?.symbolId)?.serviceId,serviceName=index.units?.find(u=>u.serviceId===serviceId&&!!serviceId)?.root||index.entities?.find(e=>e.id===serviceId&&e.kind==='service')?.name;
  const width=prefix?moduleWidth(entries.length):Math.max(moduleWidth(entries.length),Math.min(168,fullName.length*8+24));
  return{id:domain?.id||g.id,cardId:g.id,unitId:related[0]?.targets[0]?.unitId,name:fullName,fullName,prefix,group:segments(prefix)[0]||'',entries,calls,methods:methodCounts(entries.map(e=>e.pathEvidence?.method||e.name.split(' ')[0])),count:entries.length,frontendCount:new Set(related.map(l=>l.callId)).size,heatAvailable,frontUnits:[...new Set(related.flatMap(l=>l.fromUnitId?[l.fromUnitId]:[]))],width,scale:1,serviceName} satisfies HierarchyModule;
 });
}
export function groupModules(modules:HierarchyModule[],byService=false):HierarchyGroup[]{
 const available=modules.some(m=>m.prefix),counts=new Map<string,number>();for(const m of modules)counts.set(m.group,(counts.get(m.group)||0)+1);
 const groups=new Map<string,HierarchyModule[]>();
 for(const m of modules){const key=byService?(m.serviceName||'未归属'):available&&m.group&&counts.get(m.group)!>1?m.group:available?'其他':'';groups.set(key,[...groups.get(key)||[],m]);}
 return [...groups].map(([name,items])=>{
  const common=name&&name!=='其他'&&(!byService||items.length>1)?sharedPrefix(items.map(m=>m.fullName)):'';
  const scale=modules.length<=t.looseModules?t.looseScale:1;
  return{name,modules:items.map(m=>({...m,name:(common?m.fullName.slice(common.length):m.fullName).replace(/^\//,'')||m.entries[0]?.owner.split('.').at(-1)?.replace(/Controller$/,'')||m.fullName,scale})).sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name)),count:items.reduce((n,m)=>n+m.count,0)};
 }).sort((a,b)=>Number(a.name==='其他')-Number(b.name==='其他')||b.count-a.count||a.name.localeCompare(b.name));
}
export function resourceUsage(card:GraphCard,links:GraphLink[]):ResourceUsage{
 const relations=links.filter(l=>l.target===card.id).flatMap(l=>l.relations).filter(r=>r.type==='READS'||r.type==='WRITES');
 const tables=new Set(relations.flatMap(r=>r.data?.table&&!/[${}]/.test(r.data.table)?[r.data.table]:[])),places=new Set(relations.flatMap(r=>r.locations.map(l=>r.type+':'+l.file+':'+JSON.stringify(l.range))));
 const configuredOnly=!places.size;
 return{tables:tables.size,tableNames:[...tables].sort(),places:places.size,configuredOnly,summary:configuredOnly?'只在配置里出现':(tables.size?`${tables.size} 张表 · `:'')+`${places.size} 处读写`};
}
export function moduleGroupHeight(groups:HierarchyGroup[],width:number){
 return groups.reduce((height,group)=>{
  let rows=1,used=0;for(const module of group.modules){const size=module.width*module.scale;if(used&&used+t.blockGap+size>width){rows++;used=0;}used+=(used?t.blockGap:0)+size;}
  return height+(group.name?t.groupHeading:0)+rows*t.blockHeight*(group.modules[0]?.scale||1)+(rows-1)*t.blockGap+t.groupGap;
 },0);
}
export function explorationColumnWidth(count:number,stage?:'interfaces'|'chain',cardWidth?:number){
 const base=applicationWidth(count)-2*t.cardPadding;
 return stage==='chain'&&cardWidth?Math.min(base,Math.max(tokens.continuity.minimumColumnWidth,cardWidth-tokens.continuity.flowColumnReserve)):base;
}
export function applicationWidth(count:number){const width=tokens.applicationWidths.find(w=>count>=w.minimum)!.width;return count>1&&count<=tokens.continuity.compactModuleLimit?Math.min(width,tokens.continuity.compactApplicationWidth):width;}
export function modulePanelTop(groups:HierarchyGroup[],id:string,width:number){
 let y=t.applicationHeader;
 for(const group of groups){
  if(group.name)y+=t.groupHeading;
  let used=0,row=0,found=-1;const height=t.blockHeight*(group.modules[0]?.scale||1);
  for(const module of group.modules){const size=module.width*module.scale;if(used&&used+t.blockGap+size>width){row++;used=0;}used+=(used?t.blockGap:0)+size;if(module.id===id)found=row;}
  if(found>=0)return y+(found+1)*height+(found+1)*t.blockGap;
  y+=(row+1)*height+row*t.blockGap+t.groupGap;
 }
 return y;
}
/** Presentation facts only: never changes the index, matching outcomes or graph membership. */
export function presentHierarchy(graph:GraphResult,index:ProjectIndex,view:ViewState):GraphResult{
 if(!['main','guide'].includes(view.level))return graph;
 const modules=hierarchyModules(index,view.filter,view.showTests),grouped=groupModules(modules,view.level==='guide'),byId=new Map(grouped.flatMap(g=>g.modules.map(m=>[m.id,m] as const)));
 const cards=graph.cards.map(card=>{
  const appearance=card.appearance&&{...card.appearance,scale:1,tiles:false};
  if(view.level==='guide'&&card.kind==='entry-group'){
   const module=grouped.flatMap(g=>g.modules).find(m=>m.cardId===card.id),group=module&&grouped.find(g=>g.modules.some(m=>m.id===module.id));if(module)return{...card,appearance,hierarchy:{module},canvasSize:{width:module.width*module.scale,height:t.blockHeight*module.scale},section:group?.name?`${group.name} ${group.modules.length} 个模块 · ${group.count} 个接口`:undefined};
  }
  if(card.capabilities){
   const modules=card.capabilities.flatMap(c=>byId.has(c.id)?[byId.get(c.id)!]:[]),groups=groupModules(modules),width=view.level==='main'?applicationWidth(modules.length):tokens.applicationWidths.find(w=>modules.length>=w.minimum)!.width;
   const members=graph.cards.filter(c=>c.ownerId===card.id&&c.kind!=='anchor'),baseColumn=explorationColumnWidth(modules.length,card.inline?.stage,width),baseHeight=t.applicationHeader+moduleGroupHeight(groups,baseColumn)+t.applicationFooter+(card.unit?.notice?t.noticeHeight:0);
   const origin=members.length?{x:card.inline?tokens.continuity.compactApplicationWidth+t.cardPadding:t.cardPadding,y:card.inline?tokens.continuity.flowStart:baseHeight}:undefined;
   const flow=origin?explorationFlow(members,graph.links,origin,view.positions,view.positions[card.id]):undefined,outerWidth=Math.max(width,flow?.width||0),column=explorationColumnWidth(modules.length,card.inline?.stage,outerWidth);
   const height=t.applicationHeader+moduleGroupHeight(groups,column)+t.applicationFooter+(card.unit?.notice?t.noticeHeight:0),inline=card.inline&&{...card.inline,top:modulePanelTop(groups,card.inline.domainId,column)};
   return{...card,appearance,inline,hierarchy:{groups},explorationFlowOrigin:origin,canvasSize:{width:outerWidth,height:Math.max(height+(inline?inline.height+t.blockGap:0),flow?.height||0)}};
  }
  if(card.frontend)return{...card,appearance,hierarchy:{frontend:true},canvasSize:{width:t.frontendWidth,height:card.compact===false?t.frontendExpandedHeight:t.frontendHeight+(card.backendChoice?t.addressNoticeHeight:0)}};
  if(card.resource){const usage=resourceUsage(card,graph.links);return{...card,appearance,summary:usage.summary,hierarchy:{resource:usage},canvasSize:{width:t.resourceWidth,height:t.resourceHeight}};}
  if(view.level==='main'&&view.exploration?.stage==='chain'&&card.ownerId&&card.kind!=='anchor')return{...card,appearance,canvasSize:{width:tokens.continuity.flowWidth,height:tokens.continuity.flowHeight}};
  return{...card,appearance};
 });
 return{...graph,cards};
}
export function hierarchyGuidePositions(cards:GraphCard[]){
 const groups=groupModules(cards.flatMap(c=>c.hierarchy?.module?[c.hierarchy.module]:[]),true),positions:Record<string,{x:number;y:number}>={};let y=t.cardPadding+t.groupHeading;
 const width=t.guideColumns*tokens.moduleWidths[0].width+(t.guideColumns-1)*t.blockGap;
 for(const group of groups){let x=t.cardPadding,rowHeight=0;for(const module of group.modules){const w=module.width*module.scale,h=t.blockHeight*module.scale;if(x>t.cardPadding&&x+w>width+t.cardPadding){y+=rowHeight+t.blockGap;x=t.cardPadding;rowHeight=0;}positions[module.cardId]={x,y};x+=w+t.blockGap;rowHeight=Math.max(rowHeight,h);}y+=rowHeight+t.groupHeading+t.groupGap;}
 return positions;
}
export function hierarchyViewport(snapshot:LayoutSnapshot,width:number,height:number){
 const nodes=[...snapshot.nodes,...snapshot.regions],left=Math.min(...nodes.map(n=>n.x)),top=Math.min(...nodes.map(n=>n.y)),w=Math.max(...nodes.map(n=>n.x+n.width))-left,h=Math.max(...nodes.map(n=>n.y+n.height))-top;
 const fit=Math.min((width-2*t.cardPadding)/w,(height-2*t.cardPadding)/h),zoom=Math.min(fit,Math.max(1,width*t.minimumWidthFraction/w),t.maximumZoom);
 return{x:width/2-(left+w/2)*zoom,y:height/2-(top+h/2)*zoom,zoom};
}
export function hierarchyMainPositions(cards:GraphCard[],links:GraphLink[]){
 const positions:Record<string,{x:number;y:number}>={},gap=t.groupGap*2,pad=t.cardPadding,size=(c:GraphCard)=>c.canvasSize||{width:t.resourceWidth,height:t.resourceHeight};
 const fronts=cards.filter(c=>c.frontend),apps=cards.filter(c=>c.hierarchy?.groups?.length),support=cards.filter(c=>c.hierarchy?.groups&&!c.hierarchy.groups.length),externals=cards.filter(c=>c.external);
 const assigned=new Set<string>(),resources=cards.filter(c=>c.resource);
 const strength=(id:string)=>links.filter(l=>l.source===id&&l.type==='HTTP').length-links.filter(l=>l.target===id&&l.type==='HTTP').length;
 apps.sort((a,b)=>strength(b.id)-strength(a.id)||(b.unit?.interfaceCount||0)-(a.unit?.interfaceCount||0)||a.id.localeCompare(b.id));
 const groups=[...apps,...externals].map(app=>{
  const owned=resources.filter(resource=>!assigned.has(resource.id)&&links.some(l=>l.source===app.id&&l.target===resource.id));owned.forEach(r=>assigned.add(r.id));
  const columns=Math.max(1,Math.min(t.columns,owned.length)),rowWidth=owned.length?columns*t.resourceWidth+(columns-1)*t.groupGap:0;
  return{app,owned,columns,width:Math.max(size(app).width,rowWidth),height:size(app).height+(owned.length?gap+Math.ceil(owned.length/columns)*(t.resourceHeight+t.groupGap)-t.groupGap:0)};
 });
 const frontWidth=Math.max(0,...[...fronts,...support].map(c=>size(c).width));let x=pad+(frontWidth?frontWidth+gap:0);
 for(const group of groups){positions[group.app.id]={x:x+(group.width-size(group.app).width)/2,y:pad};group.owned.forEach((resource,i)=>positions[resource.id]={x:x+(group.width-(group.columns*t.resourceWidth+(group.columns-1)*t.groupGap))/2+i%group.columns*(t.resourceWidth+t.groupGap),y:pad+size(group.app).height+gap+Math.floor(i/group.columns)*(t.resourceHeight+t.groupGap)});x+=group.width+gap;}
 let y=pad;for(const front of fronts){positions[front.id]={x:pad+(frontWidth-size(front).width)/2,y};y+=size(front).height+gap;}for(const app of support){positions[app.id]={x:pad+(frontWidth-size(app).width)/2,y};y+=size(app).height+gap;}
 let bottom=Math.max(pad,...cards.filter(c=>positions[c.id]).map(c=>positions[c.id].y+size(c).height))+gap;
 const rest=cards.filter(c=>!positions[c.id]);for(const [i,c]of rest.entries())positions[c.id]={x:pad+i*(size(c).width+gap),y:bottom};
 return positions;
}
