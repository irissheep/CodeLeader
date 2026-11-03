import type {ProjectIndex} from '../shared/model';
import type {DependencyUnit} from './dependency-roles';
import policy from '../shared/frontend-policy.json';

export function frontendDependencyFacts(index:ProjectIndex){
  const model=index.frontend;
  const units:DependencyUnit[]=(model?.modules||[]).map(module=>{
    const role=policy.roles.find(r=>r.id==='frontend-'+module.role)!;
    return{id:module.id,name:module.name,file:module.file,module:module.file.split('/').slice(0,-1).join('/')||'.',role:role.id,basis:module.basis.map(b=>b.note).join('；'),layer:role.layer,color:role.color,classes:0,location:module.location};
  });
  return{units,typeArguments:[] as {from:string;to:string}[],imports:(model?.imports||[]).filter(i=>i.to).map(i=>({from:i.from,to:i.to!,location:i.location})),focus:model?.pages[0]?.componentModuleIds[0]||model?.modules.find(m=>m.role==='component')?.id||units[0]?.id};
}
