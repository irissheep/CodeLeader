/** Runs inside the real renderer. Counts full details, including native closed lists. */
export function checkWordingSummaries(){
 const violations=[],summaries=[];
 const unique=(root,selector,key)=>new Set([...root.querySelectorAll(selector)].map(e=>e.getAttribute(key)));
 for(const root of document.querySelectorAll('[data-summary-kind]')){
  const kind=root.dataset.summaryKind,item={kind};
  const compare=(field,total,detail)=>{item[field]={total,detail};if(total!==detail)violations.push({kind:'summary-detail',object:kind,field,total,detail});};
  if(kind==='resource'){
   item.id=root.dataset.resourceId;compare('tables',+root.dataset.tableTotal,unique(root,'[data-table-name]','data-table-name').size);compare('places',+root.dataset.placeTotal,unique(root,'[data-access-key]','data-access-key').size);
   compare('shown-places',+root.dataset.placeTotal,Number(root.querySelector('[data-copy-key=resource-places]')?.textContent.match(/(\d+)\s*处读写/)?.[1]||0));
   compare('shown-tables',+root.dataset.tableTotal,Number(root.querySelector('[data-copy-key=resource-tables]>summary')?.textContent.match(/(\d+)\s*张表/)?.[1]||0));
   if(root.querySelectorAll('[data-table-name]').length!==unique(root,'[data-table-name]','data-table-name').size)violations.push({kind:'repeated-table-list'});
  }else if(kind==='frontend'){
   compare('partition',+root.dataset.total,+root.dataset.matched+ +root.dataset.unmatched);
   compare('shown-total',+root.dataset.total,Number(root.querySelector('.hierarchy-front-total strong')?.textContent));
   const heading=root.querySelector('.hierarchy-frontend-heading strong'),name=heading?.getBoundingClientRect(),card=root.getBoundingClientRect();
   if(!name||Math.min(name.right,card.right)-Math.max(name.left,card.left)<Math.min(name.width,16))violations.push({kind:'missing-frontend-name'});
   if(root.querySelector('.backbone-inline-list'))compare('calls',+root.dataset.total,unique(root,'[data-detail-call-id]','data-detail-call-id').size);
  }else if(kind==='frontend-page'){
   compare('calls',+root.dataset.pageTotal,unique(root,'[data-detail-call-id]','data-detail-call-id').size);
   compare('shown-total',+root.dataset.pageTotal,Number(root.querySelector('p')?.textContent.match(/(\d+)\s*个接口调用/)?.[1]||0));
  }else if(kind==='method'){
   compare('methods',+root.dataset.hiddenTotal,unique(root,'[data-hidden-target]','data-hidden-target').size);
   compare('shown-methods',+root.dataset.hiddenTotal,Number(root.querySelector('p')?.textContent.match(/还有\s*(\d+)\s*个方法/)?.[1]||0));
  }
  const copyKeys=[...root.querySelectorAll('[data-copy-key]')].map(e=>e.dataset.copyKey);
  for(const key of new Set(copyKeys))if(copyKeys.filter(v=>v===key).length>1)violations.push({kind:'repeated-summary',object:kind,key});
  summaries.push(item);
 }
 for(const page of document.querySelectorAll('[data-page-call-count]')){
  const count=+page.dataset.pageCallCount,detail=unique(page,'[data-detail-call-id]','data-detail-call-id').size;
  if(count!==detail)violations.push({kind:'page-count',total:count,detail});
  if(!count&&!page.querySelector('[data-page-empty]'))violations.push({kind:'missing-no-call-explanation'});
  if(!count&&/没对上|未对上/.test(page.textContent))violations.push({kind:'contradictory-no-call'});
 }
 return{summaries,violations,pages:document.querySelectorAll('[data-page-call-count]').length};
}
