import type {HTMLAttributes,ReactNode} from 'react';

export function Row({leading,children,detail,tail,className='',mainClassName='',visual=false}:{leading?:ReactNode;children:ReactNode;detail?:ReactNode;tail?:ReactNode;className?:string;mainClassName?:string;visual?:boolean}){
 return <span className={`layout-row ${className}`} data-detail={!!detail} data-leading={leading!==undefined} data-visual={visual}><span className="layout-leading">{leading}</span><span className={`layout-text ${mainClassName}`}><span className="layout-title">{children}</span>{detail&&<span className="layout-detail">{detail}</span>}</span><span className="layout-tail" data-packet-slot>{tail}</span></span>;
}
export function CardSurface({className='',...props}:HTMLAttributes<HTMLDivElement>){return <div {...props} className={`layout-card ${className}`}/>;}
