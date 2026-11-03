import type { ProjectIndex, ViewState } from '../shared/model';
import { graphFor } from './graph-model';

export default function RelationReader({index,view,onChange}:{index:ProjectIndex;view:ViewState;onChange:(v:Partial<ViewState>)=>void}){
 const graph=graphFor(index,{...view,reading:view.reading?.scope?{scope:view.reading.scope}:undefined});
 const name=(id:string)=>graph.cards.find(c=>c.id===id)?.name||index.entities?.find(e=>e.id===id)?.name||id;
 const selected=graph.links.find(l=>l.id===view.relationSelection),reading=view.reading;
 const origin=index.entries?.find(e=>e.id===view.entryId)?.symbolId||view.focus;
 const viewportWidth=()=>reading?.viewportWidth||document.querySelector('.graph-canvas')?.getBoundingClientRect().width;
 const update=(patch:NonNullable<ViewState['reading']>)=>onChange({reading:{...reading,viewport:reading?.viewport||view.viewport,viewportWidth:viewportWidth(),...patch}});
 const targets=[...new Set(graph.links.map(l=>l.target))],types=[...new Set(graph.links.map(l=>l.type))];
 const labels:Record<string,string>={HTTP:'HTTP 通信',DATA:'数据访问',CALLS:'方法调用',READS:'读取',WRITES:'写入',IMPORTS:'模块依赖',EXTENDS:'继承',IMPLEMENTS:'实现',MAPS:'对应'};
 const listed=graph.links.filter(l=>(!reading?.types?.length||reading.types.includes(l.type))&&(!reading?.target||l.target===reading.target));
 const scoped=view.selected&&graph.cards.some(c=>c.id===view.selected)?listed.filter(l=>l.source===view.selected||l.target===view.selected):listed;
 return <><h2>关系选择</h2><div className="relationship-filters">
  {types.map(type=><label key={type}><input type="checkbox" checked={!reading?.types?.length||reading.types.includes(type)} onChange={e=>{const current=reading?.types||types;const next=e.target.checked?[...current,type]:current.filter(t=>t!==type);update({types:next.length?next:['none']});}}/>{labels[type]||type}</label>)}
  <label>目标<select aria-label="关系目标" value={reading?.target||''} onChange={e=>update({target:e.target.value||undefined,isolate:undefined})}><option value="">全部服务 / 资源</option>{targets.map(id=><option key={id} value={id}>{name(id)}</option>)}</select></label>
  {view.level==='main'&&<label>业务能力<select aria-label="当前业务能力" value={reading?.scope||''} onChange={e=>update({scope:e.target.value||undefined,isolate:undefined})}><option value="">全部能力</option>{index.entities?.filter(e=>e.kind==='domain').map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></label>}
 </div>
 {(reading||view.relationSelection)&&<button className="button" onClick={()=>onChange({reading:undefined,relationSelection:undefined,selected:undefined,viewport:reading?.viewport||view.viewport})}>清空筛选 / 恢复上下文</button>}
 {selected&&<div className="relationship-actions"><strong>{name(selected.source)} → {name(selected.target)}</strong><button className="button" onClick={()=>update({isolate:'relation'})}>仅看此关系</button><button className="button" onClick={()=>update({isolate:'path',origin:view.level==='function'?origin:selected.source,target:selected.target})}>仅看此路径</button><button className="button" onClick={()=>onChange({inspector:'relations',relationIds:selected.relations.map(r=>r.id)})}>逐条查看来源 · {selected.relations.length}</button></div>}
 {reading?.isolate==='path'&&<p className="detail-note">展示入口到目标的全部相关可达关系；可能包含多个分支或循环，不表示唯一执行轨迹。</p>}
 <h3>{view.selected&&scoped.length!==listed.length?'选中节点的入边 / 出边':'当前范围'} · {scoped.length}</h3>
 {scoped.map(link=><button key={link.id} className={`relationship-choice ${view.relationSelection===link.id?'active':''}`} data-link-id={link.id} onClick={()=>onChange({relationSelection:link.id,reading:{...reading,viewport:reading?.viewport||view.viewport,viewportWidth:viewportWidth()},relationIds:link.relations.map(r=>r.id)})}><strong>{name(link.source)} → {name(link.target)}</strong><span>{labels[link.type]||link.type}{link.optional?' · 配置推测':''} · {link.relations.length} 条来源</span><small>{[...new Set(link.relations.map(r=>r.type))].join(' / ')}{link.entryIds?.length?` · ${link.entryIds.length} 个相关入口`:''}</small></button>)}
 {!scoped.length&&<p>当前条件下没有关系。清空筛选可恢复。</p>}
 </>;
}
