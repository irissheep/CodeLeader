import type {Evidence,Location,SymbolInfo} from '../shared/model';
import type {RuleContext} from './rule-context';
import {basis} from './code-facts';
type SQLRelation=(from:string,sql:string,location:Location,rule:string,extra?:Evidence[],framework?:{table:string;operation:'read'|'write'})=>void;
export function mybatisRules(ctx:RuleContext,sqlRelations:SQLRelation){
 const {index,result,byId,imported,annotation,at,put}=ctx;
 const classes=index.symbols.filter(s=>s.language==='java'&&['class','interface'].includes(s.kind));
 const header=(s:SymbolInfo)=>(result.texts.get(s.file)||'').slice(0).split(/\r?\n/).slice(s.range.start.line,s.range.end.line+1).join('\n').split('{')[0];
 const resolve=(source:SymbolInfo,name:string)=>classes.filter(s=>s.qualifiedName===name||s.name===name&&(imported(source.file,name,s.qualifiedName)||s.qualifiedName===source.qualifiedName.slice(0,source.qualifiedName.lastIndexOf('.')+1)+name));
 const mapperTypes=new Map<string,{entity:SymbolInfo;basis:Evidence[]}>();
 for(const mapper of classes){
  const match=header(mapper).match(/\bextends\s+([\w.]+)\s*<\s*([\w.]+)\s*>/);
  if(!match||!imported(mapper.file,match[1],'com.baomidou.mybatisplus.core.mapper.BaseMapper'))continue;
  const entities=resolve(mapper,match[2]);if(entities.length===1)mapperTypes.set(mapper.id,{entity:entities[0],basis:[basis('declaration',at(mapper),'BaseMapper<'+entities[0].qualifiedName+'> 的实际类型来源')]});
 }
 const tableMappings=new Map<string,{table:string;basis:Evidence[];explicit?:boolean}[]>(),unknownTables=new Set<string>();
 const remember=(id:string,table:string,evidence:Evidence[])=>tableMappings.set(id,[...(tableMappings.get(id)||[]),{table,basis:evidence}]);
 for(const [file,text] of result.configs){if(!file.endsWith('.xml'))continue;
  const namespace=text.match(/<mapper\b[^>]*\bnamespace\s*=\s*["']([\w.]+)["']/)?.[1];if(!namespace)continue;
  const mappers=classes.filter(s=>s.qualifiedName===namespace);if(mappers.length!==1){index.diagnostics.push({file,message:'SQL 文件对应的接口不唯一，未补充调用。',severity:'warning'});continue;}
  const mapper=mappers[0];
  for(const match of text.matchAll(/<(select|insert|update|delete)\b([^>]*?)>([^]*?)<\/\1\s*>/gi)){
   const method=match[2].match(/\bid\s*=\s*["']([\w]+)["']/)?.[1];if(!method)continue;
   const start=match.index!,line=text.slice(0,start).split('\n').length-1,location={file,range:{start:{line,character:0},end:{line:line+match[0].split('\n').length-1,character:0}}};
   const raw=match[3].replace(/<!\[CDATA\[([^]*?)\]\]>/g,'$1').replace(/<!--[^]*?-->/g,'');
   if(/<\/?[A-Za-z][^>]*>/i.test(raw)||/\$\{/.test(raw)){index.diagnostics.push({file,message:'此 SQL 包含动态片段，未猜测唯一数据表。',severity:'warning'});continue;}
   const sql=raw.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').trim();
   const targets=index.symbols.filter(s=>s.parent===mapper.id&&s.name===method&&s.kind==='method');
   if(targets.length!==1){index.diagnostics.push({file,message:'SQL 的接口方法无法唯一对应，保留文件供阅读。',severity:'warning'});continue;}
   sqlRelations(targets[0].id,sql,location,'mybatis.xml-sql',[basis('declaration',at(mapper),'Mapper namespace '+namespace),basis('definition',at(targets[0]),method)]);
   const mapping=mapperTypes.get(mapper.id),type=match[2].match(/\bresultType\s*=\s*["']([\w.]+)["']/)?.[1],tables=[...sql.matchAll(/\b(?:FROM|INTO|UPDATE)\s+[`"]?([\w.]+)/gi)].map(m=>m[1]);
   if(mapping&&type===mapping.entity.qualifiedName&&new Set(tables).size===1&&!/\bJOIN\b/i.test(sql))remember(mapping.entity.id,tables[0],[basis('declaration',location,'XML resultType 与数据表 '+tables[0]),...mapping.basis]);
  }
 }
 for(const entity of classes){if(!annotation(entity,'TableName','com.baomidou.mybatisplus.annotation'))continue;const text=header(entity),table=text.match(/@(?:[\w.]+\.)?TableName\s*\(\s*(?:value\s*=\s*)?["']([\w.]+)["']/)?.[1],globalOverride=ctx.config.values.some(v=>/\.db-config\.(?:schema|table-format|tableFormat)$/.test(v.key));if(table&&!globalOverride&&!/keepGlobalPrefix\s*=\s*true/.test(text)){const schema=text.match(/\bschema\s*=\s*["']([\w.]+)["']/)?.[1];tableMappings.set(entity.id,[{table:schema?schema+'.'+table:table,explicit:true,basis:[basis('declaration',at(entity),'@TableName('+table+')')]}]);}else unknownTables.add(entity.id);}
 const bindings=new Map<string,{entity:SymbolInfo;mapper:SymbolInfo;basis:Evidence[]}>();
 for(const owner of classes){
  const match=header(owner).match(/\bextends\s+([\w.]+)\s*<\s*([\w.]+)\s*,\s*([\w.]+)\s*>/);if(!match||!['com.baomidou.mybatisplus.extension.service.impl.ServiceImpl','com.baomidou.mybatisplus.spring.service.impl.ServiceImpl'].some(type=>imported(owner.file,match[1],type)))continue;
  const mappers=resolve(owner,match[2]),entities=resolve(owner,match[3]);if(mappers.length!==1||entities.length!==1||mapperTypes.get(mappers[0].id)?.entity.id!==entities[0].id)continue;
  bindings.set(owner.id,{mapper:mappers[0],entity:entities[0],basis:[basis('declaration',at(owner),'ServiceImpl 的 Mapper / 实体泛型'),...mapperTypes.get(mappers[0].id)!.basis]});
 }
 const reads=new Set(['list','getById','getOne','page','count','selectList','selectById','selectOne','selectPage','selectCount']),writes=new Set(['save','saveBatch','insert','updateById','update','removeById','remove','deleteById','delete','saveOrUpdate']);
 for(const [file,program] of result.facts){if(!file.endsWith('.java'))continue;for(const call of program.calls){
  const source=byId.get(call.scope),owner=source&&byId.get(source.parent||'');if(!source||!owner)continue;
  const match=call.callee.match(/^(?:(?:this\.)?(\w+)\.)?(\w+)$/);if(!match||!reads.has(match[2])&&!writes.has(match[2]))continue;
  let target=owner;
  if(match[1]&&match[1]!=='this'&&match[1]!=='baseMapper'){
   const field=program.fields.find(f=>f.owner===owner.id&&f.name===match[1]),injects=index.relations.filter(r=>r.type==='INJECTS'&&r.from===owner.id&&r.rule?.basis.some(b=>b.note.includes(' '+match[1])));
   const targets=[...new Set(injects.map(r=>r.to))];if(targets.length!==1||!field||injects.some(r=>r.status!=='resolved'))continue;target=byId.get(targets[0]!)!;
  }
  const direct=mapperTypes.get(target.id),binding=bindings.get(target.id),mapping=direct||binding;if(!mapping)continue;
  // A declared override cannot be treated as the inherited framework operation.
  if(index.symbols.some(s=>s.parent===target.id&&s.name===match[2]&&s.kind==='method'))continue;
  const tables=tableMappings.get(mapping.entity.id)||[],names=new Set(tables.map(t=>t.table));
  if(names.size!==1||unknownTables.has(mapping.entity.id)){index.diagnostics.push({file,message:'已识别框架数据操作，但实体的数据表没有唯一明确映射。',severity:'warning'});continue;}
  const table=[...names][0],write=writes.has(match[2]);
  const conditions:string[]=[],configuration:Evidence[]=[];
  if(!tables.some(t=>t.explicit)){
   // A resultType alone is not an entity-table declaration. Require agreement
   // with the known framework naming subset under the selected configuration.
   const read=(key:string)=>{const value=ctx.config.resolve('mybatis-plus.global-config.db-config.'+key);if(value)configuration.push(basis('config',value.location,key+' → '+value.value));return value?.value;};
   const prefix=read('table-prefix')||'',underline=read('table-underline')||'true',capital=read('capital-mode')||'false',schema=read('schema')||'',format=read('table-format');
   const keys=ctx.config.values.filter(v=>v.key.startsWith('mybatis-plus.global-config.db-config.'));
   const unresolved=keys.some(v=>!ctx.config.resolve(v.key));
   let expected=underline==='true'?mapping.entity.name.replace(/([a-z\d])([A-Z])/g,'$1_$2').toLowerCase():mapping.entity.name[0].toLowerCase()+mapping.entity.name.slice(1);expected=prefix+expected;if(capital==='true')expected=expected.toUpperCase();if(schema)expected=schema+'.'+expected;
   const custom=[...result.facts.values()].some(f=>f.imports.some(i=>/\.(?:GlobalConfig|DynamicTableNameInnerInterceptor|TableNameHandler)$/.test(i.target)&&i.target.startsWith('com.baomidou.mybatisplus.')));
   if(unresolved||format||custom||!/^(?:[A-Z][a-z\d]+)+$/.test(mapping.entity.name)||!['true','false'].includes(underline)||!['true','false'].includes(capital)||expected!==table){index.diagnostics.push({file,message:'XML 的返回类型不足以确定框架操作使用同一张表，保留 SQL 文件中的已知关系。',severity:'warning'});continue;}
   configuration.push(basis('declaration',at(mapping.entity),'实体名称与 MyBatis-Plus 默认表名规则相符；XML 提供相同数据表来源'));
   conditions.push('按所选配置与框架默认表名规则；外部配置覆盖未求值');
  }
  const evidence=[basis('call',call.location,call.text),...mapping.basis,...tables.flatMap(t=>t.basis),...configuration];
  sqlRelations(source.id,'',call.location,'mybatis-plus.inherited-crud',evidence,{table,operation:write?'write':'read'});
  const relation=index.relations.find(r=>r.from===source.id&&r.rule?.id==='mybatis-plus.inherited-crud'&&r.locations.some(l=>l.file===file&&l.range.start.line===call.location.range.start.line&&l.range.start.character===call.location.range.start.character));
  if(relation){relation.rule!.basis.push(basis('declaration',at(target),'继承框架操作 '+match[2]+'；未伪造 SQL 文本或手写实现'));relation.rule!.conditions=[...call.conditions,...conditions];if(conditions.length)relation.rule!.applicability='conditional';}
 }}
}
