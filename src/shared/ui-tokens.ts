import tokens from './ui-tokens.json';
export default tokens;
export function tokenVariables(){
  return Object.entries(tokens).filter(([group])=>group!=='reason').flatMap(([group,values])=>Object.entries(values).filter(([,value])=>typeof value==='string'||typeof value==='number').map(([name,value])=>[`--${group}-${name}`,String(value)] as const));
}
