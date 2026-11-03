export function Toggle({label,checked,disabled,onChange}:{label:string;checked:boolean;disabled?:boolean;onChange:(value:boolean)=>void}){
  return <button className="runtime-toggle" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={()=>onChange(!checked)}><span>{label}</span><i aria-hidden="true"/></button>;
}
export function Segments<T extends string|number>({label,value,options,onChange}:{label:string;value:T;options:{value:T;label:string}[];onChange:(value:T)=>void}){
  return <div className="runtime-segments" role="group" aria-label={label}>{options.map(option=><button key={option.value} aria-pressed={value===option.value} onClick={()=>onChange(option.value)}>{option.label}</button>)}</div>;
}
