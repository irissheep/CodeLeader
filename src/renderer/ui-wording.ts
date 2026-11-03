import table from '../shared/ui-wording.json';

export function wording(key:keyof typeof table.copy,values:Record<string,string|number>={}){
 return table.copy[key].replace(/\{(\w+)\}/g,(original,name)=>values[name]===undefined?original:String(values[name]));
}
export function configurationLabel(value?:{kind:string;name:string}){
 return value?(table.configurationLabels as Record<string,string>)[value.kind]||value.name:wording('projectConfiguration');
}
/** Only tool-authored descriptions. Never pass SQL, source, URLs or recorded values. */
export function describe(text:string){
 for(const[from,to]of Object.entries(table.phrases))text=text.replaceAll(from,to);
 for(const from of table.descriptionTerms)text=text.replaceAll(from,(table.terms as Record<string,string>)[from]);
 return text;
}
export {table as wordingTable};
