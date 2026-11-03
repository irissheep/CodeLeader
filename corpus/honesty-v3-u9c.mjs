import {honestyRequirements} from './honesty-v3.mjs';

// Preserve the original scorer and score its replacement independently.
export function scoreHonestyV3U9c(model,notes,observed){
 const required=honestyRequirements(model),failures=[];
 if(observed.views.length!==3||observed.views.some(v=>!v.nodes&&!v.empty)||observed.errors.length)failures.push('三个视图未完整显示或出现错误');
 for(const unit of required.web){const note=notes.web.find(w=>w.unitId===unit),card=observed.web.find(w=>w.unit===unit);const evidence=note&&[...note.basis,...note.reasons.flatMap(r=>r.evidence)];if(!card||!note||!card.text.includes(note.framework)||!card.text.includes('没识别出接口')||!card.text.includes(`已扫描 ${note.files.length} 个路由/视图文件`)||!card.text.includes('可能原因')||!card.text.includes('Ctrl+O')||!evidence?.some(e=>card.text.includes(`${e.location.file}:${e.location.range.start.line+1}`))||!card.screenshot)failures.push(`缺少接口说明：${unit}`);}
 for(const unit of required.addresses){const note=notes.addresses.find(a=>a.unitId===unit.id),detail=observed.addresses.find(a=>a.unit===unit.id);const complete=note&&detail&&note.count===unit.count&&detail.count===unit.count&&note.calls.every(call=>detail.text.includes(`${call.location.file}:${call.location.range.start.line+1}`)&&call.variables.every(variable=>detail.text.includes(variable.name)&&detail.text.includes(variable.text)));if(!complete||!detail.visible||!detail.screenshot)failures.push(`缺少地址说明：${unit.id}`);}
 if(required.partial){const valid=notes.partial?.length>0&&notes.partial.length<=3&&notes.partial.every(p=>observed.partial.text.includes(p.text)&&observed.partial.text.includes(p.impact));if(!valid||!observed.partial.rawClosed||!observed.partial.screenshot)failures.push('缺少分析情况的分类说明');}
 for(const view of observed.views){if(view.issueCount===0&&view.buttonVisible)failures.push(`${view.view}零数量仍显示按钮`);if(view.issueCount>0&&(!view.buttonVisible||view.buttonCount!==view.issueCount||view.rows!==view.issueCount||!view.allHaveLocation||!view.allHaveReason||!view.issueScreenshot))failures.push(`${view.view}数量与明细不一致`);}
 const text=[...observed.views.map(v=>v.text),observed.partial.text,...observed.addresses.map(a=>a.text)].join('\n');if(/\bpartial\b|\bAST\b|诊断|符号/.test(text))failures.push('可见说明含内部用语');
 return {status:failures.length?'✗':'✓',failures,requirements:required};
}
