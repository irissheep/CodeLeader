import tokens from '../shared/ui-tokens';
const t=tokens.layout;
let context:OffscreenCanvasRenderingContext2D|null|undefined;
export function textWidth(text:string,size:number){
 if(context===undefined)context=typeof OffscreenCanvas==='function'?new OffscreenCanvas(1,1).getContext('2d'):null;
 if(context){context.font=`500 ${size}px "Segoe UI", "Microsoft YaHei", sans-serif`;return context.measureText(text).width;}
 // The headless corpus runner has no font engine; dependency card geometry is
 // deliberately unchanged. Other cards retain a deterministic text-width fallback.
 return Array.from(text).reduce((n,c)=>n+size*(/[\u3000-\uffff]/.test(c)?1:.6),0);
}
export function resourceWidth(name:string,summary=''){
 const body=Math.max(textWidth(name,parseFloat(t.title)),textWidth(summary,parseFloat(t.body))),slots=parseFloat(t.padding)*2+parseFloat(t.leading)+parseFloat(tokens.space[1])*2+parseFloat(t.tag)*6;
 return Math.max(t.resourceMinimum,Math.min(t.resourceMaximum,Math.ceil(body+slots)));
}
