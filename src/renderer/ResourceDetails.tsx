import type {Location,ProjectIndex} from '../shared/model';
import type {GraphCard,GraphLink} from './graph-model';
import {resourceUsage} from './hierarchy-model';
import {describe,wording,wordingTable} from './ui-wording';

export default function ResourceDetails({card,links,index,onSource}:{card:GraphCard;links:GraphLink[];index:ProjectIndex;onSource:(l:Location)=>void}){
 const usage=resourceUsage(card,links),relations=links.filter(l=>l.target===card.id).flatMap(l=>l.relations);
 const sources=[...card.entity?.basis||[],...card.resource?.basis.map(b=>({kind:b.source,location:b.location,note:b.note}))||[],...relations.flatMap(r=>r.rule?.basis||[])];
 const unique=[...new Map(sources.map(s=>[JSON.stringify([s.location,s.note]),s])).values()];
 const configuration=unique.find(s=>['config','configuration','connection','compose'].includes(s.kind));
 const selected=index.configurations?.find(c=>c.id===index.configurationId),conditions=[...card.entity?.conditions||[],...relations.flatMap(r=>r.rule?.conditions||[])];
 const disabled=wordingTable.configurationSignals.find(s=>conditions.some(c=>new RegExp(s.pattern,'i').test(c)));
 const calls=relations.filter(r=>r.type==='READS'||r.type==='WRITES').flatMap(r=>r.locations.map(location=>({location,type:r.type,note:r.data?.table?wording(r.type==='READS'?'readTable':'writeTable',{name:r.data.table}):`${r.type==='READS'?'读':'写入'} ${card.name}`})));
 const access=[...new Map(calls.map(c=>[JSON.stringify([c.type,c.location]),c])).values()];
 return <section className="resource-readout" data-summary-kind="resource" data-resource-id={card.id} data-table-total={usage.tables} data-place-total={usage.places}>
  <h2>{card.name}</h2><p data-copy-key="resource-places">{usage.configuredOnly?wording('resourceOnlyConfig'):wording('resourcePlaces',{places:usage.places})}</p>
  {configuration&&<p>{wording('configurationSource')}：<button className="source-link" onClick={()=>onSource(configuration.location)}>{configuration.location.file}:{configuration.location.range.start.line+1}</button>{disabled?wording('configurationDisabled'):selected?wording('configurationCurrent',{name:describe(selected.name)}):''}</p>}
  {!!usage.tables&&<details data-copy-key="resource-tables"><summary>{wording('resourceTables',{count:usage.tables})}</summary><ul>{usage.tableNames.map(name=><li key={name} data-table-name={name}>{name}</li>)}</ul></details>}
  {!!access.length&&<details><summary>读写位置</summary>{access.map((item,i)=><button className="source-link evidence-link" data-access-key={JSON.stringify([item.type,item.location])} key={i} onClick={()=>onSource(item.location)}><span>{item.note}</span><small>{item.location.file}:{item.location.range.start.line+1}</small></button>)}</details>}
  {!!unique.length&&<details><summary>{wording('source')}</summary>{unique.map((item,i)=><button className="source-link evidence-link" key={i} onClick={()=>onSource(item.location)}><span>{['call','definition'].includes(item.kind)?item.note:describe(item.note)}</span><small>{item.location.file}:{item.location.range.start.line+1}</small></button>)}</details>}
 </section>;
}
