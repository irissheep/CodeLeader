/** Main-world observation only. Native arguments, receiver, return values and exceptions pass through. */
export function operationObserver(cleanupName:string){return `(()=>{'use strict';
const nativeAdd=EventTarget.prototype.addEventListener,nativeRemove=EventTarget.prototype.removeEventListener,nativeFetch=globalThis.fetch,nativeSend=globalThis.XMLHttpRequest?.prototype.send;
const nativeTimeout=globalThis.setTimeout,nativeInterval=globalThis.setInterval,nativeMicrotask=globalThis.queueMicrotask,nativeThen=Promise.prototype.then;
const documentId=crypto.randomUUID(),events=new WeakMap(),listeners=new WeakMap();let active=true,context,click,typing;
const emit=(kind,label,id,clickData)=>{const operation={id:id||crypto.randomUUID(),documentId,kind,url:location.href,label,...(clickData?{click:clickData}:{})};try{if(active)codeleaderOperation(JSON.stringify(operation));}catch{}return operation;};
const invoke=(callback,receiver,args,operation)=>{const previous=context;context=active?operation:undefined;try{if(context){const name='__cl_operation_'+context.id;return ({[name](){return Reflect.apply(callback,receiver,args);}})[name]();}return Reflect.apply(callback,receiver,args);}finally{context=previous;}};
const capture=event=>{if(!active||!event.isTrusted)return;let operation;const target=event.target instanceof Element?event.target:undefined;if(!target)return;
 if(event.type==='click'){
  typing=undefined;
  if(event.detail===0&&click?.keyboard&&click.target===target&&performance.now()-click.time<500)operation=click.operation;
  else{const element=target.closest('button,a,[role="button"],input,textarea,select,[contenteditable]')||target;let detail;try{const r=element.getBoundingClientRect(),time=performance.now();detail={x:event.clientX,y:event.clientY,rect:{x:r.x,y:r.y,width:r.width,height:r.height},viewport:{width:innerWidth,height:innerHeight},text:(element.innerText||element.getAttribute('aria-label')||'').trim().slice(0,160),pageTime:time,pageEpoch:performance.timeOrigin+time};}catch{}operation=emit('click',(element.getAttribute('aria-label')||element.innerText||element.getAttribute('placeholder')||element.getAttribute('title')||'点击 '+element.tagName.toLowerCase()).trim().slice(0,80),undefined,detail);}
  click={operation,time:performance.now(),form:target.closest('form'),target};
 }else if(event.type==='submit'){
  typing=undefined;operation=click&&click.form===event.target&&performance.now()-click.time<500?click.operation:emit('submit','提交');
 }else if(event.type==='keydown'&&event.key==='Enter'&&(target.tagName!=='TEXTAREA'||event.ctrlKey||event.metaKey)){
  typing=undefined;operation=emit('submit','提交');click={operation,time:performance.now(),form:target.closest('form'),target,keyboard:true};
 }else if(target.closest('input,textarea,[contenteditable]')&&(event.type==='input'||event.type==='keydown'&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&(event.key.length===1||['Backspace','Delete'].includes(event.key)))){
  const previous=typing&&typing.target===target&&performance.now()-typing.time<1500?typing.operation:undefined;
  operation=emit('input','输入 '+(target.getAttribute('aria-label')||target.getAttribute('placeholder')||'内容').slice(0,70),previous?.id);typing={operation,target,time:performance.now()};
 }
 if(operation)events.set(event,operation);
};
for(const type of ['click','submit','keydown','input'])Reflect.apply(nativeAdd,globalThis,[type,capture,true]);
EventTarget.prototype.addEventListener=function(type,listener,...options){if(listener&&(typeof listener==='function'||typeof listener==='object')){let wrapped=listeners.get(listener);if(!wrapped){wrapped=function(event){const operation=events.get(event)||context;return invoke(typeof listener==='function'?listener:listener.handleEvent,typeof listener==='function'?this:listener,[event],operation);};listeners.set(listener,wrapped);}return Reflect.apply(nativeAdd,this,[type,wrapped,...options]);}return Reflect.apply(nativeAdd,this,[type,listener,...options]);};
EventTarget.prototype.removeEventListener=function(type,listener,...options){return Reflect.apply(nativeRemove,this,[type,listener&&listeners.get(listener)||listener,...options]);};
const fetchWrapper=function(...args){return invoke(nativeFetch,this,args,context);};if(nativeFetch)globalThis.fetch=fetchWrapper;
const sendWrapper=function(...args){return invoke(nativeSend,this,args,context);};if(nativeSend)XMLHttpRequest.prototype.send=sendWrapper;
const thenWrapper=function(ok,fail){const operation=context;if(!active||!operation)return Reflect.apply(nativeThen,this,[ok,fail]);const wrap=callback=>typeof callback==='function'?function(...args){return invoke(callback,this,args,operation);}:callback;return Reflect.apply(nativeThen,this,[wrap(ok),wrap(fail)]);};Promise.prototype.then=thenWrapper;
const timer=original=>function(callback,...args){if(typeof callback!=='function'||!context)return Reflect.apply(original,this,[callback,...args]);const operation=context;return Reflect.apply(original,this,[function(...values){return invoke(callback,this,values,operation);},...args]);};
const intervalWrapper=function(callback,...args){if(typeof callback!=='function')return Reflect.apply(nativeInterval,this,[callback,...args]);return Reflect.apply(nativeInterval,this,[function __cl_background_interval(...values){return invoke(callback,this,values,undefined);},...args]);};
globalThis.setTimeout=timer(nativeTimeout);globalThis.setInterval=intervalWrapper;if(nativeMicrotask)globalThis.queueMicrotask=timer(nativeMicrotask);
globalThis[${JSON.stringify(cleanupName)}]=()=>{active=false;context=undefined;for(const type of ['click','submit','keydown','input'])Reflect.apply(nativeRemove,globalThis,[type,capture,true]);if(globalThis.fetch===fetchWrapper)globalThis.fetch=nativeFetch;if(nativeSend&&XMLHttpRequest.prototype.send===sendWrapper)XMLHttpRequest.prototype.send=nativeSend;if(Promise.prototype.then===thenWrapper)Promise.prototype.then=nativeThen;globalThis.setTimeout=nativeTimeout;if(globalThis.setInterval===intervalWrapper)globalThis.setInterval=nativeInterval;if(nativeMicrotask)globalThis.queueMicrotask=nativeMicrotask;};
})();\n//# sourceURL=codeleader-operation-observer.js`;}
