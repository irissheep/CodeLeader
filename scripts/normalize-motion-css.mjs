import fs from 'node:fs/promises';
import path from 'node:path';
import postcss from 'postcss';
import {guard,root} from './common.mjs';
guard();
const excluded=new Set(['motion.css','replay-motion.css','packet-motion.css']);
const output=path.join(root,'.tmp/verification-u2-motion');
const records=[],deferred=[],changes=[];
const duration=/^(-?(?:\d+\.?\d*|\.\d+))(ms|s)$/i;
const allowed=new Set(['transform','opacity']);
const eased=new Map([['linear','linear'],['ease','ease'],['ease-in','easeInOut'],['ease-out','easeOut'],['ease-in-out','easeInOut']]);
const tokens=JSON.parse(await fs.readFile(path.join(root,'src/shared/ui-tokens.json'),'utf8'));
const tiers=['fast','normal','slow'].map(key=>({key,ms:parseFloat(tokens.motion[key])}));
const token=ms=>`var(--motion-${tiers.reduce((best,tier)=>Math.abs(tier.ms-ms)<Math.abs(best.ms-ms)?tier:best,tiers[0]).key})`;
let replacedTimes=0,replacedEasing=0,removedTransitions=0,disabledAnimations=0,removedKeyframes=0;
const files=(await fs.readdir(path.join(root,'src/renderer'))).filter(file=>file.endsWith('.css')&&!excluded.has(file)).sort();
const trees=[];
for(const file of files){const text=await fs.readFile(path.join(root,'src/renderer',file),'utf8'),ast=postcss.parse(text,{from:file});trees.push({file,text,ast});
 ast.walkAtRules(/keyframes$/i,rule=>{const props=new Set();rule.walkDecls(d=>props.add(d.prop));if([...props].some(prop=>!allowed.has(prop)))deferred.push({file,line:rule.source.start.line,keyframes:rule.params,properties:[...props]});});
}
const disabledNames=new Set(deferred.map(item=>item.keyframes));
function timing(value,property){return postcss.list.space(value).map(part=>{
 const time=part.match(duration);if(time){replacedTimes++;const ms=Number(time[1])*(time[2].toLowerCase()==='s'?1000:1);if(property==='transition-delay'&&ms===40)return 'var(--motion-rowStagger)';if(ms===parseFloat(tokens.motion.breathe))return 'var(--motion-breathe)';return token(ms);}
 if(part==='var(--dependency-transition)')return 'var(--motion-normal)';
 if(eased.has(part)||part.startsWith('cubic-bezier(')){replacedEasing++;return `var(--motion-${eased.get(part)||'ease'})`;}
 return part;
}).join(' ');}
for(const {file,text,ast}of trees){
 ast.walkDecls(/^(?:transition|animation)(?:-.+)?$/,decl=>{
  const before=decl.value,location={file,line:decl.source.start.line,selector:decl.parent.selector||decl.parent.name,property:decl.prop};
  records.push({...location,value:before});
  if(decl.prop==='transition'){
   const parts=postcss.list.comma(before).filter(part=>{const property=postcss.list.space(part)[0];if(property==='none'||allowed.has(property))return true;removedTransitions++;return false;});
   decl.value=parts.length?parts.map(part=>timing(part,decl.prop)).join(', '):'none';
  }else if(decl.prop==='transition-property'){
   const parts=postcss.list.comma(before).filter(part=>part==='none'||allowed.has(part));removedTransitions+=postcss.list.comma(before).length-parts.length;decl.value=parts.length?parts.join(','):'none';
  }else if(decl.prop==='animation'){
   decl.value=postcss.list.comma(before).map(part=>{
    if(postcss.list.space(part).some(value=>disabledNames.has(value))){disabledAnimations++;return 'none';}
    const normal=timing(part,decl.prop);
    return postcss.list.space(part).includes('pulse')?normal.replace(/var\(--motion-(fast|normal|slow)\)/,'var(--motion-breathe)'):normal;
   }).join(', ');
  }else if(decl.prop==='animation-name'){
   decl.value=postcss.list.comma(before).map(name=>{if(disabledNames.has(name)){disabledAnimations++;return 'none';}return name;}).join(', ');
  }else decl.value=postcss.list.comma(before).map(part=>timing(part,decl.prop)).join(', ');
  if(before!==decl.value)changes.push({...location,before,after:decl.value});
 });
 ast.walkAtRules(/keyframes$/i,rule=>{if(disabledNames.has(rule.params)){removedKeyframes++;rule.remove();}});
 const next=ast.toString();postcss.parse(next,{from:file});if(next!==text)await fs.writeFile(path.join(root,'src/renderer',file),next);
}
const result={filesScanned:files.length,declarationsScanned:records.length,filesChanged:[...new Set(changes.map(change=>change.file))],declarationsChanged:changes.length,replacedTimes,replacedEasing,removedTransitions,disabledAnimations,removedKeyframes,unsupportedKeyframes:deferred,changes,reasons:{nearest:'旧150ms→120ms、180/200/250ms→220ms，普通过渡取120/220/360最近档；保持原静态状态。',tooltipDelay:'40ms延迟取已存在rowStagger=30ms，与fast=120ms合计150ms，保留U1浮层≤200ms预算。',breathing:'pulse状态点用breathe=2400ms，避免把原1s循环压到360ms造成闪烁。',replacement:'reading-highlight和trace-direction的stroke-opacity/filter/stroke-dashoffset关键帧停用并移除；静态线型、阴影、状态和点击保持，由新current-edge数据包接替。'}};
await fs.mkdir(output,{recursive:true});await fs.writeFile(path.join(output,'css-motion-last-run.json'),JSON.stringify(result,null,2));
if(changes.length||!await fs.stat(path.join(output,'css-motion-audit.json')).catch(()=>false))await fs.writeFile(path.join(output,'css-motion-audit.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify({...result,changes:undefined}));
