// Evaluated in the rendered window; retain unknown backgrounds rather than treating them as passes.
export function u9bProbe(){
 const styles=new Map(),style=e=>{if(!styles.has(e))styles.set(e,getComputedStyle(e));return styles.get(e);};
 const ancestors=e=>{const list=[];for(;e;e=e.parentElement)list.push(e);return list;};
 const visible=e=>ancestors(e).every(a=>{const s=style(a);return s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity)>.001&&(!a.matches('details:not([open])')||a.querySelector(':scope>summary')?.contains(e));});
 const scale=e=>ancestors(e).reduce((n,a)=>{const s=style(a),m=new DOMMatrixReadOnly(s.transform==='none'?undefined:s.transform);return n*Math.min(Math.hypot(m.a,m.b),Math.hypot(m.c,m.d))*(parseFloat(s.zoom)||1);},1);
 const texts=[],violations=[],unknown=[],outside=new Set(),walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
 while(walker.nextNode()){
  const node=walker.currentNode,e=node.parentElement,text=node.textContent.trim(),modal=document.querySelector('.entry-shade');if(!text||!e||e.closest('script,style,noscript,svg,.monaco-aria-container')||modal&&!modal.contains(e)||!visible(e))continue;
  const range=document.createRange();range.selectNodeContents(node);const r=range.getBoundingClientRect();if(r.width<.1||r.height<.1||r.right<=0||r.bottom<=0||r.left>=innerWidth||r.top>=innerHeight)continue;
  let rect={left:Math.max(0,r.left),top:Math.max(0,r.top),right:Math.min(innerWidth,r.right),bottom:Math.min(innerHeight,r.bottom)};const chain=ancestors(e);
  for(const a of chain){const st=style(a);if(/hidden|clip|auto|scroll/.test(st.overflowX+' '+st.overflowY)){const b=a.getBoundingClientRect();rect={left:Math.max(rect.left,b.left),top:Math.max(rect.top,b.top),right:Math.min(rect.right,b.right),bottom:Math.min(rect.bottom,b.bottom)};}}
  if(rect.right-rect.left<.1||rect.bottom-rect.top<.1)continue;
  const s=style(e),font=parseFloat(s.fontSize)*scale(e),opacity=chain.reduce((n,a)=>n*Number(style(a).opacity),1);
  const element=e.closest('[data-module-block],[data-id],button,summary,section')?.getAttribute('data-module-block')||e.className||e.tagName;
  const item={text:text.slice(0,100),element:String(element),font:Number(font.toFixed(2)),color:s.color,opacity,faded:chain.filter(a=>Number(style(a).opacity)<.999).map(a=>({tag:a.tagName,className:String(a.className?.baseVal||a.className||''),opacity:style(a).opacity})),rect};
  texts.push(item);if(!e.closest('.react-flow__node'))outside.add(e.closest('.orientation-bar>span,.orientation-bar>strong,button,summary,p,.orientation-legend>span,.orientation-view-hint,.react-flow__attribution')||e);
  const exempt=/^[\d\s.,:/%+−×-]+$/.test(text)||!!e.closest('kbd,.mono-badge');
  if(font<(exempt?11:12)-.05)violations.push({...item,kind:'small-text',minimum:exempt?11:12});
 }
 return {textCount:texts.length,outsideItems:outside.size,outsideLabels:[...outside].map(e=>({tag:e.tagName,className:String(e.className||''),text:e.innerText?.slice(0,120)})),texts,violations,unknown};
}
export async function u9bContrastPixels(input){
 const image=new Image();image.src=input.image;await image.decode();const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0);
 const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data,ratioX=image.width/innerWidth,ratioY=image.height/innerHeight;
 const luminance=color=>{const c=color.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;});return .2126*c[0]+.7152*c[1]+.0722*c[2];},violations=[],unknown=[];
 for(const item of input.texts){const values=item.color.match(/[\d.]+/g)?.map(Number);if(!values||values.length<3){unknown.push({...item,kind:'color-undetermined'});continue;}let worst=Infinity;const alpha=(values[3]??1)*item.opacity,r=item.rect;
  for(const dx of [.25,.5,.75])for(const dy of [.3,.7]){const x=Math.max(0,Math.min(image.width-1,Math.floor((r.left+(r.right-r.left)*dx)*ratioX))),y=Math.max(0,Math.min(image.height-1,Math.floor((r.top+(r.bottom-r.top)*dy)*ratioY))),at=(y*image.width+x)*4,back=[pixels[at],pixels[at+1],pixels[at+2]],front=back.map((v,i)=>values[i]*alpha+v*(1-alpha)),a=luminance(front),b=luminance(back);worst=Math.min(worst,(Math.max(a,b)+.05)/(Math.min(a,b)+.05));}
  if(worst<4.5)violations.push({...item,kind:'contrast',ratio:Number(worst.toFixed(2))});
 }
 return {violations,unknown};
}
