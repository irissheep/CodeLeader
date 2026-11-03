import type { Position, Range } from './model';
// web-tree-sitter's JS binding uses UTF-16 code units, including its indices.
let cachedText:string|undefined;
let lineStarts:number[]=[0];
export function offsetPosition(text:string, offset:number): Position {
  if(text!==cachedText){
    cachedText=text;lineStarts=[0];
    for(let at=text.indexOf('\n');at!==-1;at=text.indexOf('\n',at+1))lineStarts.push(at+1);
  }
  // Match String.slice's handling of out-of-range and fractional offsets.
  const end=Math.trunc(Number.isNaN(offset)?0:offset),limit=end<0?Math.max(0,text.length+end):Math.min(text.length,end);
  let low=0,high=lineStarts.length;
  while(low+1<high){const middle=(low+high)>>>1;if(lineStarts[middle]<=limit)low=middle;else high=middle;}
  return {line:low,character:offset-lineStarts[low]};
}
export function offsetsRange(text:string, start:number, end:number): Range {
  return { start: offsetPosition(text,start), end: offsetPosition(text,end) };
}
export function javaRange(startLine:number,startColumn:number,endLine:number,endColumn:number): Range {
  return {start:{line:startLine-1,character:startColumn-1},end:{line:endLine-1,character:endColumn}};
}
