import type {ProjectIndex} from '../shared/model';
import type {GraphCard} from './graph-model';

export function rankedPages(index:ProjectIndex){
 const model=index.frontend;if(!model)return [];
 return model.pages.filter(p=>!p.test).map(page=>({page,calls:model.httpCalls.filter(c=>!c.test&&c.pageIds.includes(page.id)),imports:model.imports.filter(i=>i.to&&page.componentModuleIds.includes(i.from))}))
  .sort((a,b)=>(b.calls.length+b.imports.length)-(a.calls.length+a.imports.length)||b.calls.length-a.calls.length||a.page.name.localeCompare(b.page.name)||a.page.id.localeCompare(b.page.id));
}
export function singlePage(index:ProjectIndex,cards:GraphCard[]){
 if(cards.length!==1)return;
 const card=cards[0],ids=card.dependency?.unitIds||[card.id];
 if(card.kind==='group'||ids.length!==1)return;
 return rankedPages(index).find(item=>item.page.componentModuleIds.some(id=>ids.includes(id)));
}
export function frontendCounts(card:GraphCard){
 const calls=[...new Map((card.frontend?.calls||[]).map(c=>[c.id,c])).values()],matched=calls.filter(c=>c.state==='matched').length;
 return{calls,total:calls.length,matched,unmatched:calls.length-matched};
}
