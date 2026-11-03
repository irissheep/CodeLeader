import {useRef} from 'react';
const key='codeleader.runtime.pageWidth';
export const clampPageWidth=(width:number)=>Math.max(320,Math.min(720,Math.round(width)));
export function savedPageWidth(){try{const value=Number(localStorage.getItem(key));if(value>=320&&value<=720)return value;}catch{}return clampPageWidth(Math.min(560,innerWidth*.36));}
export function savePageWidth(width:number){try{localStorage.setItem(key,String(width));}catch{}}
export default function PageDivider({width,visible,onResize,onToggle}:{width:number;visible:boolean;onResize:(width:number)=>void;onToggle:()=>void}){
 const drag=useRef<{x:number;width:number}|undefined>(undefined);
 return <div role="separator" tabIndex={0} aria-label="调整页面宽度" aria-orientation="vertical" aria-valuemin={visible?320:0} aria-valuemax={720} aria-valuenow={visible?width:0} aria-valuetext={visible?`${width} 像素`:'页面已收起'} title="拖动调整宽度，双击收起或恢复页面" className={`runtime-page-divider ${visible?'':'is-collapsed'}`} onPointerDown={event=>{if(event.button!==0||!visible)return;event.preventDefault();drag.current={x:event.clientX,width};event.currentTarget.setPointerCapture(event.pointerId);}} onPointerMove={event=>{if(drag.current)onResize(clampPageWidth(drag.current.width+event.clientX-drag.current.x));}} onPointerUp={()=>drag.current=undefined} onPointerCancel={()=>drag.current=undefined} onDoubleClick={onToggle} onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();onToggle();}else if(visible&&['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();onResize(event.key==='Home'?320:event.key==='End'?720:clampPageWidth(width+(event.key==='ArrowRight'?20:-20)));}}}/>;
}
