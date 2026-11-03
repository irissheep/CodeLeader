import {useEffect} from 'react';
import policy from '../../resources/performance-policy.json';

// A DOM class avoids re-rendering the graph for ordinary pointer movement.
export function useResourceIdle(){
 useEffect(()=>{
  const root=document.documentElement;let timer:ReturnType<typeof setTimeout>|undefined,nativeFocused=true,alive=true;
  const idle=()=>{root.classList.add('resource-idle');timer=undefined;};
  const activity=()=>{if(document.hidden||!nativeFocused)return;root.classList.remove('resource-idle');clearTimeout(timer);timer=setTimeout(idle,policy.interactionIdleMilliseconds.value);};
  const visibility=()=>{const background=document.hidden||!nativeFocused;root.classList.toggle('resource-background',background);if(background){clearTimeout(timer);idle();}else activity();};
  const events=['pointermove','pointerdown','keydown','wheel','touchstart'] as const;
  for(const event of events)window.addEventListener(event,activity,{passive:true});
  const stop=window.codeleader.onWindowFocus(focused=>{nativeFocused=focused;visibility();});void window.codeleader.windowFocused().then(focused=>{if(alive){nativeFocused=focused;visibility();}}).catch(()=>{});
  window.addEventListener('focus',visibility);window.addEventListener('blur',visibility);document.addEventListener('visibilitychange',visibility);visibility();
  return()=>{alive=false;stop();clearTimeout(timer);for(const event of events)window.removeEventListener(event,activity);window.removeEventListener('focus',visibility);window.removeEventListener('blur',visibility);document.removeEventListener('visibilitychange',visibility);root.classList.remove('resource-idle','resource-background');};
 },[]);
}
