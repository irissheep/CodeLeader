import {useId,useLayoutEffect,useRef} from 'react';
import {createPortal} from 'react-dom';
import type {ReactNode} from 'react';
import './overlay.css';

/** Shared modal surface. Non-modal canvas menus and the docked inspector remain in their own layout. */
export function OverlayShell({id,title,onClose,children,footer,busy=false}:{id:string;title:ReactNode;onClose:()=>void;children:ReactNode;footer?:ReactNode;busy?:boolean}){
 const ref=useRef<HTMLElement>(null),titleId=useId(),close=useRef(onClose),locked=useRef(busy);
 close.current=onClose;locked.current=busy;
 useLayoutEffect(()=>{
  const previous=document.activeElement instanceof HTMLElement?document.activeElement:null,element=ref.current;
  if(!element)return;
  const focusable=()=>[...element.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],summary,[tabindex]:not([tabindex="-1"])')].filter(item=>item.getClientRects().length>0&&!item.closest('[inert]'));
  (element.querySelector<HTMLElement>('[autofocus]')||focusable()[0]||element).focus();
  const key=(event:KeyboardEvent)=>{
   if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();if(!locked.current)close.current();return;}
   if(event.key!=='Tab')return;
   const items=focusable(),first=items[0],last=items.at(-1);
   if(!first){event.preventDefault();element.focus();return;}
   if(event.shiftKey&&(document.activeElement===first||!element.contains(document.activeElement))){event.preventDefault();last!.focus();}
   else if(!event.shiftKey&&(document.activeElement===last||!element.contains(document.activeElement))){event.preventDefault();first.focus();}
  };
  document.addEventListener('keydown',key,true);
  return()=>{document.removeEventListener('keydown',key,true);if(previous?.isConnected)previous.focus();};
 },[]);
 return createPortal(<div className="overlay-shade" onClick={event=>event.stopPropagation()} onMouseDown={event=>{event.stopPropagation();if(event.target===event.currentTarget&&!busy)onClose();}}><section ref={ref} className="overlay-shell" role="dialog" aria-modal="true" aria-labelledby={titleId} data-overlay-id={id} tabIndex={-1}>
  <header className="overlay-header"><h2 id={titleId}>{title}</h2><button type="button" disabled={busy} aria-label="关闭" onClick={onClose}>×</button></header>
  <div className="overlay-body">{children}</div>{footer&&<footer className="overlay-footer">{footer}</footer>}
 </section></div>,document.body);
}
