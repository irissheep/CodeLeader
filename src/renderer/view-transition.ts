import {flushSync} from 'react-dom';
import {getMotionMode} from './ui-motion';

let current:ViewTransition|undefined;
/** A browser snapshot fades away; the live graph and its node identities stay intact. */
export function changeView(update:()=>void){
 current?.skipTransition();
 if(getMotionMode()!=='full'||!document.startViewTransition){update();return;}
 const transition=document.startViewTransition(()=>flushSync(update));current=transition;
 void transition.finished.catch(()=>{}).finally(()=>{if(current===transition)current=undefined;});
}
