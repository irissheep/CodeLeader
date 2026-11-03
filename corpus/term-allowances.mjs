export function scopedTermAllowance(entries,term,file,line){
 return entries.find(entry=>entry.file===file&&entry.term.toLowerCase()===term.toLowerCase()&&typeof entry.contains==='string'&&entry.contains.length>0&&line.includes(entry.contains)&&entry.reason);
}
