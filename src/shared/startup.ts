export interface StartupEvidence {file:string;line?:number;note:string}
export interface StartupCommand {tool:'maven'|'gradle'|'java'|'npm'|'python';args:string[];module?:boolean;label:string;basis:StartupEvidence[]}
export interface StartupChoice {id:string;unitId:string;name:string;root:string;language:string;framework?:string;portOption?:string;artifact?:string;serviceId?:string;port?:number;profile:string;command:StartupCommand;prepare:StartupCommand[];basis:StartupEvidence[];unavailable?:string}
export interface StartupPlan {projectId:string;sourceVersion:string;copy:string;choices:StartupChoice[];selected:string[];url:string;excludedUrls:string;resources:{engine:string;kind:string;note:string}[];warnings:string[];revision:string}
export interface StartupTools {java?:string;mavenHome?:string;gradleHome?:string;python?:string;npm?:string;node?:string}
export function startupWords(text:string){const tokens=text.match(/"(?:\\.|[^"\\])*"|'[^']*'|[^\s]+/g)||[];return tokens.map(s=>{if(s.startsWith('"')){try{return JSON.parse(s) as string;}catch{}}return s.replace(/^(['"])([\s\S]*)\1$/,'$2');});}
