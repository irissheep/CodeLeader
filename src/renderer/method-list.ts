import type {SafeValue} from '../shared/execution';
import type {ReplayCall,ReplayModel} from '../runtime/replay';
import {fullValue,visibleValue,type DisplayMode} from './execution-data';
import {sqlAction,sqlOf,sqlConditions,rowsOf,shortTable} from './sql-facts';
export {sqlConditions} from './sql-facts';

export interface MethodRow {id:string;callIds:string[];stepId:string;depth:number;name:string;detail?:string;sql?:string;input?:SafeValue;output?:SafeValue;count?:number;}
function parentOf(model:ReplayModel,call:ReplayCall){
 let parent=call.parentId;const seen=new Set<string>();
 while(parent&&!seen.has(parent)){seen.add(parent);const next=model.byCall[parent];if(call.kind!=='sql'||next?.kind!=='sql'||sqlOf(next).trim()!==sqlOf(call).trim())break;parent=next.parentId;}
 return parent;
}
export function methodRows(model:ReplayModel,ids:string[],mode:DisplayMode='raw'):MethodRow[]{
 const selected=new Set(ids),rows:MethodRow[]=[];
 for(const id of [...ids].sort((a,b)=>model.positions[model.byCall[a]?.enterId]-model.positions[model.byCall[b]?.enterId])){const call=model.byCall[id];if(!call)continue;let depth=0,parent=parentOf(model,call);const seen=new Set<string>();
  while(parent&&!seen.has(parent)){seen.add(parent);if(selected.has(parent))depth++;const ancestor=model.byCall[parent];parent=ancestor?parentOf(model,ancestor):undefined;}
  const sql=call.kind==='sql'?sqlOf(call):undefined,input=visibleValue(call.input,mode),output=visibleValue(call.output,mode),count=rowsOf(call,mode),last=rows.at(-1),previous=last&&model.byCall[last.id];
  const same=last&&previous&&last.depth===depth&&parentOf(model,previous)===parentOf(model,call)&&(sql!==undefined?sql.trim()===last.sql?.trim():call.kind===previous.kind&&call.name===previous.name)&&(last.input===undefined||input===undefined||JSON.stringify(last.input)===JSON.stringify(input))&&(last.output===undefined||output===undefined||JSON.stringify(last.output)===JSON.stringify(output))&&(last.count===undefined||count===undefined||last.count===count)&&!call.error&&!previous.error&&call.span?.status!=='error'&&previous.span?.status!=='error';
  if(same){last.callIds.push(id);if(last.input===undefined)last.input=input;if(last.output===undefined)last.output=output;last.count??=count;continue;}
  rows.push({id,callIds:[id],stepId:call.enterId,depth,name:call.name,sql,input,output,count});
 }
 for(const row of rows)if(row.sql!==undefined){const call=model.byCall[row.id],{action,table}=sqlAction(call),conditions=sqlConditions(row.sql),verb=({SELECT:'读取',INSERT:'写入',UPDATE:'修改',DELETE:'删除'} as Record<string,string>)[action||''];
  if(!verb||!table||/\bWHERE\b/i.test(row.sql)&&!conditions.length){row.name=row.sql.slice(0,60)+(row.sql.length>60?'…':'');continue;}
  row.name=`${verb} ${shortTable(table)}`;row.detail=[conditions.length?'按 '+conditions.join('、'):undefined,row.count===undefined?'返回行数没录到':`${row.count} 行`].filter(Boolean).join(' · ');
 }
 return rows;
}
export function methodRowTitle(model:ReplayModel,row:MethodRow,mode:DisplayMode){
 const calls=row.callIds.map(id=>model.byCall[id]);
 return [...calls.map(call=>`第 ${model.positions[call.enterId]+1} 步 · ${typeof call.durationMs==='number'?`耗时 ${call.durationMs.toFixed(1)} ms`:'耗时未记录'}`),row.callIds.length>1?`合并 ${row.callIds.length} 行`:undefined,row.sql,...[...new Set(calls.map(call=>visibleValue(call.input,mode)).filter(value=>value!==undefined).map(value=>'入参：'+fullValue(value)))]].filter(Boolean).join('\n');
}
