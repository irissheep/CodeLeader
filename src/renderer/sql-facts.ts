import type {ReplayCall} from '../runtime/replay';
import {isObject,visibleValue,type DisplayMode} from './execution-data';
export const sqlOf=(call:ReplayCall)=>String(call.span?.attributes['db.query.text']||call.span?.attributes['db.statement']||'');
const identifier='(?:[A-Za-z_][\\w$]*|`[^`]+`|"[^"]+"|\\[[^\\]]+\\])';
export function sqlConditions(sql:string){
 // Mask literals/comments before looking for columns immediately before a comparison.
 const plain=sql.replace(/'(?:''|[^'])*'|\/\*[\s\S]*?\*\/|--[^\n]*/g,' '),where=plain.match(/\bWHERE\b([\s\S]*?)(?:\b(?:GROUP\s+BY|ORDER\s+BY|HAVING|LIMIT|RETURNING|FOR\s+UPDATE)\b|;|$)/i)?.[1];
 if(where===undefined)return [];
 if(/\bSELECT\b/i.test(where)||[...where.matchAll(/\b([A-Za-z_]\w*)\s*\(/g)].some(match=>!/^(IN|AND|OR|NOT)$/i.test(match[1])))return [];
 const pattern=new RegExp(`(?<![\\w:$])(${identifier}(?:\\s*\\.\\s*${identifier})*)\\s*(?:=|<>|!=|<=|>=|<|>|\\b(?:LIKE|ILIKE|IN|IS|BETWEEN)\\b)`,'gi');
 return [...new Set([...where.matchAll(pattern)].map(match=>match[1].split('.').at(-1)!.trim().replace(/^[`"\[]|[`"\]]$/g,'')))];
}
export function rowsOf(call:ReplayCall,mode:DisplayMode){
 const output=visibleValue(call.output,mode);if(!isObject(output))return;
 const count=output.observedRows??output.affectedRows;return typeof count==='number'&&Number.isSafeInteger(count)&&count>=0?count:undefined;
}
export function sqlAction(call:ReplayCall){
 const sql=sqlOf(call).replace(/'(?:''|[^'])*'|\/\*[\s\S]*?\*\/|--[^\n]*/g,' '),action=sql.match(/^\s*(SELECT|INSERT|UPDATE|DELETE|REPLACE)\b/i)?.[1].toUpperCase();
 const table=sql.match(/\b(?:INTO|UPDATE|FROM)\s+((?:[\w]+|`[^`]+`|"[^"]+")(?:\.(?:[\w]+|`[^`]+`|"[^"]+"))*)/i)?.[1];
 return {action,table};
}

export const shortTable=(table:string)=>table.split('.').at(-1)!.replace(/^[`"\[]|[`"\]]$/g,'');
