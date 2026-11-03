import type {SafeValue} from '../shared/execution';
import {isActual} from './snapshot';
export interface RecordedFrame {file:string;method:string;line:number;className?:string;}
export interface ExceptionDetail {type:string;message?:string;messageNotice?:string;causeNotice?:string;stack:RecordedFrame[];}
const object=(value:SafeValue|undefined):value is Record<string,SafeValue>=>!!value&&typeof value==='object'&&!Array.isArray(value);
export function exceptionValue(value:SafeValue|undefined):SafeValue|undefined{return isActual(value)?exceptionValue(value.value):value;}
export function recordedFrames(value:SafeValue|undefined):RecordedFrame[]{
 value=exceptionValue(value);if(typeof value==='string'){try{value=JSON.parse(value) as SafeValue;}catch{return [];}}
 if(!Array.isArray(value))return [];
 return value.flatMap(item=>{if(!object(item)||typeof item.file!=='string'||typeof item.method!=='string'||typeof item.line!=='number'||item.line<1||!Number.isInteger(item.line))return [];return [{file:item.file,method:item.method,line:item.line,...(typeof item.className==='string'?{className:item.className}:{})}];});
}
export function exceptionChain(value:SafeValue|undefined):ExceptionDetail[]{
 const chain:ExceptionDetail[]=[],seen=new Set<SafeValue>();let current=exceptionValue(value);
 while(object(current)&&chain.length<3&&!seen.has(current)){
  seen.add(current);const type=typeof current.type==='string'?current.type:typeof current.name==='string'?current.name:undefined;if(!type)break;
  chain.push({type,message:typeof current.message==='string'?current.message:undefined,messageNotice:typeof current.messageNotice==='string'?current.messageNotice:current.message===null?undefined:current.message===undefined?'没有录到异常消息':undefined,causeNotice:typeof current.causeNotice==='string'?current.causeNotice:!('cause'in current)?'没有录到后续原因':undefined,stack:recordedFrames(current.stack)});
  current=exceptionValue(current.cause);
 }
 return chain;
}
export function exceptionText(value:SafeValue|undefined){const first=exceptionChain(value)[0];return first?`抛出 ${first.type}${first.message!==undefined?'：'+first.message:first.messageNotice?'：'+first.messageNotice:''}`:undefined;}
