import type {ProjectIndex,ViewState} from '../shared/model';
import {rankedPages,singlePage} from './frontend-reading';
import type {GraphCard} from './graph-model';
import {wording,wordingTable} from './ui-wording';

export default function SinglePageState({index,cards,onNavigate}:{index:ProjectIndex;cards:GraphCard[];onNavigate:(v:Partial<ViewState>)=>void}){
 const current=singlePage(index,cards);if(!current)return null;
 const choices=rankedPages(index).filter(p=>!p.page.componentModuleIds.some(id=>current.page.componentModuleIds.includes(id))).sort((a,b)=>b.calls.length-a.calls.length||b.imports.length-a.imports.length||a.page.id.localeCompare(b.page.id));
 const others=[...new Map(choices.map(item=>[item.page.componentModuleIds[0],item])).values()].slice(0,wordingTable.limits.alternatives.value);
 return <section className="single-page-state nodrag nopan" style={{top:`calc(${wordingTable.limits.singleCenter.value*100}% + var(--space-6))`}} aria-label="页面内容" data-single-page={current.page.id}>
  <p>{current.calls.length?wording('pageWithCalls',{count:current.calls.length}):current.imports.length?'这个页面没有更多文件需要展开':wording('pageNoFiles')}</p>
  {!!others.length&&<div><span>{wording('tryAnother')}</span>{others.map(({page})=><button key={page.id} title={page.name} onClick={()=>onNavigate({level:'overview',filter:'frontend',focus:page.componentModuleIds[0],selected:page.componentModuleIds[0],dependencyScope:'chain',relationFilter:'all'})}><span>{page.componentNames[0]||page.name.split(' · ').at(-1)||page.paths.join(' / ')}</span></button>)}</div>}
 </section>;
}
