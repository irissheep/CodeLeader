import type {BrowserOperation,BrowserRequest,OperationClick} from '../shared/execution';
import {isActual,hideActual} from './snapshot';
export const operationMark=(number:number)=>String(number);
export const operationNumber=(operations:BrowserOperation[],operation:BrowserOperation)=>operations.findIndex(o=>o.id===operation.id)+1;
export function clickEvidence(value:unknown):OperationClick|undefined{
 if(!value||typeof value!=='object')return;const c=value as OperationClick,v=c.viewport,r=c.rect;
 if(!v||!r||![c.x,c.y,c.pageTime,c.pageEpoch,v.width,v.height,r.x,r.y,r.width,r.height].every(n=>typeof n==='number'&&Number.isFinite(n)))return;
 if(v.width<=0||v.height<=0||v.width>20000||v.height>20000||c.x<0||c.y<0||c.x>v.width||c.y>v.height||r.width<=0||r.height<=0)return;
 const x=Math.max(0,r.x),y=Math.max(0,r.y),right=Math.min(v.width,r.x+r.width),bottom=Math.min(v.height,r.y+r.height);if(right<=x||bottom<=y)return;
 return {x:c.x,y:c.y,rect:{x,y,width:right-x,height:bottom-y},viewport:{width:v.width,height:v.height},text:typeof c.text==='string'?c.text.slice(0,160):'',pageTime:c.pageTime,pageEpoch:c.pageEpoch};
}
export function requestEcho(request:BrowserRequest|undefined,hidden=false){
 if(!request?.input)return '';let value=isActual(request.input)?request.input.value:request.input;if(hidden)value=hideActual(value);
 if(!value||typeof value!=='object'||Array.isArray(value)||!isActual(request.input))return '';
 return Object.entries(value).filter(([,v])=>typeof v==='string'||typeof v==='number'||typeof v==='boolean').slice(0,3).map(([k,v])=>`${k}: ${String(v).slice(0,80)}`).join(' · ').slice(0,180);
}
export function relativeOperation(operation:BrowserOperation|undefined,now:number,historical=false){
 if(historical)return '历史';if(!operation?.observedAt)return '';
 const seconds=Math.max(0,Math.floor((now-operation.observedAt)/1000));return seconds<2?'刚刚':seconds<60?`${seconds} 秒前`:`${Math.floor(seconds/60)} 分钟前`;
}
