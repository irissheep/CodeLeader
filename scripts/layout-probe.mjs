// Runs inside the actual renderer. All geometry is in rendered CSS pixels.
export function scanLayout(policy){
 const violations=[],waivers=[],texts=[],icons=[],tolerance=policy.pixelTolerance;
 const box=r=>({x:r.x,y:r.y,width:r.width,height:r.height,right:r.right??r.x+r.width,bottom:r.bottom??r.y+r.height});
 const intersection=(a,b)=>{const x=Math.max(a.x,b.x),y=Math.max(a.y,b.y),right=Math.min(a.right,b.right),bottom=Math.min(a.bottom,b.bottom);return{x,y,right,bottom,width:Math.max(0,right-x),height:Math.max(0,bottom-y)};};
 const windowBox={x:0,y:0,right:innerWidth,bottom:innerHeight,width:innerWidth,height:innerHeight};
 const styles=new Map(),style=e=>{if(!styles.has(e))styles.set(e,getComputedStyle(e));return styles.get(e);};
 const ancestors=e=>{const a=[];for(;e;e=e.parentElement)a.push(e);return a;};
 const label=e=>e.closest('[data-call-id],[data-entry-id],[data-id]')?.getAttribute('data-call-id')||e.closest('[data-entry-id]')?.getAttribute('data-entry-id')||e.closest('[data-id]')?.getAttribute('data-id')||e.className?.baseVal||e.className||e.tagName;
 const surface=e=>{for(const rule of policy.surfaces){const match=e.closest(rule.selector);if(match)return match;}return document.body;};
 const visible=e=>e&&ancestors(e).every(n=>{const s=style(n);if(n.matches('details:not([open])')&&!n.querySelector(':scope>summary')?.contains(e))return false;return s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity)>.001&&s.clip!=='rect(0px, 0px, 0px, 0px)';});
 const scale=e=>ancestors(e).reduce((n,a)=>{const s=style(a),m=new DOMMatrixReadOnly(s.transform==='none'?undefined:s.transform);return n*Math.min(Math.hypot(m.a,m.b),Math.hypot(m.c,m.d))*(parseFloat(s.zoom)||1);},1);
 const clip=(rect,e)=>{let result=intersection(rect,windowBox);for(const a of ancestors(e)){const s=style(a);if(/hidden|clip|auto|scroll/.test(s.overflowX+' '+s.overflowY)){const r=a.getBoundingClientRect();result=intersection(result,box(r));}}return result;};
 const waiver=(kind,e)=>policy.exemptions.find(r=>r.checks.includes(kind)&&e.closest(r.selector));
 const add=(kind,item,extra={})=>{const entry={kind,text:item.text?.slice(0,120),element:label(item.element),elementClass:item.element.className,rect:item.rect,...extra},rule=waiver(kind,item.element);if(rule)waivers.push({...entry,reason:rule.reason});else violations.push(entry);};
 const canvas=document.createElement('canvas'),context=canvas.getContext('2d'),walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
 while(walker.nextNode()){
  const node=walker.currentNode,e=node.parentElement,text=node.textContent.trim();if(!text||!e||e.closest('script,style,noscript,svg,.monaco-aria-container')||!visible(e))continue;
  const range=document.createRange();range.selectNodeContents(node);const raw=box(range.getBoundingClientRect()),rect=clip(raw,e);if(rect.width<.1||rect.height<.1)continue;
  const s=style(e),zoom=scale(e),font=parseFloat(s.fontSize)*zoom,item={element:e,text,rect,rects:[...range.getClientRects()].map(r=>clip(box(r),e)).filter(r=>r.width>.1&&r.height>.1),font,surface:surface(e)};texts.push(item);
  // Only a wrapped text node can have a widow; single-line labels are legitimate.
  if(item.rects.length>1){
   const full=node.textContent,lastTop=item.rects.at(-1).y;let tail='';
   for(let i=full.length-1;i>=0;i--){const character=document.createRange();character.setStart(node,i);character.setEnd(node,i+1);const r=character.getBoundingClientRect();if(r.height&&Math.abs(r.y-lastTop)>tolerance)break;tail=full[i]+tail;}
   const characters=tail.trim().replace(/[\s\p{P}\p{S}]/gu,'');if(characters.length>0&&Array.from(characters).length<=2)add('widow-text',item,{lastLine:tail.trim()});
  }
  if(font<policy.minimumFont-.05)add('small-font',item,{font:Number(font.toFixed(2))});
  context.font=s.font;const glyph=context.measureText(text).width/Math.max(1,Array.from(text).length)*zoom;
  if(text.length>3&&Math.min(raw.width,e.clientWidth?e.clientWidth*zoom:Infinity)<glyph*2-tolerance)add('collapsed-text',item,{glyphWidth:glyph});
  const scroll=ancestors(e).some(a=>/auto|scroll/.test(style(a).overflowX+' '+style(a).overflowY));
  const chain=ancestors(e),viewport=chain.findIndex(a=>a.matches('.react-flow__viewport')),local=viewport<0?chain:chain.slice(0,viewport);
  const clipped=local.find(a=>{if(policy.viewportClips.some(rule=>a.matches(rule.selector)))return false;const st=style(a),r=box(a.getBoundingClientRect());return/hidden|clip/.test(st.overflowX+' '+st.overflowY)&&(raw.x<r.x-tolerance||raw.right>r.right+tolerance||raw.y<r.y-tolerance||raw.bottom>r.bottom+tolerance);});
  if(clipped&&!scroll){const ellipsis=ancestors(e).some(a=>style(a).textOverflow==='ellipsis'||parseInt(style(a).webkitLineClamp)>0),full=ancestors(e).some(a=>(a.getAttribute('title')||'').includes(text)||(a.matches('[data-module-block][data-has-tooltip]')&&(a.getAttribute('aria-label')||'').includes(text))||a.getAttribute('aria-describedby')?.split(' ').some(id=>document.getElementById(id)?.textContent.includes(text)));if(!ellipsis||!full)add('clipped-text',item,{ellipsis,fullName:!!full});}
  const card=e.closest('.graph-card,.service-container');if(card&&!e.closest('.card-hint,.capability-hint')){const bound=box(card.getBoundingClientRect());if(rect.x<bound.x-tolerance||rect.right>bound.right+tolerance||rect.y<bound.y-tolerance||rect.bottom>bound.bottom+tolerance)add('outside-card',item,{card:label(card),boundary:bound});}
  if(!scroll&&!e.closest('.react-flow__viewport')&&(raw.x<-.75||raw.y<-.75||raw.right>innerWidth+.75||raw.bottom>innerHeight+.75)&&!clipped)add('outside-window',item);
 }
 for(const e of document.querySelectorAll('svg.lucide,[data-layout-icon]'))if(visible(e)){const rect=clip(box(e.getBoundingClientRect()),e);if(rect.width>.1&&rect.height>.1)icons.push({element:e,rect,surface:surface(e)});}
 for(let i=0;i<texts.length;i++)for(let j=i+1;j<texts.length;j++){
  const a=texts[i],b=texts[j];if(a.surface!==b.surface)continue;let fraction=0;for(const first of a.rects)for(const second of b.rects){const cross=intersection(first,second);if(cross.width>tolerance&&cross.height>tolerance)fraction=Math.max(fraction,cross.width*cross.height/Math.min(first.width*first.height,second.width*second.height));}if(fraction>policy.overlapFraction)add('text-overlap',a,{other:b.text.slice(0,120),otherElement:label(b.element),otherClass:b.element.className,fraction:Number(fraction.toFixed(3))});
 }
 for(const icon of icons)for(const text of texts){if(icon.surface!==text.surface)continue;const r=intersection(icon.rect,text.rect);if(r.width>tolerance&&r.height>tolerance&&r.width*r.height/Math.min(icon.rect.width*icon.rect.height,text.rect.width*text.rect.height)>policy.overlapFraction)add('icon-overlap',text,{icon:label(icon.element),iconRect:icon.rect});}
 const routes=[];
 if(policy.dependencyRoutes&&document.querySelector('[data-view=overview][aria-pressed=true]')){
  const root=document.querySelector('.graph-canvas'),nodes=[...root.querySelectorAll('.react-flow__node')].map(e=>e.getBoundingClientRect()),viewport=root.querySelector('.react-flow__viewport'),zoom=viewport?new DOMMatrix(getComputedStyle(viewport).transform).a:1;
  if(nodes.length){const bounds={x:Math.min(...nodes.map(r=>r.left)),y:Math.min(...nodes.map(r=>r.top)),right:Math.max(...nodes.map(r=>r.right)),bottom:Math.max(...nodes.map(r=>r.bottom))};
   for(const path of root.querySelectorAll('.react-flow__edge-path')){const rect=box(path.getBoundingClientRect()),outside=Math.max(0,bounds.x-rect.x,rect.right-bounds.right,bounds.y-rect.y,rect.bottom-bounds.bottom)/zoom;routes.push({id:path.closest('[data-id]')?.getAttribute('data-id'),outside});if(outside>policy.dependencyRoutes.outerMargin+tolerance)add('edge-exterior',{element:path,text:'连接',rect},{outside,boundary:bounds});}
  }
 }
 return{viewport:{width:innerWidth,height:innerHeight},textCount:texts.length,iconCount:icons.length,violations,waivers,minimumFont:texts.length?Math.min(...texts.map(t=>t.font)):null,routes,counts:violations.reduce((all,v)=>(all[v.kind]=(all[v.kind]||0)+1,all),{})};
}
