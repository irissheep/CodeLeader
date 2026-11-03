import type {Rect} from './graph-geometry';
import tokens from '../shared/ui-tokens';
export const runtimePadding=24,runtimeMinZoom=tokens.layout.titleMinimum/parseFloat(tokens.layout.title);
export function intersects(a:Rect,b:Rect){return a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y;}
export function rectBounds(rects:Rect[]):Rect{
 const x=Math.min(...rects.map(r=>r.x)),y=Math.min(...rects.map(r=>r.y));return{x,y,width:Math.max(...rects.map(r=>r.x+r.width))-x,height:Math.max(...rects.map(r=>r.y+r.height))-y};
}
/** Keep an unobstructed rectangle; side drawers and the bottom dock normally remove full strips. */
export function visibleCanvas(canvas:Rect,obstacles:Rect[]):Rect{
 let free=[canvas];for(const blocker of obstacles.filter(r=>r.width>0&&r.height>0)){
  free=free.flatMap(area=>{if(!intersects(area,blocker))return[area];const left=Math.max(area.x,blocker.x),right=Math.min(area.x+area.width,blocker.x+blocker.width),top=Math.max(area.y,blocker.y),bottom=Math.min(area.y+area.height,blocker.y+blocker.height);
   return[{x:area.x,y:area.y,width:left-area.x,height:area.height},{x:right,y:area.y,width:area.x+area.width-right,height:area.height},{x:area.x,y:area.y,width:area.width,height:top-area.y},{x:area.x,y:bottom,width:area.width,height:area.y+area.height-bottom}].filter(r=>r.width>0&&r.height>0);
  });
 }
 return free.sort((a,b)=>b.width*b.height-a.width*a.height)[0]||{...canvas,width:0,height:0};
}
export function fitZoom(bounds:Rect,area:Rect){return Math.min(1,(area.width-runtimePadding*2)/Math.max(1,bounds.width),(area.height-runtimePadding*2)/Math.max(1,bounds.height));}
export function fitRuntime(rects:Rect[],focus:Rect[],area:Rect){
 const bounds=rectBounds(rects),limited=fitZoom(bounds,area)<runtimeMinZoom,target=limited&&focus.length?rectBounds(focus):bounds;
 const zoom=limited?runtimeMinZoom:Math.max(runtimeMinZoom,fitZoom(target,area));return{limited,bounds,focusFits:fitZoom(target,area)>=runtimeMinZoom,viewport:{x:area.x+area.width/2-(target.x+target.width/2)*zoom,y:area.y+area.height/2-(target.y+target.height/2)*zoom,zoom}};
}
