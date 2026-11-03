import type { ObservationPlan, RecordedSpan, SafeValue } from '../shared/execution';
import { sensitive, safeUrl } from './snapshot';
function value(v:any):SafeValue {if(v?.stringValue!==undefined)return v.stringValue;if(v?.intValue!==undefined)return String(v.intValue);if(v?.boolValue!==undefined)return v.boolValue;if(v?.doubleValue!==undefined)return v.doubleValue;if(v?.arrayValue)return (v.arrayValue.values||[]).map(value);return null;}
function nestedSnapshots(value:SafeValue|undefined):SafeValue|undefined{if(typeof value==='string'&&value.startsWith('{"__codeleader_snapshot":2')){try{return nestedSnapshots(JSON.parse(value));}catch{return value;}}if(Array.isArray(value))return value.map(v=>nestedSnapshots(v)??null);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,v])=>[key,nestedSnapshots(v)??null]));return value;}
const normalizedSql=(sql:string)=>sql.replace(/#\{[^}]+\}/g,'?').replace(/'(?:''|[^'])*'/g,'?').replace(/\s+/g,' ').trim().toLowerCase();
export function decodeBatch(batch:any,plan:ObservationPlan):RecordedSpan[]{
  const result:RecordedSpan[]=[];
  for(const resource of batch.resourceSpans||[]){
    const attrs=Object.fromEntries((resource.resource?.attributes||[]).map((a:any)=>[a.key,value(a.value)]));
    for(const scope of resource.scopeSpans||[])for(const span of scope.spans||[]){
      if(!/^[a-f0-9]{32}$/i.test(span.traceId)||!/^[a-f0-9]{16}$/i.test(span.spanId))continue;
      const attributes:Record<string,SafeValue>={};for(const attr of span.attributes||[]){
        if(plan.capturePolicy!=='raw'&&(sensitive.test(attr.key)||/exception\.(message|stacktrace)|http\..*header|db\..*parameter/.test(attr.key)))continue;
        let v=value(attr.value);if(plan.capturePolicy!=='raw'&&typeof v==='string'&&/url|http.target/.test(attr.key))v=safeUrl(v);attributes[attr.key]=v;
      }
      const point=plan.points.find(p=>p.id===attributes['codeleader.point']);
      if(attrs['codeleader.service_id'])attributes['codeleader.service_id']=attrs['codeleader.service_id'];
      const versionMatch=(attributes['codeleader.version']||attrs['codeleader.version'])===plan.sourceVersion,match=!!point&&versionMatch;
      const route=versionMatch&&Number(span.kind)===2?plan.routes.find(r=>r.path===attributes['http.route']&&r.method===(attributes['http.request.method']||attributes['http.method'])&&r.serviceId===attrs['codeleader.service_id']):undefined;
      const sql=String(attributes['db.statement']||attributes['db.query.text']||'');
      const resources=sql?plan.resources?.filter(r=>r.sql&&normalizedSql(r.sql)===normalizedSql(sql)):attributes['codeleader.boundary']==='chroma.query'?[...new Map(plan.resources?.filter(r=>r.kind==='vector'&&r.from===plan.points.find(p=>p.id===attributes['codeleader.from'])?.symbolId).map(r=>[r.id,r])).values()]:[];
      const resource=versionMatch&&resources?.length===1?resources[0]:undefined;
      const parse=(key:string)=>{try{return JSON.parse(String(attributes[key]));}catch{return undefined;}};
      const entering=attributes['codeleader.phase']==='enter';
      result.push({traceId:span.traceId,spanId:entering?String(attributes['codeleader.invocation']):span.spanId,parentSpanId:entering?String(attributes['codeleader.parent']):span.parentSpanId||undefined,name:span.name,kind:Number(span.kind),service:String(attrs['service.name']||'服务'),start:String(span.startTimeUnixNano),end:entering?'0':String(span.endTimeUnixNano),status:entering?'pending':span.status?.code===2||span.status?.code==='STATUS_CODE_ERROR'?'error':'ok',attributes,links:(span.links||[]).map((l:any)=>({traceId:l.traceId,spanId:l.spanId})),symbolId:match?point.symbolId:route?.symbolId,location:match?point.location:route?.location||resource?.location,entityId:resource?.id,mappingBasis:resource?(sql?'实际 SQL 模板与当前源码唯一匹配':'实际库边界与当前观察方法的资源关系匹配'):undefined,versionMatch,input:parse('codeleader.input')||nestedSnapshots(parse('codeleader.parameters')),output:attributes['codeleader.boundary']==='jdbc'?nestedSnapshots(parse('codeleader.output')):parse('codeleader.output'),error:parse('codeleader.error'),invocationId:String(attributes['codeleader.invocation']||span.spanId),durationMs:typeof attributes['codeleader.duration_ms']==='number'?attributes['codeleader.duration_ms']:undefined});
    }
  }
  return result;
}
/** Collector emits one OTLP batch per line. Preserve an incomplete UTF-8 tail until the next read. */
export class BatchReader {
  private tail=Buffer.alloc(0); private seen=new Set<string>(); dropped=0;
  constructor(private plan:ObservationPlan){}
  push(chunk:Buffer){const data=Buffer.concat([this.tail,chunk]),last=data.lastIndexOf(10);if(last<0){this.tail=data.length<4*1024*1024?data:Buffer.alloc(0);if(!this.tail.length)this.dropped++;return [];}
    this.tail=data.subarray(last+1);const result:RecordedSpan[]=[];
    for(const line of data.subarray(0,last).toString('utf8').split('\n')){if(!line.trim())continue;try{for(const s of decodeBatch(JSON.parse(line),this.plan)){const id=s.traceId+':'+s.spanId+':'+(s.attributes['codeleader.phase']||'span');if(this.seen.has(id))continue;if(this.seen.size>=20000){this.dropped++;continue;}this.seen.add(id);result.push(s);}}catch{this.dropped++;}}
    return result;
  }
  finish(){if(this.tail.length){try{return this.push(Buffer.from('\n'));}catch{this.dropped++;}}return [];}
}
export function mergeRecorded(existing:RecordedSpan[],incoming:RecordedSpan[]){
  const byId=new Map(existing.map((s,i)=>[s.traceId+':'+s.spanId,i]));
  for(const span of incoming){const key=span.traceId+':'+span.spanId,position=byId.get(key);if(position===undefined){byId.set(key,existing.length);existing.push(span);}else{const previous=existing[position];if(previous.status!=='pending'&&span.status==='pending'){existing[position]={...previous,input:previous.input??span.input};continue;}existing[position]={...previous,...span,attributes:{...previous.attributes,...span.attributes},input:previous.input??span.input};}}
  for(const payload of existing.filter(s=>s.attributes['codeleader.boundary']==='http.payload')){const clients=existing.filter(s=>s.traceId===payload.traceId&&s.parentSpanId===payload.spanId&&s.kind===3);if(clients.length===1){const client=clients[0];client.input=payload.input;client.output=payload.output;client.attributes['codeleader.payload']=payload.spanId;}}
}
