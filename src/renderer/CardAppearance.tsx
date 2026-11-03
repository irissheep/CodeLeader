import {Globe,PanelsTopLeft,Server,Code2,Database,Layers,Search,MessagesSquare,FileCode2,Route,Box,CircleHelp} from 'lucide-react';
import {appearancePolicy,type CardRole} from './adaptive-look';
const icons={Globe,PanelsTopLeft,Server,Code2,Database,Layers,Search,MessagesSquare,FileCode2,Route,Box,CircleHelp};
export function RoleIcon({role,size=19}:{role:CardRole;size?:number}){
 const Icon=icons[appearancePolicy.roles[role].icon as keyof typeof icons];return <Icon size={size} aria-hidden="true"/>;
}
