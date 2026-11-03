import {useSyncExternalStore} from 'react';
import uiTokens from '../shared/ui-tokens';

export type MotionMode='full'|'reduced'|'off';
const key='codeleader.motion-mode';
const media=typeof matchMedia==='function'?matchMedia('(prefers-reduced-motion: reduce)'):undefined;
let preference:MotionMode|undefined;
try{const saved=localStorage.getItem(key);if(saved==='full'||saved==='reduced'||saved==='off')preference=saved;}catch{/* The system preference remains available without storage. */}
const listeners=new Set<()=>void>();
export const getMotionMode=():MotionMode=>media?.matches?'off':preference||'full';
const notify=()=>listeners.forEach(listener=>listener());
media?.addEventListener('change',notify);
export function setMotionMode(mode:MotionMode){
 if(preference===mode)return;preference=mode;
 try{localStorage.setItem(key,mode);}catch{/* The current window still applies the choice. */}
 notify();
}
export function useMotionMode(){
 const mode=useSyncExternalStore(listener=>{listeners.add(listener);return()=>listeners.delete(listener);},getMotionMode,getMotionMode);
 return{mode,setMode:setMotionMode};
}
export const motionPolicy=uiTokens.motionPolicy;
export function motionMs(key:keyof typeof uiTokens.motion){return parseFloat(uiTokens.motion[key]);}
