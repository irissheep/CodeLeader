import type {ViewState} from '../shared/model';
export default function DependencyScope({view,onChange,frontend=false,omitted=0}:{view:ViewState;onChange:(patch:Partial<ViewState>)=>void;frontend?:boolean;omitted?:number}){
 const options=[{id:'chain',label:frontend?'当前页面链路':'当前接口链路'},{id:'module',label:'当前模块'},{id:'project',label:'整个项目'}] as const;
 const scope=view.dependencyScope||(view.fullDependencies?'project':'chain');
 const label=`范围 · ${options.find(o=>o.id===scope)!.label}${omitted?` · 已隐藏 ${omitted} 个`:''}`;
 return <details className="command-more command-view dependency-scope"><summary aria-label="依赖范围" title={label}>{label}</summary><div className="command-menu">{options.map(o=><button key={o.id} aria-pressed={scope===o.id} onClick={e=>{e.currentTarget.closest('details')!.open=false;onChange({dependencyScope:o.id,expanded:[]});}}>{o.label}</button>)}{omitted>0&&<span>已隐藏 {omitted} 个类 / 文件；点开卡片继续</span>}</div></details>;
}
