import test from 'node:test';
import assert from 'node:assert/strict';
import {offsetPosition,offsetsRange} from '../src/shared/ranges';

function original(text:string,offset:number){const prefix=text.slice(0,offset);return{line:prefix.split('\n').length-1,character:offset-prefix.lastIndexOf('\n')-1};}

test('line and UTF-16 character positions match the previous calculation',()=>{
 const texts=['','one','\n','one\r\ntwo\n','中文🙂\n𝄞end\n','x\n'.repeat(4000)+'tail'];
 for(const text of texts){
  const offsets=text.length<100?Array.from({length:text.length*2+5},(_,index)=>index-text.length-2):[0,1,2,3999,4000,7999,8000,text.length,text.length+2,-1];
  for(const offset of [...offsets,0.5,-0.5,NaN,Infinity,-Infinity])assert.deepEqual(offsetPosition(text,offset),original(text,offset));
  assert.deepEqual(offsetsRange(text,0,text.length),{start:original(text,0),end:original(text,text.length)});
 }
 for(const text of [...texts].reverse())assert.deepEqual(offsetPosition(text,text.length),original(text,text.length));
});
