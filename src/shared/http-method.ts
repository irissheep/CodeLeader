export const httpMethodLabel=(method:string)=>method==='ANY'?'任意方法':method==='UNKNOWN'?'方法未确定':method;
export const httpRouteLabel=(route:string)=>route.replace(/^(ANY|UNKNOWN)(?=\s|$)/,httpMethodLabel);
