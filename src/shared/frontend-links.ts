import type {Evidence,Location} from './model';
export type FrontendLinkOutcome='matched'|'ambiguous'|'unmatched'|'configured'|'path-only';
export interface FrontendTarget {backendUnitId?:string;address?:string}
export interface HttpEndpoint {
 id:string;unitId:string;entryId?:string;symbolId?:string;method:string;path:string;profile:string;
 location:Location;basis:Evidence[];port?:number;hosts:string[];conditions:string[];kind:'route'|'framework';addressKnown?:boolean;
}
export interface FrontendAddress {
 id:string;url:string;path:string;host?:string;port?:number;profile:string;known:boolean;
 sourceUnitId?:string;originUnitId?:string;basis:Evidence[];conditions:string[];reason?:string;pathKnown?:boolean;
}
export interface FrontendLink {
 id:string;callId:string;method:string;source:Location;fromUnitId?:string;outcome:FrontendLinkOutcome;
 reason:'unique'|'multiple'|'unknown-address'|'external-backend'|'path-mismatch'|'configuration-only'|'path-only'|'missing-endpoint'|'multiple-paths';
 userTarget?:FrontendTarget;
 addresses:FrontendAddress[];targets:HttpEndpoint[];pathCandidates:HttpEndpoint[];configuredUnitIds:string[];
 configurationTargets:{unitId:string;profile:string;location:Location;basis:Evidence[]}[];
 external?:{host:string;port:number;origin:string;location:Location};basis:Evidence[];
}
export interface FrontendLinks {
 version:string;endpoints:HttpEndpoint[];calls:FrontendLink[];
 servers?:{unitId:string;address:string;profile:string;location:Location;basis:Evidence[]}[];
 units:{id:string;from:string;to:string;kind:'cross-unit'|'embedded';matched:string[];unmatched:string[];ambiguous:string[];pathOnly?:string[];userSpecified?:boolean;lineStyle:'solid'|'dashed';basis:Evidence[]}[];
}
