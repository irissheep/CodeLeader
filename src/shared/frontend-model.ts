import type {Evidence,Location} from './model';

export type FrontendRole='page'|'component'|'api'|'store'|'utility';
export interface FrontendModule {
  id:string;file:string;name:string;role:FrontendRole;unitId?:string;test?:boolean;location:Location;basis:Evidence[];
  symbolIds:string[];pageIds:string[];httpCallIds:string[];
}
export interface FrontendSymbol {id:string;name:string;kind:'function'|'method'|'class'|'module';moduleId:string;parentId?:string;location:Location}
export interface FrontendPage {
  id:string;name:string;paths:string[];rawPaths:string[];componentNames:string[];componentModuleIds:string[];
  location:Location;basis:Evidence[];framework:string;test?:boolean;
}
export interface FrontendValue {value:string;location:Location;profile?:string;expression?:string;unresolved?:boolean;reason?:string;conditions?:string[]}
export interface FrontendHttpCall {
  id:string;method:string;url:string;addressStatus:'known'|'parameterized'|'unknown';reason?:string;expression:string;
  location:Location;methodLocation:Location;moduleId:string;symbolId:string;functionName:string;
  baseURLs:FrontendValue[];pageIds:string[];componentModuleIds:string[];basis:Evidence[];conditions:string[];
  urlValues?:FrontendValue[];
  transportId?:string;test?:boolean;
}
export interface FrontendModel {
  version:string;modules:FrontendModule[];symbols:FrontendSymbol[];pages:FrontendPage[];httpCalls:FrontendHttpCall[];
  transports:FrontendHttpCall[];
  imports:{id:string;from:string;to?:string;specifier:string;location:Location;dynamic:boolean;typeOnly:boolean}[];
  calls:{from:string;to:string;location:Location}[];
  componentUses:{from:string;to:string;location:Location}[];
  proxies:{prefix:string;prefixSource?:FrontendValue;target:FrontendValue;location:Location;unitId?:string;rewrite?:{expression:string;location:Location}}[];
  diagnostics:{location:Location;reason:string}[];
  scanned:{scripts:number;components:number;html:number;styles:number;parsed:number};
}
