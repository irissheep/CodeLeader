export const secretKey=(name:string)=>/(?:password|passwd|secret|token|api[_-]?key|credential)/i.test(name);
export function redact(text:string){
 return text.split('\n').map(line=>/^\s*[\w.-]*(?:password|passwd|secret|token|api[_-]?key|credential)[\w.-]*\s*[:=]/i.test(line)?line.replace(/([:=]).*$/,'$1 "[已遮蔽]"'):line.replace(/(\w+:\/\/)[^\s/@:]+:[^\s/@]+@/g,'$1[已遮蔽]@').replace(/([?&;](?:password|passwd|secret|token|api[_-]?key)=)[^\s&;"']*/gi,'$1[已遮蔽]')).join('\n');
}
